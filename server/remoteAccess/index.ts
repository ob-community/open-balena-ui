import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Transform, type Duplex } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { json as jsonBody, Router } from 'express';
import type { Request, Response } from 'express';
import type { ClientChannel, Stats } from 'ssh2';
import { WebSocket, WebSocketServer } from 'ws';
import authorize, { type AuthorizedLocals } from '../middleware/authorize';
import dosProtect from '../middleware/dosProtect';
import { authorizeDevice, resolveRemoteIdentity, type RemoteIdentity } from './auth';
import { loadRemoteAccessConfig, type RemoteAccessConfig } from './config';
import { UserSshKeyManager } from './keys';
import { decodeChannelData, encodeChannelData, parseControlMessage } from './protocol';
import { connectSsh, openSftp, openShell, OperationQuota, type SshLease } from './ssh';
import { resolveTransferPath } from './files';
import { parseRemoteTarget, type ContainerSelector } from '../../src/lib/remoteTarget';
import { TicketLimitError, TicketStore, type RemoteTicket } from './tickets';
import { resolveClientAddress } from './clientAddress';
import {
  contentDisposition,
  effectiveRequestOrigin,
  isDeviceUuid,
  originAllowed,
  parseSingleRange,
  validateRemotePath,
} from './validation';

interface TerminalChannel {
  stream: ClientChannel;
  ssh: SshLease;
}

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : 'Remote access failed.');

const requestOrigin = (req: Request): string => {
  const origin = req.get('Origin');
  return origin ? new URL(origin).origin : '';
};

const sendError = (res: Response, error: unknown, status = 502): void => {
  const message = errorMessage(error);
  const capability = message.includes('capability is unavailable');
  res.status(capability ? 501 : status).json({
    error: capability ? 'sftp_unavailable' : 'remote_access_failed',
    message,
  });
};

const requestAbort = (req: Request, res: Response): AbortController => {
  const controller = new AbortController();
  req.once('aborted', () => controller.abort());
  res.once('close', () => {
    if (!res.writableFinished) controller.abort();
  });
  return controller;
};

const identifyAndAuthorize = async (
  req: Request,
  res: Response,
  config: RemoteAccessConfig,
  deviceUuid: string,
): Promise<RemoteIdentity> => {
  const controller = requestAbort(req, res);
  const identity = await resolveRemoteIdentity(
    req,
    (res.locals as AuthorizedLocals).auth,
    config.apiUrl,
    controller.signal,
  );
  await authorizeDevice(identity, config.apiUrl, deviceUuid, controller.signal);
  return identity;
};

export const transferParameters = (
  req: Request,
  config: RemoteAccessConfig,
): { deviceUuid: string; remotePath: string; container?: ContainerSelector } => {
  const deviceUuid = req.query.deviceUuid;
  if (!isDeviceUuid(deviceUuid)) throw new Error('A valid device UUID is required.');
  const selection = parseRemoteTarget(
    req.query.container === undefined ? 'host' : 'container',
    req.query.container,
    req.query.containerKind,
  );
  return {
    deviceUuid,
    remotePath: validateRemotePath(req.query.path, config.maxPathBytes),
    container: selection.target === 'container' ? selection : undefined,
  };
};

export interface RemoteAccessBackend {
  router: Router;
  attach(server: HttpServer): void;
  shutdown(): Promise<void>;
}

