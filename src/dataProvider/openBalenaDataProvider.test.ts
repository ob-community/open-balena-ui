import assert from 'node:assert/strict';
import test from 'node:test';
import type { Options } from 'ra-core';
import { openBalenaDataProvider, resolveODataVersion } from './openBalenaDataProvider';

const response = (json: unknown) => ({
  status: 200,
  headers: new Headers({ 'content-range': '0-0/1' }),
  body: JSON.stringify(json),
  json,
});

test('hybrid provider routes operational resources through open-balena-api', async () => {
  const requests: string[] = [];
  const provider = openBalenaDataProvider('https://api.example.test', async (url: string, _options?: Options) => {
    requests.push(url);
    if (url.includes('/$count')) {
      return response(1);
    }
    return response({ 'value': [{ id: 1 }], '@odata.count': 1 });
  });

  await provider.getList('device', {
    pagination: { page: 1, perPage: 25 },
    sort: { field: 'id', order: 'ASC' },
    filter: {},
  });

  assert.match(requests[0], /^https:\/\/api\.example\.test\/v6\/device\?/);
});

test('hybrid provider selects v7 for newer servers and v6 for legacy servers', () => {
  assert.equal(resolveODataVersion('v0.139.0'), 'v6');
  assert.equal(resolveODataVersion('v25.2.7'), 'v6');
  assert.equal(resolveODataVersion('v25.2.8'), 'v6');
  assert.equal(resolveODataVersion('v26.0.2'), 'v6');
  assert.equal(resolveODataVersion('v26.1.0'), 'v7');
  assert.equal(resolveODataVersion('v26.1.0', '6'), 'v6');
  assert.throws(() => resolveODataVersion('v26.1.0', 'v8'), /must be v6 or v7/);
});

test('hybrid provider routes identity resources through PostgREST', async () => {
  const requests: string[] = [];
  const provider = openBalenaDataProvider('https://api.example.test', async (url: string, _options?: Options) => {
    requests.push(url);
    return response([{ id: 1, username: 'admin' }]);
  });

  await provider.getList('user', {
    pagination: { page: 1, perPage: 25 },
    sort: { field: 'id', order: 'ASC' },
    filter: {},
  });

  assert.match(requests[0], /^\/admin-db\/user\?/);
});

test('hybrid provider retrieves the authenticated administrator access context', async () => {
  const requests: string[] = [];
  const provider = openBalenaDataProvider('https://api.example.test', async (url) => {
    requests.push(url);
    return response({
      enforcementEnabled: false,
      globalAdmin: true,
      organizationAdmin: true,
      userId: 2,
    });
  });

  assert.deepEqual(await provider.getAdminAccessContext(), {
    enforcementEnabled: false,
    globalAdmin: true,
    organizationAdmin: true,
    userId: 2,
  });
  assert.deepEqual(requests, ['/admin-db/actions/access-context']);
});

test('hybrid provider retrieves filtered device update options through the UI server', async () => {
  const requests: Array<{ url: string; options?: Options }> = [];
  const controller = new AbortController();
  const provider = openBalenaDataProvider('https://api.example.test', async (url, options) => {
    requests.push({ url, options });
    return response({
      operatingSystems: [{ id: 10, version: '6.0.0' }],
      supervisors: [{ id: 20, version: '16.1.0' }],
    });
  });

  assert.deepEqual(
    await provider.getDeviceUpdateOptions({
      deviceTypeId: 1,
      currentOsVersion: '5.1.0',
      currentSupervisorVersion: '15.0.4',
      signal: controller.signal,
    }),
    {
      operatingSystems: [{ id: 10, version: '6.0.0' }],
      supervisors: [{ id: 20, version: '16.1.0' }],
    },
  );
  assert.equal(
    requests[0].url,
    '/device-update-options?deviceTypeId=1&currentOsVersion=5.1.0&currentSupervisorVersion=15.0.4',
  );
  assert.equal(requests[0].options?.signal, controller.signal);
});

