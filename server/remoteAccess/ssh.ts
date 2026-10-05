import { createHash } from 'node:crypto';
import type { ClientChannel, SFTPWrapper } from 'ssh2';
import { Client } from 'ssh2';
import type { RemoteIdentity } from './auth';
import type { RemoteAccessConfig } from './config';
import type { UserSshKeyManager } from './keys';
import { openTunnel } from './tunnel';
import { validateContainerName } from './validation';

export interface SshLease {
  client: Client;
  close(): void;
}

export class OperationQuota {
  private readonly counts = new Map<number, number>();
  public constructor(private readonly maximum: number) {}

  public acquire(userId: number): () => void {
    const count = this.counts.get(userId) ?? 0;
    if (count >= this.maximum) throw new Error('Remote operation quota exceeded.');
    this.counts.set(userId, count + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (this.counts.get(userId) ?? 1) - 1;
      if (next <= 0) this.counts.delete(userId);
      else this.counts.set(userId, next);
    };
  }
}

export const fingerprint = (key: Buffer): string =>
  `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;

export const hostKeyVerifier = (config: RemoteAccessConfig, deviceUuid: string): ((key: Buffer) => boolean) => {
  const host = `${deviceUuid.toLowerCase()}.balena`;
  const allowed =
    config.hostKeys.get(host) ?? config.hostKeys.get(deviceUuid.toLowerCase()) ?? config.hostKeys.get('*');
  return (key) => (allowed ? allowed.has(fingerprint(key)) : config.allowUnverifiedHostKeys);
};

export const connectSsh = async (
  config: RemoteAccessConfig,
  keys: UserSshKeyManager,
  quota: OperationQuota,
  identity: RemoteIdentity,
  deviceUuid: string,
  signal?: AbortSignal,
): Promise<SshLease> => {
  const releaseQuota = quota.acquire(identity.userId);
  let keyLease: Awaited<ReturnType<UserSshKeyManager['acquire']>> | undefined;
  let socket: Awaited<ReturnType<typeof openTunnel>> | undefined;
  try {
    keyLease = await keys.acquire(identity);
    socket = await openTunnel(config, identity, deviceUuid, signal);
    const hasConfiguredHostKey =
      config.hostKeys.has(`${deviceUuid.toLowerCase()}.balena`) ||
      config.hostKeys.has(deviceUuid.toLowerCase()) ||
      config.hostKeys.has('*');
    if (!hasConfiguredHostKey && !config.allowUnverifiedHostKeys) {
      throw new Error(`No SSH host-key pin is configured for ${deviceUuid}.`);
    }
    const client = new Client();
    await new Promise<void>((resolve, reject) => {
      const fail = (error: Error): void => reject(error);
      const abort = (): void => {
        client.end();
        reject(new Error('Remote connection aborted.'));
      };
      signal?.addEventListener('abort', abort, { once: true });
      client.once('ready', () => {
        signal?.removeEventListener('abort', abort);
        client.off('error', fail);
        resolve();
      });
      client.once('error', fail);
      client.connect({
        sock: socket,
        username: identity.username,
        privateKey: keyLease!.privateKey,
        readyTimeout: config.connectTimeoutMs,
        keepaliveInterval: 30_000,
        keepaliveCountMax: 3,
        hostVerifier: hostKeyVerifier(config, deviceUuid),
      });
    });
    let closed = false;
    const close = (): void => {
      if (closed) return;
      closed = true;
      client.end();
      socket?.destroy();
      keyLease?.release();
      releaseQuota();
    };
    client.on('error', close);
    client.once('close', close);
    return { client, close };
  } catch (error) {
    socket?.destroy();
    keyLease?.release();
    releaseQuota();
    throw error;
  }
};

export const openSftp = (client: Client): Promise<SFTPWrapper> =>
  new Promise((resolve, reject) => {
    client.sftp((error, sftp) =>
      error || !sftp ? reject(new Error('SFTP capability is unavailable on this device.')) : resolve(sftp),
    );
  });

export const containerSelectionCommand = (container: string): string => {
  const selector = validateContainerName(container);
  return (
    `if [ -x /usr/bin/balena-engine ]; then engine=/usr/bin/balena-engine; else engine=/usr/bin/docker; fi; ` +
    (selector === 'balena_supervisor'
      ? `cid=$("$engine" ps -q --filter 'name=^/balena_supervisor$' | head -n 1); `
      : `cid=$("$engine" ps -q --filter label=io.balena.service-name=${selector} | head -n 1); `) +
    `[ -n "$cid" ] || { echo "Service container is not running." >&2; exit 1; }; `
  );
};

export const containerShellCommand = (container: string): string =>
  containerSelectionCommand(container) + `exec "$engine" exec -it "$cid" /bin/sh`;

export const openShell = (
  client: Client,
  columns: number,
  rows: number,
  container?: string,
  signal?: AbortSignal,
): Promise<ClientChannel> =>
  new Promise((resolve, reject) => {
    const abort = (): void => {
      client.end();
      reject(new Error('Terminal open cancelled.'));
    };
    signal?.addEventListener('abort', abort, { once: true });
    const callback = (error: Error | undefined, channel: ClientChannel): void => {
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else if (signal?.aborted) {
        channel.end();
        reject(new Error('Terminal open cancelled.'));
      } else resolve(channel);
    };
    const terminal = { term: 'xterm-256color', cols: columns, rows, width: 0, height: 0 };
    if (container) {
      client.exec(containerShellCommand(container), { pty: terminal }, callback);
    } else {
      client.shell(terminal, callback);
    }
  });
