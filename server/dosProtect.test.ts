import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { SignJWT } from 'jose';
import dosProtect from './middleware/dosProtect';
import authorize from './middleware/authorize';

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

test('successful authenticated requests do not consume the failed-request rate limit', async (t) => {
  const secret = 'dos-protect-test-secret';
  const previous = process.env.OPEN_BALENA_JWT_SECRET;
  process.env.OPEN_BALENA_JWT_SECRET = secret;
  t.after(() => {
    if (previous === undefined) delete process.env.OPEN_BALENA_JWT_SECRET;
    else process.env.OPEN_BALENA_JWT_SECRET = previous;
  });
  const token = await new SignJWT({ id: 42 })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret));
  const headers = { Authorization: `Bearer ${token}` };
  const app = express();
  app.get('/success', ...dosProtect, authorize, (_req, res) => res.sendStatus(204));
  app.get('/failure', ...dosProtect, authorize, (_req, res) => res.sendStatus(401));
  const server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    for (let request = 0; request < 110; request += 1) {
      assert.equal((await fetch(`${baseUrl}/success`, { headers })).status, 204);
    }

    const failedRequests = await Promise.all(
      Array.from({ length: 101 }, () => fetch(`${baseUrl}/failure`, { headers }).then(({ status }) => status)),
    );
    assert.equal(failedRequests.filter((status) => status === 401).length, 100);
    assert.equal(failedRequests.filter((status) => status === 429).length, 1);
  } finally {
    await closeServer(server);
  }
});