test('hybrid provider assigns Supervisor targets through the UI server', async () => {
  let request: { url: string; options?: Options } | undefined;
  const provider = openBalenaDataProvider('https://api.example.test', async (url, options) => {
    request = { url, options };
    return response({ releaseId: 123, version: '19.2.1' });
  });

  assert.deepEqual(await provider.setDeviceSupervisorTarget({ deviceId: 25, version: '19.2.1' }), {
    releaseId: 123,
    version: '19.2.1',
  });
  assert.equal(request?.url, '/device-supervisor-target');
  assert.equal(request?.options?.method, 'POST');
  assert.deepEqual(JSON.parse(String(request?.options?.body)), { deviceId: 25, version: '19.2.1' });
});

test('hybrid provider exposes BalenaOS catalog synchronization actions', async () => {
  const requests: Array<{ url: string; options?: Options }> = [];
  const provider = openBalenaDataProvider('https://api.example.test', async (url, options) => {
    requests.push({ url, options });
    return response(
      url.endsWith('/catalog')
        ? {
            deviceTypes: [],
            organizations: [],
            totals: { availableVersions: 0, localApplications: 0, localReleases: 0 },
          }
        : {
            state: 'running',
            phase: 'Discovering catalog',
            processed: 0,
            total: 0,
            created: 0,
            updated: 0,
            unchanged: 0,
          },
    );
  });

  await provider.getBalenaOsCatalog();
  await provider.getBalenaOsSyncStatus();
  await provider.startBalenaOsSync({ mode: 'newer-and-in-use', version: '6.5.0' });

  assert.deepEqual(
    requests.map(({ url }) => url),
    ['/balena-os/catalog', '/balena-os/status', '/balena-os/sync'],
  );
  assert.equal(requests[2].options?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requests[2].options?.body)), {
    mode: 'newer-and-in-use',
    version: '6.5.0',
  });
});

test('hybrid provider fails closed for unknown resources', async () => {
  const provider = openBalenaDataProvider('https://api.example.test', async () => response([]));

  await assert.rejects(provider.getOne('unlisted resource', { id: 1 }), /has no data-provider route/);
});

test('hybrid provider uses the dedicated password action', async () => {
  const requests: Array<{ url: string; options?: Options }> = [];
  const provider = openBalenaDataProvider('https://api.example.test', async (url, options) => {
    requests.push({ url, options });
    return response(null);
  });

  await provider.changePassword({ userId: 7, password: 'Valid1!password' });

  assert.equal(requests[0].url, '/admin-db/actions/change-password');
  assert.equal(requests[0].options?.method, 'POST');
  assert.deepEqual(JSON.parse(String(requests[0].options?.body)), {
    userId: 7,
    password: 'Valid1!password',
  });
});

test('hybrid provider advertises query abort support and forwards typed custom-action signals', async () => {
  const requests: Array<{ url: string; options?: Options }> = [];
  const controller = new AbortController();
  const provider = openBalenaDataProvider('https://api.example.test', async (url, options) => {
    requests.push({ url, options });
    return response({ id: 7 });
  });

  assert.equal(provider.supportAbortSignal, true);
  await provider.changePassword({
    userId: 7,
    password: 'Valid1!password',
    signal: controller.signal,
  });
  await provider.deleteResourceActor({
    resource: 'device',
    id: 7,
    actorId: 70,
    signal: controller.signal,
  });

  assert.equal(requests[0].options?.signal, controller.signal);
  assert.equal(requests[1].options?.signal, controller.signal);
});

test('hybrid provider forwards abort signals to direct database reads', async () => {
  const controller = new AbortController();
  let options: Options | undefined;
  const provider = openBalenaDataProvider('https://api.example.test', async (_url, requestOptions) => {
    options = requestOptions;
    return response([{ id: 1, username: 'admin' }]);
  });

  await provider.getList('user', {
    pagination: { page: 1, perPage: 25 },
    sort: { field: 'id', order: 'ASC' },
    filter: {},
    signal: controller.signal,
  });

  assert.equal(options?.signal, controller.signal);
});

