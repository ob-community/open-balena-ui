import assert from 'node:assert/strict';
import test from 'node:test';
import { compareSync } from 'bcrypt-ts';
import { requestHeaders } from './routes/adminDatabase';
import { hashPassword } from '../src/lib/password';

test('PostgREST proxy preserves a caller-provided Accept header', () => {
  const headers = requestHeaders('Bearer token', {
    Accept: 'application/vnd.pgrst.object+json',
  });

  assert.equal(headers.get('Accept'), 'application/vnd.pgrst.object+json');
  assert.equal(headers.get('Authorization'), 'Bearer token');
});

test('PostgREST proxy defaults Accept when the caller does not provide one', () => {
  assert.equal(requestHeaders('Bearer token').get('Accept'), 'application/json');
});

test('password hashing preserves a verifiable bcrypt digest', () => {
  const password = 'Valid1!password';
  const hash = hashPassword(password);

  assert.match(hash, /^\$2[ab]\$/);
  assert.equal(compareSync(password, hash), true);
});
