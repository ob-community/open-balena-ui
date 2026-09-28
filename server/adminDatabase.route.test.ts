import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { SignJWT } from 'jose';
import adminDatabaseRoutes from './routes/adminDatabase';

const JWT_SECRET = 'route-test-secret';
const POSTGREST_URL = 'https://postgrest.example.test';
const API_URL = 'https://api.example.test';

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

const withAdminDatabaseRoute = async (
  upstreamFetch: typeof fetch,
  run: (url: string, authorization: string, requestFetch: typeof fetch) => Promise<void>,
): Promise<void> => {
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.OPEN_BALENA_JWT_SECRET;
  const originalPostgrestUrl = process.env.OPEN_BALENA_POSTGREST_URL;
  const originalApiUrl = process.env.REACT_APP_OPEN_BALENA_API_URL;
  process.env.OPEN_BALENA_JWT_SECRET = JWT_SECRET;
  process.env.OPEN_BALENA_POSTGREST_URL = POSTGREST_URL;
  process.env.REACT_APP_OPEN_BALENA_API_URL = API_URL;
  globalThis.fetch = upstreamFetch;

  const app = express();
  app.use(adminDatabaseRoutes);
  const server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const address = server.address() as AddressInfo;
  const authorization = `Bearer ${await new SignJWT({ id: 1 })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(JWT_SECRET))}`;

  try {
    await run(`http://127.0.0.1:${address.port}`, authorization, originalFetch);
  } finally {
    await closeServer(server);
    globalThis.fetch = originalFetch;
    if (originalSecret == null) delete process.env.OPEN_BALENA_JWT_SECRET;
    else process.env.OPEN_BALENA_JWT_SECRET = originalSecret;
    if (originalPostgrestUrl == null) delete process.env.OPEN_BALENA_POSTGREST_URL;
    else process.env.OPEN_BALENA_POSTGREST_URL = originalPostgrestUrl;
    if (originalApiUrl == null) delete process.env.REACT_APP_OPEN_BALENA_API_URL;
    else process.env.REACT_APP_OPEN_BALENA_API_URL = originalApiUrl;
  }
};

const legacyContextResponse = (url: URL): Response | undefined => {
  const resource = decodeURIComponent(url.pathname.slice(1));
  if (resource === 'role') {
    return jsonResponse([]);
  }
  if (resource === 'user' && url.searchParams.get('id') === 'eq.1') {
    return jsonResponse([{ id: 1, actor: 10, username: 'admin' }]);
  }
  if (resource === 'user-has-public key' && url.searchParams.get('user') === 'eq.1') {
    return jsonResponse([]);
  }
  if (resource === 'application' && !url.search) {
    return jsonResponse([]);
  }
  if (resource === 'api key' && url.searchParams.get('is of-actor') === 'in.(10)') {
    return jsonResponse([]);
  }
  return undefined;
};

test('failed user deletion restores every removed authorization relation', async () => {
  const relationRecords = new Map([
    ['user-has-direct access to-application', [{ 'id': 11, 'user': 2, 'has direct access to-application': 31 }]],
    ['user-has-permission', [{ id: 12, user: 2, permission: 32 }]],
    ['user-has-public key', [{ 'id': 13, 'user': 2, 'public key': 'ssh-ed25519 test' }]],
    ['user-has-role', [{ id: 14, user: 2, role: 33 }]],
    ['organization membership', [{ 'id': 15, 'user': 2, 'is member of-organization': 34 }]],
  ]);
  const deleted: string[] = [];
  const restored = new Map<string, unknown>();
  const upstreamFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const legacyResponse = method === 'GET' ? legacyContextResponse(url) : undefined;
    if (legacyResponse) return legacyResponse;

    const resource = decodeURIComponent(url.pathname.slice(1));
    if (method === 'GET' && resource === 'user' && url.searchParams.get('id') === 'eq.2') {
      return jsonResponse([{ id: 2, actor: 20 }]);
    }
    if (method === 'GET' && url.searchParams.get('user') === 'eq.2' && relationRecords.has(resource)) {
      return jsonResponse(relationRecords.get(resource));
    }
    if (method === 'DELETE' && url.searchParams.get('user') === 'eq.2' && relationRecords.has(resource)) {
      deleted.push(resource);
      return new Response(null, { status: 204 });
    }
    if (method === 'DELETE' && resource === 'user' && url.searchParams.get('id') === 'eq.2') {
      return jsonResponse({ message: 'temporary failure' }, 503);
    }
    if (method === 'POST' && relationRecords.has(resource)) {
      restored.set(resource, JSON.parse(String(init?.body)));
      return new Response(null, { status: 201 });
    }
    throw new Error(`Unexpected upstream request: ${method} ${url}`);
  };

  await withAdminDatabaseRoute(upstreamFetch, async (url, authorization, requestFetch) => {
    const response = await requestFetch(`${url}/admin-db/actions/delete-resource-actor`, {
      method: 'POST',
      headers: { 'Authorization': authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ resource: 'user', id: 2, actorId: 20 }),
    });

    assert.equal(response.status, 502);
    assert.deepEqual(deleted, [...relationRecords.keys()]);
    assert.deepEqual([...restored.keys()], [...relationRecords.keys()].reverse());
    for (const [resource, records] of relationRecords) {
      assert.deepEqual(restored.get(resource), records);
    }
  });
});

