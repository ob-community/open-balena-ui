import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapGlobalAdmin } from './bootstrapGlobalAdmin';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

test('startup bootstrap creates the missing role and assignment', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const responses = [
    jsonResponse(200, [{ id: 2 }]),
    jsonResponse(200, []),
    jsonResponse(201, { id: 9, name: 'global-admin' }),
    jsonResponse(200, []),
    new Response(null, { status: 201 }),
  ];

  await bootstrapGlobalAdmin({
    postgrestUrl: 'https://postgrest.example.test',
    jwtSecret: 'test-secret',
    userId: 2,
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), init });
      return responses.shift()!;
    },
  });

  assert.equal(requests[2].url, 'https://postgrest.example.test/role');
  assert.deepEqual(JSON.parse(String(requests[2].init?.body)), { name: 'global-admin' });
  assert.equal(requests[4].url, 'https://postgrest.example.test/user-has-role');
  assert.deepEqual(JSON.parse(String(requests[4].init?.body)), { user: 2, role: 9 });
});

test('startup bootstrap repairs a missing assignment for an existing role', async () => {
  const requests: string[] = [];
  const responses = [
    jsonResponse(200, [{ id: 2 }]),
    jsonResponse(200, [{ id: 9, name: 'global-admin' }]),
    jsonResponse(200, []),
    new Response(null, { status: 201 }),
  ];

  await bootstrapGlobalAdmin({
    postgrestUrl: 'https://postgrest.example.test',
    jwtSecret: 'test-secret',
    userId: 2,
    fetchImpl: async (url) => {
      requests.push(String(url));
      return responses.shift()!;
    },
  });

  assert.equal(requests[requests.length - 1], 'https://postgrest.example.test/user-has-role');
});
