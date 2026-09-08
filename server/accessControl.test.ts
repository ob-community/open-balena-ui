import assert from 'node:assert/strict';
import test from 'node:test';
import {
  authorizeAdministratorRoleCreation,
  authorizeCredentialActorProvision,
  authorizeMutationBody,
  authorizePasswordChange,
  authorizePreActivationAssignment,
  authorizeProtectedRoleMutation,
  authorizeResource,
  authorizeSelfLockoutMutation,
  buildAccessContext,
  queryReferencesCredential,
  queryUsesUnsafeEmbedding,
  redactSecrets,
  type DatabaseReader,
} from './accessControl';

const records: Record<string, Array<Record<string, unknown>>> = {
  'role': [
    { id: 1, name: 'global-admin' },
    { id: 2, name: 'organization-admin' },
  ],
  'user-has-role': [
    { id: 10, user: 1, role: 1 },
    { id: 11, user: 2, role: 2 },
    { id: 12, user: 3, role: 2 },
  ],
  'user': [
    { id: 1, actor: 101 },
    { id: 2, actor: 102 },
    { id: 3, actor: 103 },
    { id: 4, actor: 104 },
  ],
  'api key': [
    { 'id': 201, 'is of-actor': 101, 'key': 'one' },
    { 'id': 202, 'is of-actor': 102, 'key': 'two' },
    { 'id': 203, 'is of-actor': 104, 'key': 'four' },
    { 'id': 204, 'is of-actor': 105, 'key': 'fleet-one' },
    { 'id': 205, 'is of-actor': 107, 'key': 'device-one' },
    { 'id': 206, 'is of-actor': 108, 'key': 'device-two' },
  ],
  'organization membership': [
    { 'id': 300, 'user': 1, 'is member of-organization': 401 },
    { 'id': 301, 'user': 2, 'is member of-organization': 401 },
    { 'id': 302, 'user': 4, 'is member of-organization': 401 },
    { 'id': 303, 'user': 3, 'is member of-organization': 402 },
  ],
  'application': [
    { id: 501, actor: 105, organization: 401 },
    { id: 502, actor: 106, organization: 402 },
  ],
  'device': [
    { 'id': 601, 'actor': 107, 'belongs to-application': 501 },
    { 'id': 602, 'actor': 108, 'belongs to-application': 502 },
  ],
  'user-has-permission': [],
  'user-has-public key': [
    { 'id': 701, 'user': 2, 'public key': 'self' },
    { 'id': 702, 'user': 4, 'public key': 'other' },
  ],
  'user-has-direct access to-application': [],
  'api key-has-role': [],
  'api key-has-permission': [],
};

const parseFilter = (query: URLSearchParams | undefined): [string, Set<number>] | undefined => {
  if (!query) return undefined;
  for (const [field, expression] of query) {
    const values = expression.match(/\d+/g)?.map(Number);
    if (values) return [field, new Set(values)];
  }
  return undefined;
};

const reader = (overrides: Partial<typeof records> = {}): DatabaseReader => ({
  list: async (resource, query) => {
    const source = (overrides[resource] ?? records[resource] ?? []).map((record) => ({ ...record }));
    const filter = parseFilter(query);
    if (!filter) return source;
    const [field, values] = filter;
    return source.filter((record) => values.has(Number(record[field])));
  },
});

test('legacy mode remains enabled until global-admin exists', async () => {
  const context = await buildAccessContext({ id: 2 }, reader({ role: [] }));
  assert.equal(context.enforcementEnabled, false);
  assert.equal(authorizeResource(context, 'role', 'DELETE'), undefined);
  assert.throws(() => authorizeResource(context, 'unlisted table', 'GET'), /not available/);
  assert.deepEqual(redactSecrets('api key', records['api key'], context), [
    { 'id': 201, 'is of-actor': 101 },
    { 'id': 202, 'is of-actor': 102, 'key': 'two' },
    { 'id': 203, 'is of-actor': 104 },
    { 'id': 204, 'is of-actor': 105, 'key': 'fleet-one' },
    { 'id': 205, 'is of-actor': 107, 'key': 'device-one' },
    { 'id': 206, 'is of-actor': 108, 'key': 'device-two' },
  ]);
});

test('global administrators retain global direct database access', async () => {
  const context = await buildAccessContext({ id: 1 }, reader());
  assert.equal(context.globalAdmin, true);
  assert.equal(authorizeResource(context, 'permission', 'PATCH'), undefined);
  assert.deepEqual(redactSecrets('api key', records['api key'], context), [
    { 'id': 201, 'is of-actor': 101, 'key': 'one' },
    { 'id': 202, 'is of-actor': 102 },
    { 'id': 203, 'is of-actor': 104 },
    { 'id': 204, 'is of-actor': 105, 'key': 'fleet-one' },
    { 'id': 205, 'is of-actor': 107, 'key': 'device-one' },
    { 'id': 206, 'is of-actor': 108, 'key': 'device-two' },
  ]);
});