test('orphaned actor cleanup succeeds when retried after a transient actor deletion failure', async () => {
  let actorDeletionAttempts = 0;
  const upstreamFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const legacyResponse = method === 'GET' ? legacyContextResponse(url) : undefined;
    if (legacyResponse) return legacyResponse;

    const resource = decodeURIComponent(url.pathname.slice(1));
    if (
      method === 'GET' &&
      ((resource === 'user' && url.searchParams.get('id') === 'eq.2') ||
        ['application', 'device', 'user'].includes(resource) ||
        resource === 'api key')
    ) {
      return jsonResponse([]);
    }
    if (method === 'DELETE' && resource === 'actor' && url.searchParams.get('id') === 'eq.20') {
      actorDeletionAttempts += 1;
      return actorDeletionAttempts === 1
        ? jsonResponse({ message: 'temporary failure' }, 503)
        : new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected upstream request: ${method} ${url}`);
  };

  await withAdminDatabaseRoute(upstreamFetch, async (url, authorization, requestFetch) => {
    const deleteOrphan = () =>
      requestFetch(`${url}/admin-db/actions/delete-resource-actor`, {
        method: 'POST',
        headers: { 'Authorization': authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ resource: 'user', id: 2, actorId: 20 }),
      });

    assert.equal((await deleteOrphan()).status, 502);
    const retryResponse = await deleteOrphan();
    assert.equal(retryResponse.status, 200);
    assert.deepEqual(await retryResponse.json(), { id: 2 });
    assert.equal(actorDeletionAttempts, 2);
  });
});

test('non-JSON PostgREST responses report an explicit upstream configuration error', async () => {
  const upstreamFetch: typeof fetch = async () =>
    new Response('<!DOCTYPE html><title>Not PostgREST</title>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });

  await withAdminDatabaseRoute(upstreamFetch, async (url, authorization, requestFetch) => {
    const response = await requestFetch(`${url}/admin-db/user?limit=10`, {
      headers: { Authorization: authorization },
    });

    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
      code: 'ADMIN_DB_UPSTREAM_ERROR',
      message: 'PostgREST returned a non-JSON response. Verify OPEN_BALENA_POSTGREST_URL points directly to PostgREST.',
    });
  });
});

test('access-context action reports intentional legacy global access', async () => {
  const upstreamFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const response = (init?.method ?? 'GET') === 'GET' ? legacyContextResponse(url) : undefined;
    if (response) {
      return response;
    }
    throw new Error(`Unexpected upstream request: ${init?.method ?? 'GET'} ${url}`);
  };

  await withAdminDatabaseRoute(upstreamFetch, async (url, authorization, requestFetch) => {
    const response = await requestFetch(`${url}/admin-db/actions/access-context`, {
      headers: { Authorization: authorization },
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      enforcementEnabled: false,
      globalAdmin: true,
      organizationAdmin: true,
      userId: 1,
      username: 'admin',
      ownActorId: 10,
    });
  });
});
