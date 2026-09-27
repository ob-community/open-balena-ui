import assert from 'node:assert/strict';
import test from 'node:test';
import authProvider from './openbalenaAuthProvider';

const installLocalStorage = () => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => values.delete(key),
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
  return values;
};

const unsignedToken = (payload: Record<string, unknown>): string =>
  [
    Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify(payload)).toString('base64url'),
    '',
  ].join('.');

test('authentication failures clear the stored token and reject', async () => {
  const values = installLocalStorage();
  values.set('auth', 'expired-token');

  await assert.rejects(authProvider.checkError({ status: 401 }));
  assert.equal(values.has('auth'), false);
});

test('administrator authorization denials preserve the stored token', async () => {
  const values = installLocalStorage();
  values.set('auth', 'valid-token');

  await authProvider.checkError({ status: 403, body: { code: 'ADMIN_DB_FORBIDDEN' } });
  assert.equal(values.get('auth'), 'valid-token');
});

test('identity is derived from the authenticated JWT', async () => {
  const values = installLocalStorage();
  values.set('auth', unsignedToken({ id: 42, username: 'test-user' }));

  assert.deepEqual(await authProvider.getIdentity!(), {
    id: 42,
    fullName: 'test-user',
  });
});
