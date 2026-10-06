import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test, { type TestContext } from 'node:test';
import express from 'express';
import { WebSocket } from 'ws';
import { createRemoteAccessBackend } from './index';
import { createTrustedProxyPolicy } from './clientAddress';
import { loadRemoteAccessConfig } from './config';

class UpgradeRejected extends Error {
  constructor(public readonly status: number | undefined) {
    super(`Upgrade rejected with HTTP ${status}.`);
  }
}

const fixture = async (t: TestContext, trustedProxies = '', maxWebSockets = 1) => {
  const previous = process.env.OPEN_BALENA_JWT_SECRET;
  process.env.OPEN_BALENA_JWT_SECRET = 'client-address-test-secret';
  t.after(() => {
    if (previous === undefined) delete process.env.OPEN_BALENA_JWT_SECRET;
    else process.env.OPEN_BALENA_JWT_SECRET = previous;
  });
  const config = loadRemoteAccessConfig({
    OPEN_BALENA_TUNNEL_URL: 'https://tunnel.example.test',
    OPEN_BALENA_POSTGREST_URL: 'https://database.example.test',
    REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test',
    OPEN_BALENA_REMOTE_PUBLIC_ORIGIN: 'https://ui.example.test',
    OPEN_BALENA_REMOTE_TRUSTED_PROXIES: trustedProxies,
    OPEN_BALENA_REMOTE_MAX_WEBSOCKETS_PER_IP: String(maxWebSockets),
  });
  const backend = createRemoteAccessBackend(config);
  const app = express();
  app.set('trust proxy', config.trustedProxy);
  app.get('/address', (req, res) => res.json({ ip: req.ip }));
  app.use(backend.router);
  const server = createServer(app);
  backend.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const sockets: WebSocket[] = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await backend.shutdown();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const connect = (forwardedFor: string) =>
    new Promise<WebSocket>((resolve, reject) => {
      const socket = new WebSocket(`${url.replace('http:', 'ws:')}/remote/ws`, {
        headers: {
          'Origin': 'https://ui.example.test',
          'Host': 'ui.example.test',
          'X-Forwarded-For': forwardedFor,
        },
      });
      sockets.push(socket);
      socket.once('open', () => resolve(socket));
      socket.once('error', reject);
      socket.once('unexpected-response', (request, response) => {
        response.resume();
        request.destroy();
        reject(new UpgradeRejected(response.statusCode));
      });
    });
  const clientIp = async (forwardedFor: string) => {
    const response = await fetch(`${url}/address`, { headers: { 'X-Forwarded-For': forwardedFor } });
    assert.equal(response.status, 200);
    return (await response.json()).ip;
  };
  return { connect, clientIp };
};

test('default policy ignores spoofed forwarded addresses for both HTTP and WebSocket limits', async (t) => {
  const { connect, clientIp } = await fixture(t);
  assert.equal(await clientIp('198.51.100.7'), '127.0.0.1');
  await connect('198.51.100.7');
  await assert.rejects(
    connect('198.51.100.8'),
    (error: unknown) => error instanceof UpgradeRejected && error.status === 429,
  );
});

test('trusted proxy clients have independent WebSocket slots and closed slots are released', async (t) => {
  const { connect, clientIp } = await fixture(t, 'loopback');
  assert.equal(await clientIp('198.51.100.7'), '198.51.100.7');
  const first = await connect('198.51.100.7');
  await connect('198.51.100.8');
  await assert.rejects(
    connect('198.51.100.7'),
    (error: unknown) => error instanceof UpgradeRejected && error.status === 429,
  );
  first.close();
  await once(first, 'close');
  await connect('198.51.100.7');
});

test('the eight-slot boundary limits one client without rejecting a ninth terminal from another proxy client', async (t) => {
  const { connect } = await fixture(t, 'loopback', 8);
  for (let connection = 0; connection < 8; connection++) await connect('198.51.100.7');
  await assert.rejects(
    connect('198.51.100.7'),
    (error: unknown) => error instanceof UpgradeRejected && error.status === 429,
  );
  await connect('198.51.100.8');
});

test('address chains stop at the closest untrusted hop instead of trusting a spoofed leftmost value', async (t) => {
  const { connect, clientIp } = await fixture(t, 'loopback,10.0.0.0/8');
  assert.equal(await clientIp('spoofed, 198.51.100.7, 10.0.0.2'), '198.51.100.7');
  await connect('spoofed, 198.51.100.7, 10.0.0.2');
  await assert.rejects(
    connect('different-spoof, 198.51.100.7, 10.0.0.2'),
    (error: unknown) => error instanceof UpgradeRejected && error.status === 429,
  );
  await connect('2001:db8::7, 10.0.0.2');
});

test('malformed nearest client addresses from a trusted proxy are rejected explicitly', async (t) => {
  const { connect } = await fixture(t, 'loopback');
  await assert.rejects(
    connect('not-an-ip'),
    (error: unknown) => error instanceof UpgradeRejected && error.status === 400,
  );
  await connect('198.51.100.7');
});

test('proxy trust configuration defaults to none and rejects blanket or invalid policies', () => {
  assert.equal(createTrustedProxyPolicy(undefined)('127.0.0.1', 0), false);
  const trust = createTrustedProxyPolicy('10.0.0.0/24,2001:db8::/32');
  assert.equal(trust('10.0.0.2', 0), true);
  assert.equal(trust('::ffff:10.0.0.2', 0), true);
  assert.equal(trust('10.0.1.2', 0), false);
  assert.equal(trust('2001:db8::7', 0), true);
  for (const value of ['true', 'proxy.example.test', '0.0.0.0/0', '::/0']) {
    assert.throws(() => createTrustedProxyPolicy(value), /OPEN_BALENA_REMOTE_TRUSTED_PROXIES/);
  }
});
