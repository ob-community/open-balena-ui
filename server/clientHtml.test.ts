import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import express from 'express';
import { SignJWT } from 'jose';
import { createClientHtmlRouter } from './routes/clientHtml';

const fixture = async (
  t: TestContext,
  options: Parameters<typeof createClientHtmlRouter>[0] = {},
  html: string | undefined = '<html><!--OBUI_RUNTIME_ENV--><body>SPA</body></html>',
) => {
  const clientDir = await mkdtemp(path.join(os.tmpdir(), 'obui-client-html-'));
  const indexPath = path.join(clientDir, 'index.html');
  if (html !== undefined) await writeFile(indexPath, html);
  await writeFile(path.join(clientDir, 'asset.js'), 'window.fixtureAsset = true;');
  const app = express();
  app.get('/fixture-api', (_req, res) => res.json({ ok: true }));
  app.use(express.static(clientDir, { index: false }));
  app.use(createClientHtmlRouter({ ...options, clientDir }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    await rm(clientDir, { recursive: true, force: true });
  });
  return { baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, indexPath };
};

test('600 unauthenticated SPA requests share one quota, while authenticated successes remain unlimited', async (t) => {
  const secret = 'client-html-test-secret';
  const { baseUrl, indexPath } = await fixture(t, { env: { OPEN_BALENA_JWT_SECRET: secret } });
  let checks = 0;
  let reads = 0;
  const exists = fs.existsSync;
  const read = fs.readFileSync;
  t.mock.method(fs, 'existsSync', (value) => {
    if (value === indexPath) checks++;
    return exists(value);
  });
  t.mock.method(fs, 'readFileSync', (value, options) => {
    if (value === indexPath) reads++;
    return read(value, options);
  });
  for (let request = 0; request < 600; request++) {
    const response = await fetch(`${baseUrl}/${request === 0 ? '' : `deep-link/${request}`}`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<body>SPA<\/body>/);
  }
  assert.equal(checks, 600);
  assert.equal(reads, 600);
  for (const route of ['/', '/another-path', '/missing-asset.js']) {
    const blocked = await fetch(`${baseUrl}${route}`);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('Retry-After')) > 0);
    assert.match(await blocked.text(), /Too many requests/);
  }
  assert.equal(checks, 600);
  assert.equal(reads, 600);

  const token = await new SignJWT({ id: 42 })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret));
  for (let request = 0; request < 605; request++) {
    const response = await fetch(`${baseUrl}/authenticated/${request}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(response.status, 200);
    await response.text();
  }
  assert.equal(checks, 1205);
  assert.equal(reads, 1205);

  const asset = await fetch(`${baseUrl}/asset.js`);
  assert.equal(asset.status, 200);
  assert.equal(await asset.text(), 'window.fixtureAsset = true;');
  const api = await fetch(`${baseUrl}/fixture-api`);
  assert.equal(api.status, 200);
  assert.deepEqual(await api.json(), { ok: true });
  assert.equal(checks, 1205);
  assert.equal(reads, 1205);
});

test('forged or expired authentication cannot bypass the unauthenticated failure quota or read HTML', async (t) => {
  const secret = 'client-html-authentication-test-secret';
  const { baseUrl, indexPath } = await fixture(t, { env: { OPEN_BALENA_JWT_SECRET: secret } });
  const forged = await new SignJWT({ id: 42 })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode('wrong-secret'));
  const expired = await new SignJWT({ id: 99 })
    .setProtectedHeader({ alg: 'HS256' })
    .setExpirationTime('1 second ago')
    .sign(new TextEncoder().encode(secret));
  let reads = 0;
  const read = fs.readFileSync;
  t.mock.method(fs, 'readFileSync', (value, options) => {
    if (value === indexPath) reads++;
    return read(value, options);
  });
  for (let request = 0; request < 600; request++) {
    const token = request % 2 ? forged : expired;
    const response = await fetch(`${baseUrl}/`, { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { success: false, message: 'Invalid token' });
  }
  assert.equal((await fetch(`${baseUrl}/`, { headers: { Authorization: 'Bearer another-forged-token' } })).status, 429);
  assert.equal(reads, 0);
});

test('authenticated failures are limited per verified user rather than per token or shared client IP', async (t) => {
  const secret = 'client-html-failure-test-secret';
  const { baseUrl, indexPath } = await fixture(t, { maxRequests: 2, env: { OPEN_BALENA_JWT_SECRET: secret } }, '');
  await rm(indexPath);
  let tokenId = 0;
  const sign = (id?: number) =>
    new SignJWT({ id })
      .setProtectedHeader({ alg: 'HS256' })
      .setJti(String(++tokenId))
      .sign(new TextEncoder().encode(secret));
  for (let request = 0; request < 2; request++) {
    assert.equal((await fetch(`${baseUrl}/`, { headers: { Authorization: `Bearer ${await sign(42)}` } })).status, 404);
  }
  assert.equal((await fetch(`${baseUrl}/`, { headers: { Authorization: `Bearer ${await sign(42)}` } })).status, 429);
  await writeFile(indexPath, '<html>Recovered</html>');
  assert.equal((await fetch(`${baseUrl}/`, { headers: { Authorization: `Bearer ${await sign(99)}` } })).status, 200);
  await rm(indexPath);
  for (let request = 0; request < 2; request++)
    assert.equal((await fetch(`${baseUrl}/`, { headers: { Authorization: `Bearer ${await sign()}` } })).status, 404);
  assert.equal((await fetch(`${baseUrl}/`, { headers: { Authorization: `Bearer ${await sign()}` } })).status, 429);
});

test('HEAD and missing-build requests are protected by the same HTML quota', async (t) => {
  const { baseUrl } = await fixture(t, { maxRequests: 2 });
  const head = await fetch(`${baseUrl}/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(`${baseUrl}/deep-link`)).status, 200);
  assert.equal((await fetch(`${baseUrl}/`, { method: 'HEAD' })).status, 429);
  const missing = await fixture(t, { maxRequests: 1 }, '');
  await rm(missing.indexPath);
  const response = await fetch(`${missing.baseUrl}/`);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), 'Client build not found');
  assert.equal((await fetch(`${missing.baseUrl}/missing`)).status, 429);
});

