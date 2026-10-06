import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Client, Server, type ConnectConfig } from 'ssh2';
import { loadRemoteAccessConfig } from './config';
import { generateEd25519SshKey, UserSshKeyManager } from './keys';
import { connectSsh, containerSelectionCommand, containerShellCommand, OperationQuota } from './ssh';

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