test('organization administrators are restricted to their organization records', async () => {
  const context = await buildAccessContext({ id: 2 }, reader());
  assert.equal(context.globalAdmin, false);
  assert.deepEqual([...authorizeResource(context, 'user', 'GET')!].sort(), [2, 4]);
  assert.deepEqual([...authorizeResource(context, 'organization', 'GET')!], [401]);
  assert.deepEqual([...authorizeResource(context, 'organization membership', 'GET')!].sort(), [301, 302]);
  assert.doesNotThrow(() =>
    authorizeMutationBody(context, 'api key', 'POST', { 'key': 'new-device-key', 'is of-actor': 107 }),
  );
  assert.throws(
    () => authorizeMutationBody(context, 'api key', 'POST', { 'key': 'other-user-key', 'is of-actor': 104 }),
    /outside the administrator's organization scope/,
  );
  assert.throws(() => authorizeResource(context, 'role', 'GET'), /Global administrator/);
  assert.throws(() => authorizeResource(context, 'user', 'POST'), /cannot create/);
});

test('ordinary users cannot access direct database resources after activation', async () => {
  const context = await buildAccessContext({ id: 4 }, reader());
  assert.throws(() => authorizeResource(context, 'user', 'GET'), /Administrator access/);
});

test('organization mutations reject cross-organization references', async () => {
  const context = await buildAccessContext({ id: 2 }, reader());
  assert.throws(
    () =>
      authorizeMutationBody(context, 'organization membership', 'POST', {
        'user': 3,
        'is member of-organization': 402,
      }),
    /outside the administrator's organization scope/,
  );
  assert.doesNotThrow(() =>
    authorizeMutationBody(context, 'organization membership', 'POST', {
      'user': 4,
      'is member of-organization': 401,
    }),
  );
  assert.throws(
    () => authorizeMutationBody(context, 'api key', 'PATCH', { 'is of-actor': 999 }),
    /outside the administrator's organization scope/,
  );
  assert.throws(
    () => authorizeMutationBody(context, 'api key', 'POST', { key: 'missing-actor' }),
    /require an in-scope actor/,
  );
  assert.throws(() => authorizeMutationBody(context, 'user', 'PATCH', { actor: 999 }), /cannot rebind user actors/);
  assert.throws(
    () => authorizeMutationBody(context, 'user-has-role', 'POST', { user: 2, role: 1 }),
    /Only global administrators can assign administrator roles/,
  );
  assert.throws(
    () => authorizeMutationBody(context, 'user-has-permission', 'POST', { user: 2, permission: 99 }),
    /Only global administrators can assign direct user permissions/,
  );
});

test('API key actor validation applies to legacy and global administrators', async () => {
  const legacy = await buildAccessContext({ id: 2 }, reader({ role: [] }));
  const global = await buildAccessContext({ id: 1 }, reader());
  assert.throws(
    () => authorizeMutationBody(legacy, 'api key', 'POST', { 'key': 'other-user', 'is of-actor': 104 }),
    /outside the administrator's organization scope/,
  );
  assert.throws(
    () => authorizeMutationBody(global, 'api key', 'POST', { 'key': 'other-user', 'is of-actor': 104 }),
    /outside the administrator's organization scope/,
  );
  assert.doesNotThrow(() =>
    authorizeMutationBody(global, 'api key', 'POST', { 'key': 'device-key', 'is of-actor': 108 }),
  );
});

test('credential field detection blocks projected and filtered secret queries', () => {
  assert.equal(queryReferencesCredential('api key', { select: 'key' }), true);
  assert.equal(queryReferencesCredential('api key', { or: '(key.ilike.*abc*,name.ilike.*abc*)' }), true);
  assert.equal(queryReferencesCredential('api key', { select: 'id,name' }), false);
  assert.equal(queryReferencesCredential('user', { select: 'id,jwt_secret' }), true);
});

test('administrator role creation is constrained around startup activation', async () => {
  const context = await buildAccessContext({ id: 2 }, reader({ role: [{ id: 2, name: 'organization-admin' }] }));
  assert.doesNotThrow(() => authorizeAdministratorRoleCreation(context, 'role', 'POST', { name: 'viewer' }));
  assert.throws(
    () => authorizeAdministratorRoleCreation(context, 'role', 'PATCH', { name: 'organization-admin' }),
    /only after global administrator enforcement/,
  );
  assert.throws(
    () => authorizePreActivationAssignment(context, 'user-has-role', 'POST', { user: 2, role: 2 }),
    /cannot be assigned before/,
  );
  assert.throws(
    () => authorizePreActivationAssignment(context, 'user-has-role', 'POST', [{ user: 2, role: 2 }]),
    /Bulk role assignments/,
  );
  assert.throws(
    () => authorizeAdministratorRoleCreation(context, 'role', 'POST', { name: 'global-admin' }),
    /managed at server startup/,
  );
  assert.throws(
    () => authorizeAdministratorRoleCreation(context, 'role', 'PATCH', { name: 'global-admin' }),
    /managed at server startup/,
  );
  assert.throws(
    () => authorizePreActivationAssignment(context, 'user-has-role', 'PATCH', { user: 3 }),
    /cannot be updated before/,
  );
});