export const createRemoteAccessBackend = (config = loadRemoteAccessConfig()): RemoteAccessBackend => {
  if (!process.env.OPEN_BALENA_JWT_SECRET) throw new Error('OPEN_BALENA_JWT_SECRET must be configured.');
  const router = Router();
  const tickets = new TicketStore(config.ticketTtlMs, {
    maxPerUser: config.maxPendingTicketsPerUser,
    maxTotal: config.maxPendingTickets,
  });
  const keys = new UserSshKeyManager(config.postgrestUrl, config.keyIdleTtlMs, config.connectTimeoutMs);
  const quota = new OperationQuota(config.maxOperationsPerUser);
  const webSockets = new WebSocketServer({
    noServer: true,
    maxPayload: config.maxMessageBytes,
    perMessageDeflate: false,
  });
  const sockets = new Set<WebSocket>();
  const socketsByIp = new Map<string, number>();
  const clientAddresses = new WeakMap<WebSocket, string>();

  router.post(
    '/remote/session',
    ...dosProtect,
    authorize,
    jsonBody({ limit: '8kb', strict: true }),
    async (req, res) => {
      try {
        const origin = requestOrigin(req);
        if (!originAllowed(origin, effectiveRequestOrigin(req, config.publicOrigin), config.allowedOrigins)) {
          res.status(403).json({ error: 'invalid_origin', message: 'Remote access origin is not allowed.' });
          return;
        }
        const body = req.body as Record<string, unknown> | undefined;
        if (!isDeviceUuid(body?.deviceUuid)) {
          res.status(400).json({ error: 'invalid_request', message: 'A valid device UUID is required.' });
          return;
        }
        const identity = await identifyAndAuthorize(req, res, config, body.deviceUuid);
        const issued = tickets.issue(identity, body.deviceUuid, origin);
        res.status(201).json({ version: 1, ...issued });
      } catch (error) {
        if (error instanceof TicketLimitError) {
          res.set('Retry-After', String(Math.ceil(config.ticketTtlMs / 1000)));
          res.status(429).json({ error: 'ticket_limit', message: error.message });
        } else {
          sendError(res, error, 403);
        }
      }
    },
  );

  router.put('/remote/sftp/upload', ...dosProtect, authorize, async (req, res) => {
    let ssh: SshLease | undefined;
    let uploadedBytes = 0;
    let temporaryPath: string | undefined;
    let uploadSftp: Awaited<ReturnType<typeof openSftp>> | undefined;
    try {
      const origin = req.get('Origin');
      if (origin && !originAllowed(origin, effectiveRequestOrigin(req, config.publicOrigin), config.allowedOrigins)) {
        res.status(403).json({ error: 'invalid_origin', message: 'Remote access origin is not allowed.' });
        return;
      }
      const { deviceUuid, remotePath, container } = transferParameters(req, config);
      const lengthHeader = req.get('Content-Length');
      const declaredLength = lengthHeader == null ? undefined : Number(lengthHeader);
      if (
        declaredLength != null &&
        (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > config.maxUploadBytes)
      ) {
        res.status(413).json({ error: 'upload_too_large', message: 'Upload exceeds the configured limit.' });
        return;
      }
      const controller = requestAbort(req, res);
      const identity = await identifyAndAuthorize(req, res, config, deviceUuid);
      ssh = await connectSsh(config, keys, quota, identity, deviceUuid, controller.signal);
      const sftp = await openSftp(ssh.client);
      uploadSftp = sftp;
      const targetPath = await resolveTransferPath(
        ssh.client,
        sftp,
        remotePath,
        container,
        controller.signal,
        config.connectTimeoutMs,
      );
      const targetExists = await new Promise<boolean>((resolve, reject) =>
        sftp.stat(targetPath, (error) => {
          if (!error) resolve(true);
          else if ((error as Error & { code?: number }).code === 2) resolve(false);
          else reject(error);
        }),
      );
      if (targetExists) {
        res.status(409).json({ error: 'target_exists', message: 'The upload target already exists.' });
        return;
      }
      temporaryPath = `${targetPath}.obui-${randomBytes(12).toString('hex')}.part`;
      const counter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          uploadedBytes += chunk.length;
          callback(
            uploadedBytes > config.maxUploadBytes ? new Error('Upload exceeds the configured limit.') : null,
            chunk,
          );
        },
      });
      const output = sftp.createWriteStream(temporaryPath, { flags: 'wx', mode: 0o600 });
      await pipeline(req, counter, output, { signal: controller.signal });
      if (declaredLength != null && uploadedBytes !== declaredLength) throw new Error('Upload length mismatch.');
      await new Promise<void>((resolve, reject) =>
        sftp.rename(temporaryPath!, targetPath, (error) => (error ? reject(error) : resolve())),
      );
      temporaryPath = undefined;
      res.status(201).json({ bytes: uploadedBytes });
    } catch (error) {
      if (!res.headersSent) sendError(res, error, errorMessage(error).includes('limit') ? 413 : 502);
      else res.destroy();
    } finally {
      if (temporaryPath && uploadSftp) {
        await new Promise<void>((resolve) => uploadSftp!.unlink(temporaryPath!, () => resolve()));
      }
      ssh?.close();
    }
  });

  const download = async (req: Request, res: Response): Promise<void> => {
    let ssh: SshLease | undefined;
    try {
      const origin = req.get('Origin');
      if (origin && !originAllowed(origin, effectiveRequestOrigin(req, config.publicOrigin), config.allowedOrigins)) {
        res.status(403).json({ error: 'invalid_origin', message: 'Remote access origin is not allowed.' });
        return;
      }
      const { deviceUuid, remotePath, container } = transferParameters(req, config);
      const controller = requestAbort(req, res);
      const identity = await identifyAndAuthorize(req, res, config, deviceUuid);
      ssh = await connectSsh(config, keys, quota, identity, deviceUuid, controller.signal);
      const sftp = await openSftp(ssh.client);
      const sourcePath = await resolveTransferPath(
        ssh.client,
        sftp,
        remotePath,
        container,
        controller.signal,
        config.connectTimeoutMs,
      );
      const stats = await new Promise<Stats>((resolve, reject) =>
        sftp.stat(sourcePath, (error, value) => (error ? reject(error) : resolve(value))),
      );
      if (!stats.isFile() || !Number.isSafeInteger(stats.size) || stats.size < 0) {
        throw new Error('The requested remote path is not a valid file.');
      }
      let range;
      try {
        range = parseSingleRange(req.get('Range'), stats.size);
      } catch {
        res.set('Content-Range', `bytes */${stats.size}`).status(416).end();
        return;
      }
      const start = range?.start ?? 0;
      const end = range?.end ?? Math.max(0, stats.size - 1);
      res.set({
        'Accept-Ranges': 'bytes',
        'Content-Disposition': contentDisposition(remotePath),
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(stats.size === 0 ? 0 : end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${stats.size}` } : {}),
      });
      res.status(range ? 206 : 200);
      if (req.method === 'HEAD' || stats.size === 0) {
        res.end();
        return;
      }
      await new Promise<void>((resolve, reject) => {
        const input = sftp.createReadStream(sourcePath, { start, end });
        input.once('error', reject);
        input.once('end', resolve);
        res.once('close', () => {
          if (!res.writableFinished) input.destroy(new Error('Download aborted.'));
        });
        input.pipe(res);
      });
    } catch (error) {
      if (!res.headersSent) sendError(res, error);
      else res.destroy();
    } finally {
      ssh?.close();
    }
  };
  router.get('/remote/sftp/download', ...dosProtect, authorize, download);
  router.head('/remote/sftp/download', ...dosProtect, authorize, download);

  const json = (socket: WebSocket, value: Record<string, unknown>): void => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ v: 1, ...value }));
  };

  webSockets.on('connection', (socket, request) => {
    const remoteAddress = clientAddresses.get(socket);
    if (!remoteAddress) {
      socket.close(1008, 'A validated client address is required.');
      return;
    }
    sockets.add(socket);
    socketsByIp.set(remoteAddress, (socketsByIp.get(remoteAddress) ?? 0) + 1);
    const origin = request.headers.origin ? new URL(request.headers.origin).origin : '';
    let authenticated: RemoteTicket | undefined;
    const channels = new Map<number, TerminalChannel>();
    const pendingChannels = new Map<number, AbortController>();
    const rawSocket = (socket as WebSocket & { _socket?: Duplex })._socket;
    let inputBackpressure = 0;
    const pauseInputUntilDrain = (stream: ClientChannel): void => {
      inputBackpressure += 1;
      if (inputBackpressure === 1) rawSocket?.pause();
      const release = (): void => {
        stream.off('close', release);
        inputBackpressure = Math.max(0, inputBackpressure - 1);
        if (inputBackpressure === 0) rawSocket?.resume();
      };
      stream.once('drain', release);
      stream.once('close', release);
    };
    let alive = true;
    socket.on('pong', () => {
      alive = true;
    });
    const authTimer = setTimeout(() => socket.close(4401, 'Authentication timeout'), 10_000);
    authTimer.unref();
    const heartbeat = setInterval(() => {
      if (!alive) return socket.terminate();
      alive = false;
      socket.ping();
    }, 30_000);
    heartbeat.unref();

    const closeChannel = (id: number): boolean => {
      const channel = channels.get(id);
      if (!channel) return false;
      channels.delete(id);
      channel.stream.end();
      channel.ssh.close();
      return true;
    };
    const failChannel = (id: number, error: unknown): void => {
      json(socket, { type: 'error', channel: id, code: 'remote_error', message: errorMessage(error) });
      closeChannel(id);
    };

    socket.on('message', async (data, isBinary) => {
      try {
        if (!authenticated) {
          if (isBinary) throw new Error('Authenticate before sending channel data.');
          const message = parseControlMessage(data.toString());
          if (message.type !== 'auth') throw new Error('The first message must authenticate.');
          authenticated = tickets.consume(message.ticket, origin);
          if (!authenticated) {
            socket.close(4401, 'Invalid ticket');
            return;
          }
          clearTimeout(authTimer);
          json(socket, { type: 'ready' });
          return;
        }
        if (isBinary) {
          const message = decodeChannelData(Buffer.from(data as ArrayBuffer));
          const channel = channels.get(message.channel);
          if (!channel) throw new Error('Unknown channel.');
          if (!channel.stream.write(message.payload)) {
            pauseInputUntilDrain(channel.stream);
          }
          return;
        }
        const message = parseControlMessage(data.toString());
        if (message.type === 'auth') throw new Error('Already authenticated.');
        if (message.type === 'heartbeat') {
          json(socket, { type: 'heartbeat', ...(message.nonce == null ? {} : { nonce: message.nonce }) });
          return;
        }
        if (message.type === 'close') {
          pendingChannels.get(message.channel)?.abort();
          pendingChannels.delete(message.channel);
          closeChannel(message.channel);
          json(socket, { type: 'closed', channel: message.channel });
          return;
        }
        if (message.type === 'resize') {
          const channel = channels.get(message.channel);
          if (!channel) throw new Error('Unknown channel.');
          channel.stream.setWindow(message.rows, message.cols, 0, 0);
          return;
        }
        if (channels.has(message.channel) || pendingChannels.has(message.channel)) {
          throw new Error('Channel already exists.');
        }
        if (channels.size + pendingChannels.size >= config.maxChannelsPerSocket) {
          throw new Error('Channel quota exceeded.');
        }
        const controller = new AbortController();
        pendingChannels.set(message.channel, controller);
        let ssh: SshLease | undefined;
        try {
          await authorizeDevice(authenticated.identity, config.apiUrl, authenticated.deviceUuid, controller.signal);
          ssh = await connectSsh(
            config,
            keys,
            quota,
            authenticated.identity,
            authenticated.deviceUuid,
            controller.signal,
          );
          const stream = await openShell(
            ssh.client,
            message.cols,
            message.rows,
            message.target === 'container' ? message : undefined,
            controller.signal,
          );
          if (pendingChannels.get(message.channel) !== controller || socket.readyState !== WebSocket.OPEN) {
            stream.end();
            ssh.close();
            return;
          }
          pendingChannels.delete(message.channel);
          channels.set(message.channel, { ssh, stream });
          json(socket, { type: 'opened', channel: message.channel });
          stream.on('data', (chunk: Buffer) => {
            if (socket.readyState !== WebSocket.OPEN) return;
            socket.send(encodeChannelData(message.channel, chunk));
            if (socket.bufferedAmount > 2 * config.maxMessageBytes) {
              stream.pause();
              const resume = setInterval(() => {
                if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount <= config.maxMessageBytes) {
                  clearInterval(resume);
                  if (socket.readyState === WebSocket.OPEN) stream.resume();
                }
              }, 25);
              resume.unref();
            }
          });
          stream.stderr.on('data', (chunk: Buffer) => {
            if (socket.readyState !== WebSocket.OPEN) return;
            socket.send(encodeChannelData(message.channel, chunk));
            if (socket.bufferedAmount > 2 * config.maxMessageBytes) {
              stream.stderr.pause();
              const resume = setInterval(() => {
                if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount <= config.maxMessageBytes) {
                  clearInterval(resume);
                  if (socket.readyState === WebSocket.OPEN) stream.stderr.resume();
                }
              }, 25);
              resume.unref();
            }
          });
          stream.once('exit', (code, signal) => json(socket, { type: 'exit', channel: message.channel, code, signal }));
          stream.once('close', () => {
            if (closeChannel(message.channel)) json(socket, { type: 'closed', channel: message.channel });
          });
          stream.once('error', (error) => failChannel(message.channel, error));
        } catch (error) {
          pendingChannels.delete(message.channel);
          ssh?.close();
          if (!controller.signal.aborted) {
            json(socket, {
              type: 'error',
              channel: message.channel,
              code: 'channel_open_failed',
              message: errorMessage(error),
            });
            json(socket, { type: 'closed', channel: message.channel });
          }
        }
      } catch (error) {
        json(socket, { type: 'error', code: 'protocol_error', message: errorMessage(error) });
        socket.close(1011, 'Remote operation failed');
      }
    });
    socket.once('close', () => {
      clearTimeout(authTimer);
      clearInterval(heartbeat);
      for (const controller of pendingChannels.values()) controller.abort();
      pendingChannels.clear();
      for (const id of channels.keys()) closeChannel(id);
      sockets.delete(socket);
      const remaining = (socketsByIp.get(remoteAddress) ?? 1) - 1;
      if (remaining <= 0) socketsByIp.delete(remoteAddress);
      else socketsByIp.set(remoteAddress, remaining);
    });
    socket.once('error', () => socket.close());
  });

  const upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    let pathname = '';
    try {
      pathname = new URL(request.url ?? '', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    if (pathname !== '/remote/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    if (
      !originAllowed(
        request.headers.origin,
        effectiveRequestOrigin(request, config.publicOrigin),
        config.allowedOrigins,
      )
    ) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    let remoteAddress: string;
    try {
      remoteAddress = resolveClientAddress(request, config.trustedProxy);
    } catch {
      socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n', () => socket.destroy());
      return;
    }
    if ((socketsByIp.get(remoteAddress) ?? 0) >= config.maxWebSocketsPerIp) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      clientAddresses.set(webSocket, remoteAddress);
      webSockets.emit('connection', webSocket, request);
    });
  };

  return {
    router,
    attach(server) {
      server.on('upgrade', upgrade);
    },
    async shutdown() {
      tickets.clear();
      for (const socket of sockets) socket.terminate();
      await new Promise<void>((resolve) => webSockets.close(() => resolve()));
      await keys.shutdown();
    },
  };
};
