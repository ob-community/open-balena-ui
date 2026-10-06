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

const fixture = (t: TestContext, connectTimeoutMs = 100) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const records = new Set<number>();
  let posts = 0;
  let deletes = 0;
  let deleteRecord = async (_id: number, _authorization: string) => new Response(null, { status: 204 });
  let register = async () => {};
  let lookup = async () => Response.json([]);
  let registrationResponse = (id: number) => Response.json([{ id }]);
  const signals: AbortSignal[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, options?: RequestInit) => {
    if (options?.signal) signals.push(options.signal);
    if (options?.method === 'POST') {
      await register();
      options?.signal?.throwIfAborted();
      records.add(++posts);
      return registrationResponse(posts);
    }
    if (options?.method === 'DELETE') {
      deletes++;
      const id = Number(new URL(String(input)).searchParams.get('id')?.slice(3));
      const response = await deleteRecord(id, new Headers(options.headers).get('Authorization') ?? '');
      if (response.ok || response.status === 404) records.delete(id);
      return response;
    }
    return lookup();
  });
  t.mock.method(console, 'error', () => {});
  const manager = new UserSshKeyManager('https://db.example.test', 10, connectTimeoutMs);
  t.after(() => manager.shutdown());
  return {
    manager,
    records,
    signals,
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
    set lookup(value: typeof lookup) {
      lookup = value;
    },
    set registrationResponse(value: typeof registrationResponse) {
      registrationResponse = value;
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

test('cancelling the registering caller does not abort shared work or the next caller', async (t) => {
  const api = fixture(t);
  const started = deferred<void>();
  const registration = deferred<void>();
  api.register = async () => {
    started.resolve();
    await registration.promise;
  };
  const controller = new AbortController();
  const cancelled = assert.rejects(api.manager.acquire(identity, controller.signal), /aborted/);
  await started.promise;
  const pending = api.manager.acquire({ ...identity, token: 'fresh-token' });
  controller.abort();
  await cancelled;
  assert.ok(
    api.signals.every((signal) => !signal.aborted),
    'caller cancellation must not abort shared HTTP',
  );
  registration.resolve();
  const lease = await pending;
  assert.equal(api.posts, 1);
  t.mock.timers.tick(10);
  await nextTurn();
  assert.equal(api.deletes, 0, 'cancelled reference must not delete the other caller’s key');
  let deletionAuthorization = '';
  api.deleteRecord = async (_id, authorization) => {
    deletionAuthorization = authorization;
    return new Response(null, { status: 204 });
  };
  lease.release();
  t.mock.timers.tick(10);
  await nextTurn();
  assert.equal(api.deletes, 1, 'cancelled caller must not leak a reference');
  assert.equal(deletionAuthorization, ['Bearer', 'fresh-token'].join(' '));
  assert.equal(api.records.size, 0);
});

test('cancelling a queued acquisition settles promptly without registering or taking a reference', async (t) => {
  const api = fixture(t);
  const started = deferred<void>();
  const registration = deferred<void>();
  api.register = async () => {
    started.resolve();
    await registration.promise;
  };
  const first = api.manager.acquire(identity);
  await started.promise;
  const controller = new AbortController();
  const cancelled = assert.rejects(api.manager.acquire(identity, controller.signal), /aborted/);
  controller.abort();
  await cancelled;
  assert.equal(api.posts, 0);
  registration.resolve();
  const lease = await first;
  lease.release();
  t.mock.timers.tick(10);
  await nextTurn();
  assert.equal(api.posts, 1);
  assert.equal(api.deletes, 1);
  assert.equal(api.records.size, 0);
});

test('a registration completed after its sole caller aborts is released and removed', async (t) => {
  const api = fixture(t);
  const started = deferred<void>();
  const registration = deferred<void>();
  api.register = async () => {
    started.resolve();
    await registration.promise;
  };
  const controller = new AbortController();
  const cancelled = assert.rejects(api.manager.acquire(identity, controller.signal), /aborted/);
  await started.promise;
  controller.abort();
  await cancelled;
  registration.resolve();
  await nextTurn();
  assert.equal(api.posts, 1);
  t.mock.timers.tick(10);
  await nextTurn();
  assert.equal(api.deletes, 1);
  assert.equal(api.records.size, 0);
});

test('an already aborted acquisition does not enter the queue or call HTTP', async (t) => {
  const api = fixture(t);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(api.manager.acquire(identity, controller.signal), /aborted/);
  assert.equal(api.signals.length, 0);
});

const stalledBody = () => {
  let finish!: () => void;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        finish = () => {
          controller.enqueue(new TextEncoder().encode('[]'));
          controller.close();
        };
      },
    }),
  );
  return { response, finish };
};

