import assert from 'node:assert/strict';
import test from 'node:test';
import { compareSync } from 'bcrypt-ts';
import { bodyContainsUserCredentials, preferUsesUpsert, requestHeaders } from './routes/adminDatabase';
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

test('generic user mutations detect credential fields', () => {
  assert.equal(bodyContainsUserCredentials({ username: 'admin' }), false);
  assert.equal(bodyContainsUserCredentials({ password: 'secret' }), true);
  assert.equal(bodyContainsUserCredentials({ 'jwt secret': 'secret' }), true);
  assert.equal(bodyContainsUserCredentials([{ username: 'one' }, { jwt_secret: 'secret' }]), true);
});

test('PostgREST upsert preferences are detected', () => {
  assert.equal(preferUsesUpsert(undefined), false);
  assert.equal(preferUsesUpsert('return=representation'), false);
  assert.equal(preferUsesUpsert('resolution=merge-duplicates,return=representation'), true);
});
