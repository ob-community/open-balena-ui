import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import express from 'express';
import { SignJWT } from 'jose';
import { createRemoteAccessBackend } from './index';
import { loadRemoteAccessConfig } from './config';
import { TicketLimitError, TicketStore } from './tickets';

const origin = 'https://ui.example.test';
const uuid = 'a'.repeat(32);
const alice = { userId: 1, username: 'alice', token: 'test-token' };
const bob = { userId: 2, username: 'bob', token: 'test-token' };
const carol = { userId: 3, username: 'carol', token: 'test-token' };

test('pending tickets have independent user and process caps released by consumption', (t) => {
  const tickets = new TicketStore(30_000, { maxPerUser: 2, maxTotal: 3 });
  t.after(() => tickets.clear());
  const first = tickets.issue(alice, uuid, origin);
  const second = tickets.issue(alice, uuid, origin);
  assert.throws(() => tickets.issue(alice, uuid, origin), TicketLimitError);
  tickets.issue(bob, uuid, origin);
  assert.throws(() => tickets.issue(carol, uuid, origin), TicketLimitError);
  assert.equal(tickets.size, 3);
  assert.equal(tickets.consume(first.ticket, origin)?.identity.userId, alice.userId);
  tickets.issue(carol, uuid, origin);
  assert.equal(tickets.consume(second.ticket, 'https://wrong.example.test'), undefined);
  tickets.issue(alice, uuid, origin);
  assert.equal(tickets.size, 3);
});

test('expired tickets are removed by a timer without issuing or consuming another ticket', async (t) => {
  const tickets = new TicketStore(20, { maxPerUser: 1, maxTotal: 1 });
  t.after(() => tickets.clear());
  tickets.issue(alice, uuid, origin);
  assert.equal(tickets.size, 1);
  await delay(60);
  assert.equal(tickets.size, 0);
  assert.doesNotThrow(() => tickets.issue(alice, uuid, origin));
});

test('clearing tickets releases counts and stops cleanup while preserving later reuse', async (t) => {
  const tickets = new TicketStore(20, { maxPerUser: 1, maxTotal: 1 });
  t.after(() => tickets.clear());
  const issued = tickets.issue(alice, uuid, origin);
  tickets.clear();
  assert.equal(tickets.size, 0);
  assert.equal(tickets.consume(issued.ticket, origin), undefined);
  const replacement = tickets.issue(alice, uuid, origin);
  assert.equal(tickets.consume(replacement.ticket, origin)?.identity.username, 'alice');
  await delay(40);
  assert.equal(tickets.size, 0);
});

test('ticket lifetimes and limits reject invalid numeric configuration', () => {
  for (const value of [0, -1, NaN, Infinity, 1.5]) {
    assert.throws(() => new TicketStore(value), /positive safe integers/);
    assert.throws(() => new TicketStore(30_000, { maxPerUser: value }), /positive safe integers/);
    assert.throws(() => new TicketStore(30_000, { maxTotal: value }), /positive safe integers/);
  }
});

test('authorized ticket issuance returns explicit HTTP 429 and Retry-After at the configured cap', async (t) => {
  const secret = 'pending-ticket-route-test-secret';
  const previous = process.env.OPEN_BALENA_JWT_SECRET;
  process.env.OPEN_BALENA_JWT_SECRET = secret;
  t.after(() => {
    if (previous === undefined) delete process.env.OPEN_BALENA_JWT_SECRET;
    else process.env.OPEN_BALENA_JWT_SECRET = previous;
  });
  const backend = createRemoteAccessBackend(
    loadRemoteAccessConfig({
      OPEN_BALENA_TUNNEL_URL: 'https://tunnel.example.test',
      OPEN_BALENA_POSTGREST_URL: 'https://database.example.test',
      REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test',
      OPEN_BALENA_REMOTE_MAX_PENDING_TICKETS_PER_USER: '1',
      OPEN_BALENA_REMOTE_MAX_PENDING_TICKETS: '2',
    }),
  );
  t.after(() => backend.shutdown());
  const app = express();
  app.use(backend.router);
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
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const originalFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === 'https://api.example.test/user/v1/whoami') {
      return Promise.resolve(Response.json({ id: alice.userId, username: alice.username }));
    }
    if (url === `https://api.example.test/access/v1/hostos/${uuid}`) {
      return Promise.resolve(Response.json({ allowed: true }));
    }
    assert.ok(url.startsWith(baseUrl), `Unexpected network request: ${url}`);
    return originalFetch(input, init);
  });
  const token = await new SignJWT({ id: alice.userId })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(secret));
  const request = () =>
    fetch(`${baseUrl}/remote/session`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Origin': baseUrl,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ deviceUuid: uuid }),
    });
  const issued = await request();
  assert.equal(issued.status, 201);
  assert.match((await issued.json()).ticket, /^[A-Za-z0-9_-]{43}$/);
  const limited = await request();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '30');
  assert.deepEqual(await limited.json(), {
    error: 'ticket_limit',
    message: 'Too many pending terminal tickets. Connect or wait for existing tickets to expire.',
  });
});