for (const operation of ['lookup', 'registration', 'orphan deletion', 'idle deletion', 'shutdown deletion'] as const) {
  for (const phase of ['headers', 'body'] as const) {
    test(`${operation} stalled ${phase} hits its deadline and allows the queue to recover`, async (t) => {
      const api = fixture(t);
      const started = deferred<void>();
      const headers = deferred<Response>();
      const body = stalledBody();
      const stall = async () => {
        started.resolve();
        return phase === 'headers' ? headers.promise : body.response;
      };
      let lease: Awaited<ReturnType<UserSshKeyManager['acquire']>> | undefined;
      if (operation === 'idle deletion' || operation === 'shutdown deletion') {
        lease = await api.manager.acquire(identity);
        api.deleteRecord = stall;
      } else if (operation === 'lookup') {
        api.lookup = stall;
      } else if (operation === 'registration') {
        if (phase === 'headers') {
          api.register = async () => {
            started.resolve();
            await headers.promise;
          };
        } else {
          api.registrationResponse = () => {
            started.resolve();
            return body.response;
          };
        }
      } else {
        api.lookup = async () => Response.json([{ id: 99, title: 'open-balena-ui-ephemeral-1-old' }]);
        api.records.add(99);
        api.deleteRecord = stall;
      }

      let failed: Promise<unknown>;
      if (operation === 'shutdown deletion') {
        failed = api.manager.shutdown();
      } else if (operation === 'idle deletion') {
        lease!.release();
        t.mock.timers.tick(10);
        failed = Promise.resolve();
      } else {
        failed = assert.rejects(api.manager.acquire(identity), /timed out/);
      }
      await started.promise;
      const stalledSignal = api.signals[api.signals.length - 1];
      const pending =
        operation === 'shutdown deletion' ? undefined : api.manager.acquire({ ...identity, token: 'fresh-token' });
      // Only the in-flight operation stalls; the queued operation must recover from its timeout.
      api.lookup = async () => Response.json([]);
      api.register = async () => {};
      api.registrationResponse = (id) => Response.json([{ id }]);
      api.deleteRecord = async () => new Response(null, { status: 204 });
      t.mock.timers.tick(99);
      await nextTurn();
      assert.equal(stalledSignal.aborted, false);
      t.mock.timers.tick(1);
      await failed;
      assert.equal(stalledSignal.aborted, true);
      if (pending) {
        const recovered = await pending;
        assert.ok(recovered.privateKey);
        recovered.release();
        t.mock.timers.tick(10);
        await nextTurn();
        if (lease) assert.notEqual(recovered.privateKey, lease.privateKey, 'a timed-out DELETE quarantines the key');
      } else {
        await api.manager.shutdown();
        await assert.rejects(api.manager.acquire(identity), /shutting down/);
      }
      if (phase === 'headers') headers.resolve(new Response(null, { status: 204 }));
      else body.finish();
      await nextTurn();
    });
  }
}

test('shutdown retries a timed-out idle DELETE under a separate bounded deadline', async (t) => {
  const api = fixture(t);
  const lease = await api.manager.acquire(identity);
  api.deleteRecord = async () => new Promise<Response>(() => {});
  lease.release();
  t.mock.timers.tick(10);
  await nextTurn();
  const shutdown = api.manager.shutdown();
  t.mock.timers.tick(100);
  await nextTurn();
  assert.equal(api.deletes, 2);
  t.mock.timers.tick(100);
  await shutdown;
  assert.ok(api.signals.slice(-2).every((signal) => signal.aborted));
  t.mock.timers.tick(60_000);
  await nextTurn();
  assert.equal(api.deletes, 2);
});

test('the HTTP deadline includes header latency and does not restart for the body', async (t) => {
  const api = fixture(t);
  const headers = deferred<Response>();
  const body = stalledBody();
  api.lookup = async () => headers.promise;
  const acquisition = assert.rejects(api.manager.acquire(identity), /timed out/);
  await nextTurn();
  const signal = api.signals[0];
  t.mock.timers.tick(60);
  headers.resolve(body.response);
  await nextTurn();
  t.mock.timers.tick(39);
  await nextTurn();
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await acquisition;
  assert.equal(signal.aborted, true);
  body.finish();
});

test('the manager defaults every HTTP deadline to fifteen seconds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const manager = new UserSshKeyManager('https://db.example.test', 10);
  t.after(() => manager.shutdown());
  t.mock.method(globalThis, 'fetch', async () => new Promise<Response>(() => {}));
  let failed = false;
  const acquisition = assert.rejects(manager.acquire(identity), /timed out/).then(() => {
    failed = true;
  });
  await nextTurn();
  t.mock.timers.tick(14_999);
  await nextTurn();
  assert.equal(failed, false);
  t.mock.timers.tick(1);
  await acquisition;
});
