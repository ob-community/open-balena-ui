import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { type TestContext } from 'node:test';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { SignJWT, type JWTPayload } from 'jose';
import {
  authenticatedRequestSucceeded,
  createAuthenticationRateKey,
  rejectInvalidAuthentication,
} from './middleware/authenticationRateLimit';

const secret = 'authentication-rate-key-test-secret';

const sign = (signingSecret = secret, algorithm = 'HS256', expired = false) => {
  const token = new SignJWT({ id: 42 }).setProtectedHeader({ alg: algorithm });
  if (expired) token.setExpirationTime('1 second ago');
  return token.sign(new TextEncoder().encode(signingSecret));
};

const fixture = async (t: TestContext, maxRequests = 20, signingSecret: () => string | undefined = () => secret) => {
  const app = express();
  const protect = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: maxRequests,
    skipSuccessfulRequests: true,
    requestWasSuccessful: authenticatedRequestSucceeded,
    keyGenerator: createAuthenticationRateKey(signingSecret),
  });
  app.use((_req, res, next) => {
    res.locals.auth = { id: 999 };
    next();
  });
  app.get('/', protect, rejectInvalidAuthentication, (req, res) => {
    const auth = res.locals.auth as JWTPayload | undefined;
    res.json({ authenticated: authenticatedRequestSucceeded(req, res), id: auth?.id ?? null });
  });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}/`;
};

test('only verified HS256 credentials grant the authenticated rate-limit classification', async (t) => {
  const url = await fixture(t);
  const cases = [
    { authorization: undefined, status: 200, authenticated: false },
    { authorization: '', status: 401 },
    { authorization: 'Basic invalid', status: 401 },
    { authorization: 'Bearer malformed', status: 401 },
    { authorization: `Bearer ${await sign('wrong-secret')}`, status: 401 },
    { authorization: `Bearer ${await sign(secret, 'HS384')}`, status: 401 },
    { authorization: `Bearer ${await sign(secret, 'HS256', true)}`, status: 401 },
    { authorization: `Bearer ${await sign()}`, status: 200, authenticated: true },
  ];
  for (const { authorization, status, authenticated } of cases) {
    const headers = new Headers();
    if (authorization !== undefined) headers.set('Authorization', authorization);
    const response = await fetch(url, { headers });
    assert.equal(response.status, status);
    assert.deepEqual(
      await response.json(),
      status === 401 ? { success: false, message: 'Invalid token' } : { authenticated, id: authenticated ? 42 : null },
    );
  }
});

test('missing and invalid credentials share a bounded quota without exhausting verified-user successes', async (t) => {
  const url = await fixture(t, 2);
  const anonymous = await fetch(url);
  assert.equal(anonymous.status, 200);
  assert.deepEqual(await anonymous.json(), { authenticated: false, id: null });
  const malformed = await fetch(url, { headers: { Authorization: 'Bearer malformed' } });
  assert.equal(malformed.status, 401);
  await malformed.json();
  const forged = await fetch(url, { headers: { Authorization: `Bearer ${await sign('wrong-secret')}` } });
  assert.equal(forged.status, 429);
  await forged.text();
  for (let request = 0; request < 5; request++) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${await sign()}` } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: true, id: 42 });
  }
  const exhausted = await fetch(url);
  assert.equal(exhausted.status, 429);
  await exhausted.text();
});

test('a missing verification secret cannot reuse existing authentication or grant an exemption', async (t) => {
  const url = await fixture(t, 1, () => undefined);
  const headers = { Authorization: `Bearer ${await sign()}` };
  const rejected = await fetch(url, { headers });
  assert.equal(rejected.status, 401);
  assert.deepEqual(await rejected.json(), { success: false, message: 'Invalid token' });
  const exhausted = await fetch(url, { headers });
  assert.equal(exhausted.status, 429);
  await exhausted.text();
});
