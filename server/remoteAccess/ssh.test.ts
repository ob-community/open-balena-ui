import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { setImmediate as nextTurn, setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Client, Server, type ConnectConfig } from 'ssh2';
import { loadRemoteAccessConfig } from './config';
import { generateEd25519SshKey, UserSshKeyManager } from './keys';
import { connectSsh, containerSelectionCommand, containerShellCommand, OperationQuota } from './ssh';

const cancellationConfig = () =>
  loadRemoteAccessConfig({
    OPEN_BALENA_TUNNEL_URL: 'http://127.0.0.1:1',
    OPEN_BALENA_POSTGREST_URL: 'http://postgrest.example.test',
    REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test',
    OPEN_BALENA_SSH_ALLOW_UNVERIFIED_HOST_KEYS: 'true',
  });

test('abort releases SSH quota promptly and relinquishes a late key lease exactly once', async (t) => {
  const config = cancellationConfig();
  const keys = new UserSshKeyManager(config.postgrestUrl, config.keyIdleTtlMs);
  let resolve!: (lease: { privateKey: string; release(): void }) => void;
  const acquisition = new Promise<{ privateKey: string; release(): void }>((done) => {
    resolve = done;
  });
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  t.mock.method(keys, 'acquire', (_identity: unknown, signal?: AbortSignal) => {
    receivedSignal = signal;
    return acquisition;
  });
  const quota = new OperationQuota(1);
  const identity = { userId: 1, username: 'alice', token: 'test' };
  const cancelled = assert.rejects(
    connectSsh(config, keys, quota, identity, 'a'.repeat(32), controller.signal),
    /aborted/,
  );
  assert.throws(() => quota.acquire(identity.userId), /quota exceeded/);
  controller.abort();
  assert.equal(receivedSignal, controller.signal);
  // Quota is returned synchronously, even if a key provider ignores cancellation.
  const releaseReplacement = quota.acquire(identity.userId);
  await cancelled;
  let releases = 0;
  resolve({ privateKey: 'late-key', release: () => releases++ });
  await nextTurn();
  assert.equal(releases, 1);
  assert.throws(
    () => quota.acquire(identity.userId),
    /quota exceeded/,
    'late completion must not release another slot',
  );
  releaseReplacement();
  quota.acquire(identity.userId)();
});

test('SSH cancellation during shared registration returns quota without discarding another caller’s key', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const config = cancellationConfig();
  const keys = new UserSshKeyManager(config.postgrestUrl, 10, 100);
  t.after(() => keys.shutdown());
  let finish!: () => void;
  const registration = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let started!: () => void;
  const registering = new Promise<void>((resolve) => {
    started = resolve;
  });
  let deletes = 0;
  let posts = 0;
  t.mock.method(globalThis, 'fetch', async (_input: unknown, options?: RequestInit) => {
    if (options?.method === 'POST') {
      posts++;
      started();
      await registration;
      return Response.json([{ id: 1 }]);
    }
    if (options?.method === 'DELETE') {
      deletes++;
      return new Response(null, { status: 204 });
    }
    return Response.json([]);
  });
  const identity = { userId: 1, username: 'alice', token: 'test' };
  const quota = new OperationQuota(1);
  const controller = new AbortController();
  const cancelled = assert.rejects(
    connectSsh(config, keys, quota, identity, 'a'.repeat(32), controller.signal),
    /aborted/,
  );
  await registering;
  const second = keys.acquire(identity);
  controller.abort();
  await cancelled;
  quota.acquire(identity.userId)();
  finish();
  const lease = await second;
  t.mock.timers.tick(10);
  await nextTurn();
  assert.equal(posts, 1);
  assert.equal(deletes, 0);
  lease.release();
  t.mock.timers.tick(10);
  await nextTurn();
  assert.equal(deletes, 1);
});

test('an already aborted SSH connection neither reserves quota nor requests a key', async (t) => {
  const config = cancellationConfig();
  const keys = new UserSshKeyManager(config.postgrestUrl, config.keyIdleTtlMs);
  let acquisitions = 0;
  t.mock.method(keys, 'acquire', async () => {
    acquisitions++;
    throw new Error('Unexpected key acquisition.');
  });
  const controller = new AbortController();
  controller.abort();
  const quota = new OperationQuota(1);
  await assert.rejects(
    connectSsh(config, keys, quota, { userId: 1, username: 'alice', token: 'test' }, 'a'.repeat(32), controller.signal),
    /aborted/,
  );
  assert.equal(acquisitions, 0);
  quota.acquire(1)();
});

