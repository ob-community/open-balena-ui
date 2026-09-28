import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { SignJWT } from 'jose';
import authorize, { type AuthorizedLocals } from './middleware/authorize';

const JWT_SECRET = 'authorize-test-secret';

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

test('authorize accepts only strictly formatted, valid HS256 bearer tokens', async (t) => {
  const originalSecret = process.env.OPEN_BALENA_JWT_SECRET;
  process.env.OPEN_BALENA_JWT_SECRET = JWT_SECRET;

  const app = express();
  let protectedHandlerCalls = 0;
  app.get('/protected', authorize, (_req, res) => {
    protectedHandlerCalls += 1;
    res.json({ auth: (res.locals as AuthorizedLocals).auth });
  });

  const server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/protected`;
  const request = (authorization?: string): Promise<Response> =>
    fetch(url, authorization === undefined ? undefined : { headers: { Authorization: authorization } });

  const sign = (secret: string, algorithm: 'HS256' | 'HS384' = 'HS256', expiration?: string): Promise<string> => {
    let token = new SignJWT({ id: 42, username: 'authorized-user' }).setProtectedHeader({ alg: algorithm });
    if (expiration) token = token.setExpirationTime(expiration);
    return token.sign(new TextEncoder().encode(secret));
  };

  try {
    await t.test('rejects missing and malformed credentials', async () => {
      const initialCalls = protectedHandlerCalls;
      const validToken = await sign(JWT_SECRET);
      const credentials: Array<string | undefined> = [
        undefined,
        'Basic credentials',
        'Bearer ',
        'Bearer malformed',
        `Bearer ${validToken} trailing`,
        `Bearer ${validToken} Bearer ${validToken}`,
      ];

      for (const authorization of credentials) {
        const response = await request(authorization);
        assert.equal(response.status, 401, authorization);
        assert.deepEqual(await response.json(), { success: false, message: 'Invalid token' });
      }
      assert.equal(protectedHandlerCalls, initialCalls);
    });

    await t.test('rejects invalid signatures, expired tokens, and non-HS256 algorithms', async () => {
      const initialCalls = protectedHandlerCalls;
      const invalidTokens = [
        await sign('wrong-secret'),
        await sign(JWT_SECRET, 'HS256', '1 second ago'),
        await sign(JWT_SECRET, 'HS384'),
      ];

      for (const token of invalidTokens) {
        const response = await request(`Bearer ${token}`);
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { success: false, message: 'Invalid token' });
      }
      assert.equal(protectedHandlerCalls, initialCalls);
    });

    await t.test('rejects valid tokens when the server secret is unavailable', async () => {
      const initialCalls = protectedHandlerCalls;
      const token = await sign(JWT_SECRET);
      delete process.env.OPEN_BALENA_JWT_SECRET;

      try {
        const response = await request(`Bearer ${token}`);
        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), { success: false, message: 'Invalid token' });
        assert.equal(protectedHandlerCalls, initialCalls);
      } finally {
        process.env.OPEN_BALENA_JWT_SECRET = JWT_SECRET;
      }
    });

    await t.test('passes verified claims to the protected handler', async () => {
      const token = await sign(JWT_SECRET);
      const response = await request(`Bearer ${token}`);

      assert.equal(response.status, 200);
      const body = (await response.json()) as { auth: { id: number; username: string } };
      assert.equal(body.auth.id, 42);
      assert.equal(body.auth.username, 'authorized-user');
      assert.equal(protectedHandlerCalls, 1);
    });
  } finally {
    await closeServer(server);
    if (originalSecret == null) delete process.env.OPEN_BALENA_JWT_SECRET;
    else process.env.OPEN_BALENA_JWT_SECRET = originalSecret;
  }
});
