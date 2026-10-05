import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { UserSshKeyManager } from './keys';

const identity = { userId: 7, username: 'alice', token: 'test-token' };
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const fixture = (t: TestContext) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const records = new Set<number>();
  let posts = 0;
  let deletes = 0;
  let deleteRecord = async (_id: number, _authorization: string) => new Response(null, { status: 204 });
  let register = async () => {};
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
    if (options?.method === 'POST') {
      await register();
      records.add(++posts);
      return Response.json([{ id: posts }]);
    }
    if (options?.method === 'DELETE') {
      deletes++;
      const id = Number(new URL(String(input)).searchParams.get('id')?.slice(3));
      const response = await deleteRecord(id, new Headers(options.headers).get('Authorization') ?? '');
      if (response.ok || response.status === 404) records.delete(id);
      return response;
    }
    return Response.json([]);
  });
  t.mock.method(console, 'error', () => {});
  const manager = new UserSshKeyManager('https://db.example.test', 10);
  t.after(() => manager.shutdown());
  return {
    manager,
    records,
    get posts() {
      return posts;
    },
    get deletes() {
      return deletes;
    },
    set deleteRecord(value: typeof deleteRecord) {
      deleteRecord = value;
    },
    set register(value: typeof register) {
      register = value;
    },
  };
};

test('acquisition waits for idle deletion and registers a new key instead of leasing the removed one', async (t) => {
  const api = fixture(t);
  const first = await api.manager.acquire(identity);
  const started = deferred<void>();
  const deletion = deferred<Response>();
  api.deleteRecord = async () => {
    started.resolve();
    return deletion.promise;
  };
  first.release();
  t.mock.timers.tick(10);
  await started.promise;
  let acquired = false;
  const pending = api.manager.acquire(identity).then((lease) => {
    acquired = true;
    return lease;
  });
  await nextTurn();
  assert.equal(acquired, false);
  deletion.resolve(new Response(null, { status: 204 }));
  const second = await pending;
  assert.notEqual(second.privateKey, first.privateKey);
  assert.equal(api.posts, 2);
  assert.deepEqual([...api.records], [2]);
  second.release();
});

test('failed deletion is quarantined and retry must finish before a fresh key can be leased', async (t) => {
  const api = fixture(t);
  const first = await api.manager.acquire(identity);
  api.deleteRecord = async () => new Response(null, { status: 503 });
  first.release();
  t.mock.timers.tick(10);
  await nextTurn();
  assert.equal(api.deletes, 1);
  await assert.rejects(api.manager.acquire(identity), /Unable to remove/);
  assert.equal(api.posts, 1);
  const started = deferred<void>();
  const deletion = deferred<Response>();
  api.deleteRecord = async () => {
    started.resolve();
    return deletion.promise;
  };
  t.mock.timers.tick(1_000);
  await started.promise;
  let acquired = false;
  const pending = api.manager.acquire(identity).then((lease) => {
    acquired = true;
    return lease;
  });
  await nextTurn();
  assert.equal(acquired, false);
  deletion.resolve(new Response(null, { status: 404 }));
  const second = await pending;
  assert.notEqual(second.privateKey, first.privateKey);
  assert.equal(api.posts, 2);
  assert.deepEqual([...api.records], [2]);
  second.release();
});

test('acquisition refreshes an expired deletion token before replacing a quarantined key', async (t) => {
  const api = fixture(t);
  const expiredIdentity = { ...identity, token: 'expired-token' };
  const currentIdentity = { ...identity, token: 'fresh-token' };
  const authorizations: string[] = [];
  api.deleteRecord = async (_id, authorization) => {
    authorizations.push(authorization);
    return new Response(null, { status: authorization === 'Bearer fresh-token' ? 204 : 401 });
  };
  const first = await api.manager.acquire(expiredIdentity);
  first.release();
  t.mock.timers.tick(10);
  await nextTurn();
  assert.deepEqual(authorizations, ['Bearer expired-token']);
  assert.deepEqual([...api.records], [1]);
  const replacement = await api.manager.acquire(currentIdentity);
  assert.deepEqual(authorizations, ['Bearer expired-token', 'Bearer fresh-token']);
  assert.notEqual(replacement.privateKey, first.privateKey);
  assert.equal(api.posts, 2);
  assert.deepEqual([...api.records], [2]);
  replacement.release();
});

test('shutdown waits for an active deletion, rejects queued acquisition, and does not delete twice', async (t) => {
  const api = fixture(t);
  const first = await api.manager.acquire(identity);
  const started = deferred<void>();
  const deletion = deferred<Response>();
  api.deleteRecord = async () => {
    started.resolve();
    return deletion.promise;
  };
  first.release();
  t.mock.timers.tick(10);
  await started.promise;
  const acquisition = assert.rejects(api.manager.acquire(identity), /shutting down/);
  const shutdown = api.manager.shutdown();
  assert.equal(api.manager.shutdown(), shutdown);
  let stopped = false;
  void shutdown.then(() => {
    stopped = true;
  });
  await nextTurn();
  assert.equal(stopped, false);
  deletion.resolve(new Response(null, { status: 204 }));
  await Promise.all([acquisition, shutdown]);
  assert.equal(api.posts, 1);
  assert.equal(api.deletes, 1);
  assert.equal(api.records.size, 0);
  t.mock.timers.tick(60_000);
  await nextTurn();
  assert.equal(api.deletes, 1);
});

test('shutdown during registration removes the new record without handing out a lease', async (t) => {
  const api = fixture(t);
  const started = deferred<void>();
  const registration = deferred<void>();
  api.register = async () => {
    started.resolve();
    await registration.promise;
  };
  const acquisition = assert.rejects(api.manager.acquire(identity), /shutting down/);
  await started.promise;
  const shutdown = api.manager.shutdown();
  registration.resolve();
  await Promise.all([acquisition, shutdown]);
  assert.equal(api.posts, 1);
  assert.equal(api.deletes, 1);
  assert.equal(api.records.size, 0);
  await assert.rejects(api.manager.acquire(identity), /shutting down/);
});

test('shutdown retries an in-flight failed deletion without scheduling later cleanup', async (t) => {
  const api = fixture(t);
  const first = await api.manager.acquire(identity);
  const started = deferred<void>();
  const deletion = deferred<Response>();
  api.deleteRecord = async () => {
    if (api.deletes === 1) {
      started.resolve();
      return deletion.promise;
    }
    return new Response(null, { status: 204 });
  };
  first.release();
  t.mock.timers.tick(10);
  await started.promise;
  const shutdown = api.manager.shutdown();
  deletion.resolve(new Response(null, { status: 503 }));
  await shutdown;
  assert.equal(api.deletes, 2);
  assert.equal(api.records.size, 0);
  t.mock.timers.tick(60_000);
  await nextTurn();
  assert.equal(api.deletes, 2);
});

test('simultaneous acquisitions share registration and cancel idle cleanup while leased', async (t) => {
  const api = fixture(t);
  const [first, second] = await Promise.all([api.manager.acquire(identity), api.manager.acquire(identity)]);
  assert.equal(first.privateKey, second.privateKey);
  assert.equal(api.posts, 1);
  first.release();
  first.release();
  t.mock.timers.tick(10);
  await nextTurn();
  assert.equal(api.deletes, 0);
  second.release();
  const third = await api.manager.acquire(identity);
  t.mock.timers.tick(10);
  await nextTurn();
  assert.equal(third.privateKey, first.privateKey);
  assert.equal(api.deletes, 0);
  third.release();
});
