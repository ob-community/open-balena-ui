import tls from 'node:tls';
import net from 'node:net';
import type { Duplex } from 'node:stream';
import type { RemoteAccessConfig } from './config';
import type { RemoteIdentity } from './auth';

export const openTunnel = (
  config: RemoteAccessConfig,
  identity: RemoteIdentity,
  deviceUuid: string,
  signal?: AbortSignal,
): Promise<Duplex> =>
  new Promise((resolve, reject) => {
    let settled = false;
    let response = Buffer.alloc(0);
    const secure = config.tunnel.protocol === 'https:';
    const socket = secure
      ? tls.connect({
          host: config.tunnel.host,
          port: config.tunnel.port,
          servername: config.tunnel.servername,
          rejectUnauthorized: true,
        })
      : net.connect({ host: config.tunnel.host, port: config.tunnel.port });
    const cleanup = (): void => {
      socket.off('data', onData);
      socket.off('error', fail);
      socket.off('end', onClosed);
      socket.off('close', onClosed);
      socket.off('timeout', onTimeout);
      socket.off(secure ? 'secureConnect' : 'connect', onConnect);
      socket.setTimeout(0);
      signal?.removeEventListener('abort', abort);
    };
    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };
    const abort = (): void => fail(new Error('Remote connection aborted.'));
    const onClosed = (): void => fail(new Error('Tunnel closed before the CONNECT response was complete.'));
    const onTimeout = (): void => fail(new Error('Tunnel connection timed out.'));
    const onConnect = (): void => {
      const credentials = Buffer.from(`${identity.username}:${identity.token}`, 'utf8').toString('base64');
      socket.write(
        `CONNECT ${deviceUuid}.balena:${config.targetPort} HTTP/1.1\r\n` +
          `Host: ${deviceUuid}.balena:${config.targetPort}\r\n` +
          `Proxy-Authorization: Basic ${credentials}\r\nConnection: keep-alive\r\n\r\n`,
      );
    };
    const onData = (chunk: Buffer): void => {
      response = Buffer.concat([response, chunk]);
      if (response.length > 8192) return fail(new Error('Invalid tunnel response.'));
      const end = response.indexOf('\r\n\r\n');
      if (end === -1) return;
      const status = /^HTTP\/1\.[01] (\d{3})(?: |$)/.exec(response.subarray(0, end).toString('ascii'))?.[1];
      if (status !== '200') return fail(new Error(`Tunnel refused the connection (${status ?? 'invalid response'}).`));
      settled = true;
      cleanup();
      socket.pause();
      const remainder = response.subarray(end + 4);
      if (remainder.length) socket.unshift(remainder);
      resolve(socket);
    };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    socket.setTimeout(config.connectTimeoutMs);
    socket.once('timeout', onTimeout);
    socket.once('error', fail);
    socket.once('end', onClosed);
    socket.once('close', onClosed);
    socket.once(secure ? 'secureConnect' : 'connect', onConnect);
    socket.on('data', onData);
  });