test('hybrid provider strips immutable credential fields from metadata updates', async () => {
  const requests: Array<{ url: string; options?: Options }> = [];
  const provider = openBalenaDataProvider('https://api.example.test', async (url, options) => {
    requests.push({ url, options });
    return response(url.includes('in.%287%2C8%29') ? [{ id: 7 }, { id: 8 }] : { id: 7, name: 'renamed' });
  });

  await provider.update('api key', {
    id: 7,
    data: { 'id': 7, 'name': 'renamed', 'key': 'redacted', 'is of-actor': 70 },
    previousData: { 'id': 7, 'name': 'old', 'is of-actor': 70 },
  });
  await provider.update('user', {
    id: 8,
    data: { id: 8, username: 'renamed', actor: 80, password: 'hidden', jwt_secret: 'hidden' },
    previousData: { id: 8, username: 'old', actor: 80 },
  });
  await provider.updateMany('api key', {
    ids: [7, 8],
    data: { 'name': 'bulk-renamed', 'key': 'redacted', 'is of-actor': 70 },
  });
  await provider.update('device', {
    id: 7,
    data: {
      'id': 7,
      'actor': 70,
      'device name': 'renamed',
      'api secret': 'hidden',
      'status': 'Idle',
      'is pinned on-release': 123,
      'should be operated by-release': 456,
      'should be managed by-release': 789,
      'supervisor version': '19.2.1',
    },
    previousData: { 'id': 7, 'actor': 70, 'device name': 'old' },
  });

  assert.deepEqual(JSON.parse(String(requests[0].options?.body)), { name: 'renamed' });
  assert.deepEqual(JSON.parse(String(requests[1].options?.body)), { username: 'renamed' });
  assert.deepEqual(JSON.parse(String(requests[2].options?.body)), { name: 'bulk-renamed' });
  assert.deepEqual(JSON.parse(String(requests[3].options?.body)), {
    device_name: 'renamed',
    is_pinned_on__release: 123,
    should_be_operated_by__release: 456,
    should_be_managed_by__release: 789,
  });
});

test('hybrid provider writes only the legacy device release pin field on legacy APIs', async () => {
  let options: Options | undefined;
  const provider = openBalenaDataProvider(
    'https://api.example.test',
    async (_url, requestOptions) => {
      options = requestOptions;
      return response(null);
    },
    'v0.139.0',
  );

  await provider.update('device', {
    id: 7,
    data: {
      'device name': 'legacy-device',
      'is pinned on-release': 100,
      'should be running-release': 200,
    },
    previousData: { id: 7 },
  });

  assert.deepEqual(JSON.parse(String(options?.body)), {
    device_name: 'legacy-device',
    should_be_running__release: 200,
  });
});

test('hybrid provider creates users through the dedicated action', async () => {
  const requests: Array<{ url: string; options?: Options }> = [];
  const provider = openBalenaDataProvider('https://api.example.test', async (url, options) => {
    requests.push({ url, options });
    return response({ id: 7, username: 'new-user' });
  });

  const result = await provider.create('user', {
    data: { username: 'new-user', email: 'new@example.test', password: 'Valid1!password' },
  });

  assert.deepEqual(result.data, { id: 7, username: 'new-user' });
  assert.equal(requests[0].url, '/admin-db/actions/create-user');
  assert.equal(requests[0].options?.method, 'POST');
});

test('hybrid provider creates API keys through the dedicated action', async () => {
  const requests: Array<{ url: string; options?: Options }> = [];
  const provider = openBalenaDataProvider('https://api.example.test', async (url, options) => {
    requests.push({ url, options });
    return response({ id: 42, name: 'device key' });
  });

  const result = await provider.create('api key', {
    data: { 'is of-actor': 7, 'name': 'device key', 'description': 'test' },
  });

  assert.deepEqual(result.data, { id: 42, name: 'device key' });
  assert.equal(requests[0].url, '/admin-db/actions/create-api-key');
  assert.deepEqual(JSON.parse(String(requests[0].options?.body)), {
    'is of-actor': 7,
    'name': 'device key',
    'description': 'test',
  });
});

