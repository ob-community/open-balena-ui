import path from 'node:path';
import type { Client, ClientChannel, SFTPWrapper } from 'ssh2';
import { containerSelectionCommand } from './ssh';
import { validateRemotePath } from './validation';

export const containerRoot = (
  client: Client,
  container: string,
  signal?: AbortSignal,
  timeoutMs = 30_000,
): Promise<string> => {
  const command = containerSelectionCommand(container) + `"$engine" inspect --format '{{.State.Pid}}' "$cid"`;
  return new Promise((resolve, reject) => {
    let channel: ClientChannel | undefined;
    let finished = false;
    let output = '';
    let errors = '';
    const finish = (error?: Error, root?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (error) {
        channel?.destroy();
        reject(error);
      } else resolve(root!);
    };
    const abort = () => finish(new Error('Container file transfer cancelled.'));
    const timer = setTimeout(() => finish(new Error('Container filesystem lookup timed out.')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) {
      abort();
      return;
    }
    client.exec(command, (error, stream) => {
      if (error) {
        finish(error);
        return;
      }
      channel = stream;
      if (finished) {
        stream.destroy();
        return;
      }
      const append = (chunk: Buffer, stderr: boolean) => {
        if (stderr) errors += chunk.toString();
        else output += chunk.toString();
        if (Buffer.byteLength(output) + Buffer.byteLength(errors) > 4096)
          finish(new Error('Container filesystem lookup returned excessive output.'));
      };
      stream.on('data', (chunk: Buffer) => append(chunk, false));
      stream.stderr.on('data', (chunk: Buffer) => append(chunk, true));
      stream.once('error', (failure: Error) => finish(failure));
      stream.once('close', (code: number | undefined) => {
        const pid = output.trim();
        if (code !== 0) finish(new Error(errors.trim() || 'Container filesystem lookup failed.'));
        else if (!/^[1-9]\d*$/.test(pid) || !Number.isSafeInteger(Number(pid)))
          finish(new Error('The selected container is not running or returned an invalid process ID.'));
        else finish(undefined, `/proc/${pid}/root`);
      });
    });
  });
};

interface ContainerFilesystem {
  lstat(path: string): Promise<{ isSymbolicLink(): boolean; isDirectory(): boolean }>;
  readlink(path: string): Promise<string>;
}

export const containerFilePath = async (
  filesystem: ContainerFilesystem,
  root: string,
  remotePath: string,
  signal?: AbortSignal,
): Promise<string> => {
  let pending = validateRemotePath(remotePath).split('/').filter(Boolean);
  const resolved: string[] = [];
  let links = 0;
  let directoryRequired = remotePath.endsWith('/');
  while (pending.length) {
    signal?.throwIfAborted();
    const component = pending.shift()!;
    const candidate = `${root}/${[...resolved, component].join('/')}`;
    let stats;
    try {
      stats = await filesystem.lstat(candidate);
    } catch (error) {
      if (
        pending.length === 0 &&
        !directoryRequired &&
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 2
      )
        return candidate;
      throw error;
    }
    if (!stats.isSymbolicLink()) {
      if ((pending.length > 0 || directoryRequired) && !stats.isDirectory())
        throw new Error('The container path parent is not a directory.');
      resolved.push(component);
    } else {
      if (++links > 40) throw new Error('The container path contains too many symbolic links.');
      const target = await filesystem.readlink(candidate);
      if (!pending.length && target.endsWith('/')) directoryRequired = true;
      // Absolute links must restart at the container root, not the host's root.
      const canonical = path.posix.resolve('/', ...resolved, target);
      pending = [...canonical.split('/').filter(Boolean), ...pending];
      resolved.length = 0;
    }
  }
  signal?.throwIfAborted();
  return `${root}/${resolved.join('/')}${directoryRequired && resolved.length ? '/' : ''}`;
};

export const resolveTransferPath = async (
  client: Client,
  sftp: SFTPWrapper,
  remotePath: string,
  container?: string,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<string> => {
  if (container === undefined) return remotePath;
  const root = await containerRoot(client, container, signal, timeoutMs);
  return containerFilePath(
    {
      lstat: (value) =>
        new Promise((resolve, reject) => sftp.lstat(value, (error, stats) => (error ? reject(error) : resolve(stats)))),
      readlink: (value) =>
        new Promise((resolve, reject) =>
          sftp.readlink(value, (error, target) => (error ? reject(error) : resolve(target))),
        ),
    },
    root,
    remotePath,
    signal,
  );
};
