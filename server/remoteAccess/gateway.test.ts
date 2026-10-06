import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, IncomingMessage } from 'node:http';
import { createConnection, Socket } from 'node:net';
import { TLSSocket } from 'node:tls';
import test, { type TestContext } from 'node:test';
import express from 'express';
import { SignJWT } from 'jose';
import { WebSocket } from 'ws';
import { createRemoteAccessBackend } from './index';
import { loadRemoteAccessConfig, parseHostKeys, parsePublicOrigin } from './config';
import { attachUnavailableRemoteUpgrade } from './unavailable';
import { effectiveRequestOrigin, originAllowed } from './validation';

const fixture = async (t: TestContext) => {
  const server = createServer((_req, res) => res.end('alive'));
  attachUnavailableRemoteUpgrade(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const exchange = async (target: string) => {
    const socket = createConnection(address.port, '127.0.0.1');
    socket.setTimeout(3000, () => socket.destroy(new Error('Upgrade response timed out.')));
    await once(socket, 'connect');
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.end(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`);
    await once(socket, 'close');
    return Buffer.concat(chunks).toString();
  };
  return { exchange, url: `http://127.0.0.1:${address.port}` };
};

test('malformed unauthenticated upgrade targets close the socket without terminating the server', async (t) => {
  const { exchange, url } = await fixture(t);
  for (const target of ['//[', '//host:invalid-port/remote/ws']) {
    assert.equal(await exchange(target), '');
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'alive');
  }
  assert.match(await exchange('/remote/ws'), /^HTTP\/1\.1 503 Service Unavailable/);
  assert.match(await exchange('/other'), /^HTTP\/1\.1 404 Not Found/);
});

test('same-origin validation compares scheme, host, and effective port', () => {
  const expected = 'https://ui.example.test';
  assert.equal(originAllowed('https://ui.example.test:443', expected, new Set()), true);
  for (const origin of ['http://ui.example.test', 'https://ui.example.test:444', 'https://other.example.test']) {
    assert.equal(originAllowed(origin, expected, new Set()), false);
  }
  assert.equal(originAllowed('http://ui.example.test', expected, new Set(['http://ui.example.test'])), true);
  assert.equal(originAllowed('file:///tmp/file', expected, new Set()), false);
  assert.equal(originAllowed(undefined, expected, new Set()), false);
  assert.equal(originAllowed('not-a-url', expected, new Set()), false);
});

test('effective origin uses socket TLS or the configured public origin, never untrusted forwarded headers', (t) => {
  const plain = new IncomingMessage(new Socket());
  const secure = new IncomingMessage(new TLSSocket(new Socket()));
  t.after(() => {
    plain.socket.destroy();
    secure.socket.destroy();
  });
  plain.headers = { 'host': 'ui.example.test', 'x-forwarded-proto': 'https' };
  secure.headers = { 'host': 'ui.example.test', 'x-forwarded-proto': 'http' };
  assert.equal(effectiveRequestOrigin(plain), 'http://ui.example.test');
  assert.equal(effectiveRequestOrigin(secure), 'https://ui.example.test');
  assert.equal(effectiveRequestOrigin(plain, 'https://public.example.test'), 'https://public.example.test');
  assert.equal(originAllowed('http://ui.example.test', effectiveRequestOrigin(secure), new Set()), false);
  plain.headers.host = '[::1]:3000';
  assert.equal(effectiveRequestOrigin(plain), 'http://[::1]:3000');
  delete plain.headers.host;
  assert.equal(effectiveRequestOrigin(plain), undefined);
  plain.headers.host = '[';
  assert.equal(effectiveRequestOrigin(plain), undefined);
});

test('public origin configuration requires a credential-free HTTP(S) origin', () => {
  assert.equal(parsePublicOrigin(undefined), undefined);
  assert.equal(parsePublicOrigin(''), undefined);
  assert.equal(parsePublicOrigin('https://UI.EXAMPLE.TEST:443/'), 'https://ui.example.test');
  for (const value of [
    'not-a-url',
    'file:///tmp',
    'https://user:secret@ui.example.test',
    'https://ui.example.test/path',
    'https://ui.example.test?token=x',
    'https://ui.example.test#hash',
  ]) {
    assert.throws(() => parsePublicOrigin(value), /OPEN_BALENA_REMOTE_PUBLIC_ORIGIN/);
  }
  const config = loadRemoteAccessConfig({
    OPEN_BALENA_TUNNEL_URL: 'https://tunnel.example.test',
    REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test',
    OPEN_BALENA_POSTGREST_URL: 'https://database.example.test',
    OPEN_BALENA_REMOTE_PUBLIC_ORIGIN: 'https://UI.EXAMPLE.TEST:443/',
  });
  assert.equal(config.publicOrigin, 'https://ui.example.test');
});

test('padded standalone fingerprints are wildcard pins rather than host assignments', () => {
  const fingerprint = `SHA256:${'A'.repeat(43)}`;
  assert.deepEqual([...parseHostKeys(`${fingerprint}=`)], [['*', new Set([fingerprint])]]);
  assert.deepEqual(
    [...parseHostKeys(`device=${fingerprint}=,${fingerprint}=`)],
    [
      ['device', new Set([fingerprint])],
      ['*', new Set([fingerprint])],
    ],
  );
  assert.throws(() => parseHostKeys(`${fingerprint}==`), /invalid host or SHA256 fingerprint/);
});

test('gateway initialization fails explicitly when its JWT verification secret is missing', async (t) => {
  const previous = process.env.OPEN_BALENA_JWT_SECRET;
  t.after(() => {
    if (previous === undefined) delete process.env.OPEN_BALENA_JWT_SECRET;
    else process.env.OPEN_BALENA_JWT_SECRET = previous;
  });
  const config = loadRemoteAccessConfig({
    OPEN_BALENA_TUNNEL_URL: 'https://tunnel.example.test',
    REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test',
    OPEN_BALENA_POSTGREST_URL: 'https://database.example.test',
  });
  for (const value of [undefined, '']) {
    if (value === undefined) delete process.env.OPEN_BALENA_JWT_SECRET;
    else process.env.OPEN_BALENA_JWT_SECRET = value;
    assert.throws(() => createRemoteAccessBackend(config), /OPEN_BALENA_JWT_SECRET must be configured/);
  }
  process.env.OPEN_BALENA_JWT_SECRET = 'gateway-configuration-test-secret';
  const backend = createRemoteAccessBackend(config);
  await backend.shutdown();
});

test('configured public origins enforce schemes across tickets, both SFTP routes, and WebSocket upgrades', async (t) => {
  const secret = 'gateway-origin-route-test-secret';
  const previous = process.env.OPEN_BALENA_JWT_SECRET;
  process.env.OPEN_BALENA_JWT_SECRET = secret;
  t.after(() => {
    if (previous === undefined) delete process.env.OPEN_BALENA_JWT_SECRET;
    else process.env.OPEN_BALENA_JWT_SECRET = previous;
  });
  const backend = createRemoteAccessBackend(
    loadRemoteAccessConfig({
      OPEN_BALENA_TUNNEL_URL: 'https://tunnel.example.test',
      REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test',
      OPEN_BALENA_POSTGREST_URL: 'https://database.example.test',
      OPEN_BALENA_REMOTE_PUBLIC_ORIGIN: 'https://ui.example.test',
    }),
  );
  t.after(() => backend.shutdown());
  const app = express();
  app.use(backend.router);
  const server = createServer(app);
  backend.attach(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://api.example.test/user/v1/whoami') {
      return Promise.resolve(Response.json({ id: 42, username: 'alice' }));
    }
    if (url === `https://api.example.test/access/v1/hostos/${'a'.repeat(32)}`) {
      return Promise.resolve(Response.json({ allowed: true }));
    }
    assert.ok(url.startsWith(baseUrl), `Unexpected network request: ${url}`);
    return originalFetch(input, init);
  });
  const token = await new SignJWT({ id: 42 })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret));
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Origin': 'http://ui.example.test',
    'Host': 'ui.example.test',
    'Content-Type': 'application/json',
  };
  for (const [route, method] of [
    ['/remote/session', 'POST'],
    ['/remote/sftp/upload', 'PUT'],
    ['/remote/sftp/download', 'GET'],
  ]) {
    const response = await fetch(baseUrl + route, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify({ deviceUuid: 'a'.repeat(32) }),
    });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.ok(body.error === 'invalid_origin' || /origin/.test(body.message));
  }
  const rejected = new WebSocket(`${baseUrl.replace('http:', 'ws:')}/remote/ws`, {
    headers: { Origin: 'http://ui.example.test', Host: 'ui.example.test' },
  });
  await new Promise<void>((resolve, reject) => {
    rejected.once('error', reject);
    rejected.once('open', () => {
      rejected.close();
      reject(new Error('An alternate-scheme WebSocket origin was accepted.'));
    });
    rejected.once('unexpected-response', (request, response) => {
      try {
        assert.equal(response.statusCode, 403);
        response.resume();
        request.destroy();
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
  const issued = await fetch(`${baseUrl}/remote/session`, {
    method: 'POST',
    headers: { ...headers, Origin: 'https://ui.example.test' },
    body: JSON.stringify({ deviceUuid: 'a'.repeat(32) }),
  });
  assert.equal(issued.status, 201);
  const { ticket } = await issued.json();
  const accepted = new WebSocket(`${baseUrl.replace('http:', 'ws:')}/remote/ws`, {
    headers: { Origin: 'https://ui.example.test', Host: 'ui.example.test' },
  });
  await once(accepted, 'open');
  accepted.send(JSON.stringify({ v: 1, type: 'auth', ticket }));
  const [message] = await once(accepted, 'message');
  assert.equal(JSON.parse(message.toString()).type, 'ready');
  accepted.close();
  await once(accepted, 'close');
});