test('runtime environment injection preserves the allowlist, escaping and actual remote-backend flag', async (t) => {
  const banner = '</script><script>alert("xss")</script>';
  const { baseUrl } = await fixture(t, {
    remoteAccessEnabled: true,
    env: {
      REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test',
      REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED: 'false',
      REACT_APP_BANNER_IMAGE: banner,
      OPEN_BALENA_S3_SECRET_KEY: 'must-not-be-exposed',
    },
  });
  const response = await fetch(`${baseUrl}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type') ?? '', /text\/html/);
  const html = await response.text();
  assert.doesNotMatch(html, /OBUI_RUNTIME_ENV|must-not-be-exposed|<script>alert/);
  const serialized = /window\.__OBUI_ENV__ = Object\.freeze\((.*?)\);/.exec(html)?.[1];
  assert.ok(serialized);
  assert.deepEqual(JSON.parse(serialized), {
    REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED: 'true',
    REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test',
    REACT_APP_BANNER_IMAGE: banner,
  });
});

test('placeholder-free HTML remains unchanged and an unavailable remote backend is never advertised', async (t) => {
  const html = '<html><body>Legacy build</body></html>';
  const plain = await fixture(t, {}, html);
  assert.equal(await (await fetch(`${plain.baseUrl}/deep-link`)).text(), html);
  const unavailable = await fixture(t, {
    env: { REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED: 'true' },
  });
  assert.match(
    await (await fetch(`${unavailable.baseUrl}/`)).text(),
    /"REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED":"false"/,
  );
});
