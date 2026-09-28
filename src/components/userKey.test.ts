import assert from 'node:assert/strict';
import test from 'node:test';
import { canManageAllUserKeys, canManageUserKey } from './userKey';

test('only records containing visible SSH key material are manageable', () => {
  assert.equal(canManageUserKey({ 'id': 1, 'public key': 'ssh-ed25519 test' }), true);
  assert.equal(canManageUserKey({ id: 2, user: 4, title: 'hidden' }), false);
  assert.equal(canManageUserKey(undefined), false);
});

test('legacy and global administrators may manage all SSH keys', () => {
  assert.equal(
    canManageAllUserKeys({
      enforcementEnabled: false,
      globalAdmin: true,
      organizationAdmin: true,
      userId: 2,
      manageableApiKeyIds: [],
    }),
    true,
  );
  assert.equal(
    canManageAllUserKeys({
      enforcementEnabled: true,
      globalAdmin: true,
      organizationAdmin: false,
      userId: 1,
      manageableApiKeyIds: [],
    }),
    true,
  );
  assert.equal(
    canManageAllUserKeys({
      enforcementEnabled: true,
      globalAdmin: false,
      organizationAdmin: true,
      userId: 2,
      manageableApiKeyIds: [],
    }),
    false,
  );
});
