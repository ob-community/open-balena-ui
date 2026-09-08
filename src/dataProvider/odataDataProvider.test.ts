import assert from 'node:assert/strict';
import test from 'node:test';
import type { Options } from 'ra-core';
import { buildODataFilter, createODataDataProvider, extractCollection, transformFromApi } from './odataDataProvider';

const response = (json: unknown) => ({
  status: 200,
  headers: new Headers(),
  body: JSON.stringify(json),
  json,
});

test('buildODataFilter translates comparison, array, relation, and full-text filters', () => {
  assert.equal(
    buildODataFilter({
      'belongs to-application': 7,
      'id@in': [1, 2],
      'created at@gte': '2025-01-01',
      '#uuid,device name@ilike': 'edge west',
    }),
    "(belongs_to__application eq 7 and (id eq 1 or id eq 2) and created_at ge '2025-01-01' and ((contains(uuid,'edge') or contains(device_name,'edge')) and (contains(uuid,'west') or contains(device_name,'west'))))",
  );
});

test('buildODataFilter uses case-insensitive functions when OData v7 enables them', () => {
  assert.equal(buildODataFilter({ 'device name@ilike': 'Edge' }, true), "contains(tolower(device_name),'edge')");
});

test('extractCollection supports modern and legacy OData response envelopes', () => {
  assert.deepEqual(extractCollection({ 'value': [{ id: 1 }], '@odata.count': 12 }), {
    items: [{ id: 1 }],
    count: 12,
  });
  assert.deepEqual(extractCollection({ d: { results: [{ id: 2 }], __count: '9' } }), {
    items: [{ id: 2 }],
    count: 9,
  });
  assert.deepEqual(extractCollection({ d: [{ id: 3 }] }), { items: [{ id: 3 }], count: undefined });
});

test('transformFromApi restores legacy UI field names and relation ids', () => {
  assert.deepEqual(
    transformFromApi({
      'id': 5,
      'created_at': '2025-01-01',
      'belongs_to__application': { __id: 2 },
      'device_tag': [{ id: 8, tag_key: 'site' }],
      '@odata.type': 'ignored',
    }),
    {
      'id': 5,
      'created at': '2025-01-01',
      'belongs to-application': 2,
      'device tag': [{ 'id': 8, 'tag key': 'site' }],
    },
  );
});

test('provider generates paginated OData requests and preserves exact counts', async () => {
  const requests: Array<{ url: string; options?: Options }> = [];
  const provider = createODataDataProvider(
    'https://api.example.test/',
    async (url, options) => {
      requests.push({ url, options });
      if (url.includes('/$count')) {
        return response(31);
      }
      return response({ d: { results: [{ id: 4, device_name: 'test' }], __count: '31' } });
    },
    'v6',
  );

  const result = await provider.getList('device', {
    pagination: { page: 2, perPage: 10 },
    sort: { field: 'device name', order: 'DESC' },
    filter: { 'belongs to-application': 3 },
  });

  const url = new URL(requests[0].url);
  assert.equal(url.pathname, '/v6/device');
  assert.equal(url.searchParams.has('$count'), false);
  assert.equal(url.searchParams.get('$top'), '10');
  assert.equal(url.searchParams.get('$skip'), '10');
  assert.equal(url.searchParams.get('$orderby'), 'device_name desc');
  assert.equal(url.searchParams.get('$filter'), 'belongs_to__application eq 3');
  assert.deepEqual(result, { data: [{ 'id': 4, 'device name': 'test' }], total: 31 });
});

test('provider obtains an exact count from the legacy count endpoint', async () => {
  const provider = createODataDataProvider('https://api.example.test', async (url) =>
    url.includes('/$count') ? response({ d: 8 }) : response({ d: [{ id: 1 }] }),
  );
  const result = await provider.getList('application', {
    pagination: { page: 1, perPage: 1 },
    sort: { field: 'id', order: 'ASC' },
    filter: {},
  });

  assert.deepEqual(result, {
    data: [{ id: 1 }],
    total: 8,
  });
});

test('provider translates legacy select filters into OData projections', async () => {
  const requests: string[] = [];
  const provider = createODataDataProvider('https://api.example.test', async (url) => {
    requests.push(url);
    return url.includes('/$count') ? response(1) : response({ d: [{ id: 1, name: 'FOO' }] });
  });

  await provider.getList('device environment variable', {
    pagination: { page: 1, perPage: 25 },
    sort: { field: 'id', order: 'ASC' },
    filter: { 'select@': 'id,name' },
  });

  const listUrl = new URL(requests.find((url) => !url.includes('/$count'))!);
  assert.equal(listUrl.searchParams.get('$select'), 'id,name');
  assert.equal(listUrl.searchParams.has('$filter'), false);
});

test('provider serializes writes and uses entity URLs for mutations', async () => {
  const requests: Array<{ url: string; options?: Options }> = [];
  const provider = createODataDataProvider('https://api.example.test', async (url, options) => {
    requests.push({ url, options });
    return response(null);
  });

  const result = await provider.update('device', {
    id: 7,
    data: { 'id': 7, 'device name': 'renamed', 'belongs to-application': 2 },
    previousData: { 'id': 7, 'device name': 'old' },
  });

  assert.equal(requests[0].url, 'https://api.example.test/v6/device(7)');
  assert.equal(requests[0].options?.method, 'PATCH');
  assert.deepEqual(JSON.parse(String(requests[0].options?.body)), {
    device_name: 'renamed',
    belongs_to__application: 2,
  });
  assert.deepEqual(result.data, { 'id': 7, 'device name': 'renamed', 'belongs to-application': 2 });
});

test('provider treats numeric route ids as numeric OData keys', async () => {
  const requests: string[] = [];
  const provider = createODataDataProvider('https://api.example.test', async (url) => {
    requests.push(url);
    return response({ d: { id: 7 } });
  });

  await provider.getOne('device', { id: '7' });
  assert.equal(requests[0], 'https://api.example.test/v6/device(7)');
});

test('provider rejects create responses without a generated id', async () => {
  const provider = createODataDataProvider('https://api.example.test', async () => response(null));

  await assert.rejects(
    provider.create('device tag', { data: { 'device': 1, 'tag key': 'site', 'value': 'west' } }),
    /create response did not contain a record with an id/,
  );
});
