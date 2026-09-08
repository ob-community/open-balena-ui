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
  assert.equal(resolveODataVersion('v25.2.8'), 'v7');
  assert.equal(resolveODataVersion('v26.0.0'), 'v7');
  assert.equal(resolveODataVersion('v25.2.8', '6'), 'v6');
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

test('hybrid provider fails closed for unknown resources', async () => {
  const provider = openBalenaDataProvider('https://api.example.test', async () => response([]));

  await assert.rejects(provider.getOne('unlisted resource', { id: 1 }), /has no data-provider route/);
});