test('global-admin enforcement role cannot be renamed or deleted', async () => {
  const context = await buildAccessContext({ id: 1 }, reader());
  assert.throws(
    () => authorizeProtectedRoleMutation(context, 'role', 'DELETE', undefined, { id: 'eq.1' }),
    /cannot be renamed or deleted/,
  );
  assert.throws(
    () => authorizeProtectedRoleMutation(context, 'role', 'PATCH', { name: 'renamed' }, { id: 'eq.1' }),
    /cannot be renamed or deleted/,
  );
  assert.doesNotThrow(() =>
    authorizeProtectedRoleMutation(context, 'role', 'PATCH', { name: 'viewer' }, { id: 'eq.3' }),
  );
});

test('global administrators cannot remove their own access', async () => {
  const context = await buildAccessContext({ id: 1 }, reader());
  assert.throws(() => authorizeSelfLockoutMutation(context, 'user', 'DELETE', { id: 'eq.1' }), /own user record/);
  assert.throws(
    () => authorizeSelfLockoutMutation(context, 'user-has-role', 'DELETE', { id: 'eq.10' }),
    /own global-admin assignment/,
  );
  assert.throws(
    () => authorizeSelfLockoutMutation(context, 'user-has-role', 'PATCH', { id: 'eq.10' }),
    /own global-admin assignment/,
  );
  assert.doesNotThrow(() => authorizeSelfLockoutMutation(context, 'user-has-role', 'DELETE', { id: 'eq.12' }));
});

test('password changes are restricted to self and administratively scoped users', async () => {
  const organizationAdmin = await buildAccessContext({ id: 2 }, reader());
  const ordinaryUser = await buildAccessContext({ id: 4 }, reader());
  assert.throws(() => authorizePasswordChange(ordinaryUser, 4), /Administrator access/);
  assert.doesNotThrow(() => authorizePasswordChange(organizationAdmin, 4));
  assert.throws(() => authorizePasswordChange(organizationAdmin, 3), /outside the administrator scope/);
});

test('credential actor provisioning is limited to global and legacy administrators', async () => {
  const legacy = await buildAccessContext({ id: 2 }, reader({ role: [] }));
  const global = await buildAccessContext({ id: 1 }, reader());
  const organizationAdmin = await buildAccessContext({ id: 2 }, reader());
  assert.doesNotThrow(() => authorizeCredentialActorProvision(legacy));
  assert.doesNotThrow(() => authorizeCredentialActorProvision(global));
  assert.throws(() => authorizeCredentialActorProvision(organizationAdmin), /Global administrator/);
});

test('relationship embedding and client projections are rejected', () => {
  assert.equal(queryUsesUnsafeEmbedding({ select: 'id,user(password)' }), true);
  assert.equal(queryUsesUnsafeEmbedding({ 'user.password': 'not.is.null' }), true);
  assert.equal(queryUsesUnsafeEmbedding({ order: 'user(name).asc' }), true);
  assert.equal(queryUsesUnsafeEmbedding({ or: '(user.password.eq.secret)' }), true);
  assert.equal(queryUsesUnsafeEmbedding({ order: 'id.asc', offset: '0', limit: '25' }), false);
});

test('secret redaction exposes managed device and fleet keys but not other users keys', async () => {
  const context = await buildAccessContext({ id: 2 }, reader());
  assert.deepEqual(
    redactSecrets(
      'api key',
      [
        { id: 2, password: 'hash', jwt_secret: 'secret', username: 'org-admin' },
        { id: 202, key: 'own-key', name: 'mine' },
        { id: 203, key: 'other-key', name: 'other' },
        { id: 204, key: 'fleet-key', name: 'fleet' },
        { id: 205, key: 'device-key', name: 'device' },
        { id: 206, key: 'other-device-key', name: 'other device' },
        { 'id': 999, 'key': 'created-device-key', 'is of-actor': 107, 'name': 'new device key' },
        { 'id': 701, 'user': 2, 'public key': 'own-public-key' },
        { 'id': 702, 'user': 4, 'public key': 'other-public-key' },
      ],
      context,
    ),
    [
      { id: 2, username: 'org-admin' },
      { id: 202, key: 'own-key', name: 'mine' },
      { id: 203, name: 'other' },
      { id: 204, key: 'fleet-key', name: 'fleet' },
      { id: 205, key: 'device-key', name: 'device' },
      { id: 206, name: 'other device' },
      { 'id': 999, 'key': 'created-device-key', 'is of-actor': 107, 'name': 'new device key' },
      { 'id': 701, 'user': 2, 'public key': 'own-public-key' },
      { id: 702, user: 4 },
    ],
  );
  assert.deepEqual(redactSecrets('config', { id: 1, key: 'OPEN_BALENA_API_URL', value: 'https://api' }, context), {
    id: 1,
    key: 'OPEN_BALENA_API_URL',
    value: 'https://api',
  });
});