test('hybrid provider coordinates application and device creation through the server', async () => {
  const requests: Array<{ url: string; options?: Options }> = [];
  const provider = openBalenaDataProvider('https://api.example.test', async (url, options) => {
    requests.push({ url, options });
    return response({ id: requests.length, actor: 100 + requests.length });
  });

  await provider.create('application', { data: { 'app name': 'fleet' } });
  await provider.create('device', { data: { 'device name': 'device' } });

  assert.deepEqual(
    requests.map(({ url }) => url),
    ['/admin-db/actions/create-operational-resource', '/admin-db/actions/create-operational-resource'],
  );
  assert.deepEqual(JSON.parse(String(requests[0].options?.body)), {
    resource: 'application',
    data: { 'app name': 'fleet' },
  });
  assert.deepEqual(JSON.parse(String(requests[1].options?.body)), {
    resource: 'device',
    data: { 'device name': 'device' },
  });
});

test('hybrid provider deletes API keys through the scoped server action', async () => {
  const requests: Array<{ url: string; options?: Options }> = [];
  const provider = openBalenaDataProvider('https://api.example.test', async (url, options) => {
    requests.push({ url, options });
    return response({ id: 42 });
  });

  const result = await provider.delete('api key', { id: 42 });

  assert.deepEqual(result.data, { id: 42 });
  assert.equal(requests[0].url, '/admin-db/actions/delete-api-key');
  assert.deepEqual(JSON.parse(String(requests[0].options?.body)), { id: 42 });
});

test('hybrid provider deletes API keys in bulk through the scoped server action', async () => {
  const requests: Array<{ url: string; options?: Options }> = [];
  const provider = openBalenaDataProvider('https://api.example.test', async (url, options) => {
    requests.push({ url, options });
    return response({ id: JSON.parse(String(options?.body)).id });
  });

  const result = await provider.deleteMany('api key', { ids: [41, 42] });

  assert.deepEqual(result.data, [41, 42]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/admin-db/actions/delete-api-keys');
  assert.deepEqual(JSON.parse(String(requests[0].options?.body)), { ids: [41, 42] });
});

test('hybrid provider coordinates resource and actor deletion through the server', async () => {
  const requests: Array<{ url: string; options?: Options }> = [];
  const provider = openBalenaDataProvider('https://api.example.test', async (url, options) => {
    requests.push({ url, options });
    return response({ id: 7 });
  });

  await provider.authorizeResourceActorDeletion({ resource: 'device', id: 7, actorId: 70 });
  await provider.deleteResourceActor({ resource: 'device', id: 7, actorId: 70 });

  assert.equal(requests[0].url, '/admin-db/actions/authorize-resource-actor-deletion');
  assert.equal(requests[1].url, '/admin-db/actions/delete-resource-actor');
  assert.deepEqual(JSON.parse(String(requests[0].options?.body)), {
    resource: 'device',
    id: 7,
    actorId: 70,
  });
  assert.deepEqual(requests[1].options?.body, requests[0].options?.body);
});

test('hybrid provider authorizes bulk resource deletion in one server request', async () => {
  const requests: Array<{ url: string; options?: Options }> = [];
  const provider = openBalenaDataProvider('https://api.example.test', async (url, options) => {
    requests.push({ url, options });
    return response(null);
  });
  const records = [
    { resource: 'device' as const, id: 7, actorId: 70 },
    { resource: 'device' as const, id: 8, actorId: 80 },
  ];

  await provider.authorizeResourceActorDeletions({ records });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/admin-db/actions/authorize-resource-actor-deletions');
  assert.deepEqual(JSON.parse(String(requests[0].options?.body)), { records });
});