test('Supervisor selection cannot match an App service named core', () => {
  const supervisor = containerSelectionCommand('balena_supervisor');
  assert.match(supervisor, /--filter 'name=\^\/balena_supervisor\$'/);
  assert.doesNotMatch(supervisor, /label=|service-name=core/);
  assert.equal((supervisor.match(/\bps -q\b/g) ?? []).length, 1);
  assert.ok(containerShellCommand('balena_supervisor').startsWith(supervisor));
  assert.match(containerShellCommand('balena_supervisor'), /exec "\$engine" exec -it "\$cid" \/bin\/sh$/);
  assert.match(containerSelectionCommand('core'), /--filter label=io\.balena\.service-name=core /);
  assert.doesNotMatch(containerShellCommand('ugcontainer'), /balena_supervisor/);
  assert.doesNotMatch(containerShellCommand('core'), /balena_supervisor/);
  assert.doesNotMatch(containerShellCommand('core-next'), /balena_supervisor/);
  assert.throws(() => containerShellCommand('core; id'), /container/i);
});

test('explicit selector kind prevents an App named balena_supervisor from opening Supervisor', () => {
  const service = { container: 'balena_supervisor', containerKind: 'service' as const };
  const supervisor = { container: 'balena_supervisor', containerKind: 'supervisor' as const };
  assert.match(containerSelectionCommand(service), /--filter label=io\.balena\.service-name=balena_supervisor /);
  assert.doesNotMatch(containerSelectionCommand(service), /--filter 'name=/);
  assert.ok(containerShellCommand(service).startsWith(containerSelectionCommand(service)));
  assert.equal(containerSelectionCommand(supervisor), containerSelectionCommand('balena_supervisor'));
  assert.throws(
    () => containerSelectionCommand({ container: 'core', containerKind: 'supervisor' }),
    /Supervisor selector/,
  );
});

test('SSH keepalives preserve an idle CONNECT tunnel and retain the key until closure', async (t) => {
  const key = generateEd25519SshKey();
  const sshServer = new Server({ hostKeys: [key.privateKey] });
  let keepalives = 0;
  let closing = false;
  sshServer.on('connection', (client) => {
    client.on('error', (error: Error) => {
      if (!closing) assert.fail(error);
      else t.diagnostic(`SSH server observed client teardown: ${error.message}`);
    });
    client.on('authentication', (context) => context.accept());
  });
  const sockets = new Set<Socket>();
  const proxy = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    let request = '';
    const connect = (chunk: Buffer) => {
      request += chunk.toString();
      if (!request.includes('\r\n\r\n')) return;
      socket.off('data', connect);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      socket.setTimeout(250, () => socket.destroy());
      sshServer.injectSocket(socket);
    };
    socket.on('data', connect);
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  t.after(() => {
    closing = true;
    for (const socket of sockets) socket.destroy();
    return new Promise<void>((resolve, reject) => proxy.close((error) => (error ? reject(error) : resolve())));
  });

  const config = loadRemoteAccessConfig({
    OPEN_BALENA_TUNNEL_URL: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`,
    OPEN_BALENA_POSTGREST_URL: 'http://postgrest.example.test',
    REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test',
    OPEN_BALENA_SSH_ALLOW_UNVERIFIED_HOST_KEYS: 'true',
  });
  const keys = new UserSshKeyManager(config.postgrestUrl, config.keyIdleTtlMs);
  let releases = 0;
  t.mock.method(keys, 'acquire', async () => ({ privateKey: key.privateKey, release: () => releases++ }));
  const originalConnect = Client.prototype.connect;
  let configured: ConnectConfig | undefined;
  t.mock.method(Client.prototype, 'connect', function (this: Client, options: ConnectConfig) {
    configured = options;
    // Exercise the real SSH keepalive exchange without making the regression suite wait 30 seconds per probe.
    return originalConnect.call(this, {
      ...options,
      keepaliveInterval: options.keepaliveInterval ? 40 : 0,
      debug: (message) => {
        if (message.includes('Outbound: Sending ping')) keepalives++;
      },
    });
  });
  const quota = new OperationQuota(1);
  const lease = await connectSsh(config, keys, quota, { userId: 1, username: 'alice', token: 'test' }, 'a'.repeat(32));
  t.after(() => lease.close());
  let closed = false;
  lease.client.on('close', () => {
    closed = true;
  });
  await delay(650);
  assert.equal(configured?.keepaliveInterval, 30_000);
  assert.equal(configured?.keepaliveCountMax, 3);
  assert.ok(keepalives >= 2, 'SSH probes must traverse the CONNECT tunnel without terminal input');
  assert.equal(closed, false, 'a responsive idle tunnel must remain open beyond its inactivity deadline');
  assert.equal(releases, 0, 'idle terminal activity must not release its ephemeral key');
  assert.throws(() => quota.acquire(1), /quota exceeded/);
  const close = once(lease.client, 'close');
  closing = true;
  lease.close();
  await close;
  assert.equal(releases, 1);
  quota.acquire(1)();
});
