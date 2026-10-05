import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { acceptDeviceInstallBatch, applyDeviceRowRefresh, mergeDeviceRows } from '../ui/DeviceListRefresh';
import { isDeviceRefreshActive } from '../lib/deviceRefresh';
import { openBalenaDataProvider } from '../dataProvider/openBalenaDataProvider';
import type { ResourceRecord } from '../types/resource';

const deviceRequestHarness = () => {
  const requests: Array<{
    url: string;
    resolve: (records: ResourceRecord[]) => void;
  }> = [];
  const provider = openBalenaDataProvider('https://api.example.test', async (url) => {
    const response = (json: unknown) => ({
      status: 200,
      headers: new Headers(),
      body: JSON.stringify(json),
      json,
    });
    if (url.includes('/$count')) return response(42);
    const records = new Promise<ResourceRecord[]>((resolve) => requests.push({ url, resolve }));
    return response({ value: await records });
  });
  const client = new QueryClient();
  const listKey = (page = 1) => [
    'device',
    'getList',
    { pagination: { page, perPage: 2 }, sort: { field: 'id', order: 'ASC' }, filter: {} },
  ];
  const list = (page = 1) =>
    client.fetchQuery({
      queryKey: listKey(page),
      queryFn: () =>
        provider.getList<ResourceRecord>('device', {
          pagination: { page, perPage: 2 },
          sort: { field: 'id', order: 'ASC' },
          filter: {},
        }),
    });
  const manyKey = (ids: number[]) => ['device', 'getMany', { ids: ids.map(String) }];
  const many = (ids: number[]) =>
    client.fetchQuery({
      queryKey: manyKey(ids),
      queryFn: () => provider.getMany<ResourceRecord>('device', { ids }).then(({ data }) => data),
      structuralSharing: false,
    });
  return { requests, provider, client, listKey, list, manyKey, many };
};

test('a slow busy-row request cannot overwrite a newer full-list cache write', async () => {
  const { requests, client, listKey, list, many } = deviceRequestHarness();
  const slowRows = many([1]);
  const newerList = list();
  const latest = { id: 1, status: 'Operational', note: 'new list' };
  requests[1].resolve([latest, { id: 2, status: 'Operational' }]);
  const page = await newerList;
  requests[0].resolve([{ id: 1, status: 'Updating', overall_status: 'configuring', note: 'old row' }]);
  const rows = await slowRows;
  applyDeviceRowRefresh(client, listKey(), rows, [1]);
  assert.deepEqual(rows, [latest]);
  assert.deepEqual(client.getQueryData(listKey()), page);
  assert.deepEqual(
    page.data.map((record) => record.id),
    [1, 2],
  );
  assert.equal(page.total, 42);
  client.clear();
});

test('a slow full-list request cannot overwrite newer rows, including mixed-device pages', async (context) => {
  context.mock.method(Date, 'now', () => 100);
  const { requests, client, listKey, list, many } = deviceRequestHarness();
  client.setQueryData(listKey(), { data: [{ id: 1, status: 'Updating' }], total: 1 });
  const slowList = list();
  const newerRows = many([1, 3]);
  requests[1].resolve([
    { id: 1, status: 'Operational', note: 'new row' },
    { id: 3, status: 'Operational' },
  ]);
  const rows = await newerRows;
  applyDeviceRowRefresh(client, listKey(), rows, [1, 3]);
  requests[0].resolve([
    { id: 2, status: 'Updating', note: 'only in list' },
    { id: 1, status: 'Updating', overall_status: 'configuring', historical: 'remove' },
  ]);
  const page = await slowList;
  assert.deepEqual(page, {
    data: [
      { id: 2, status: 'Updating', note: 'only in list' },
      { id: 1, status: 'Operational', note: 'new row' },
    ],
    total: 42,
  });
  assert.deepEqual(client.getQueryData(listKey()), page);
  assert.equal(isDeviceRefreshActive(page.data[1]), false);
  client.clear();
});

test('a cached row effect is rechecked when a newer list arrives after the row response', async () => {
  const { requests, client, listKey, list, many, manyKey } = deviceRequestHarness();
  const rowRequest = many([1]);
  requests[0].resolve([{ id: 1, status: 'Updating', note: 'historical row' }]);
  const cachedRows = await rowRequest;
  const listRequest = list();
  requests[1].resolve([{ id: 1, status: 'Operational' }]);
  await listRequest;
  const sourceState = client.getQueryState(manyKey([1]));
  applyDeviceRowRefresh(client, listKey(), cachedRows, [1]);
  assert.deepEqual(client.getQueryData(listKey()), { data: [{ id: 1, status: 'Operational' }], total: 42 });
  assert.equal(client.getQueryState(manyKey([1])), sourceState);
  assert.deepEqual(cachedRows, [{ id: 1, status: 'Updating', note: 'historical row' }]);
  client.clear();
});

test('overlapping list pages reconcile per device without adopting another page membership or old fields', async () => {
  const { requests, client, listKey, list } = deviceRequestHarness();
  const oldPageRequest = list(1);
  const newerPageRequest = list(2);
  requests[1].resolve([
    { id: 1, status: 'Operational' },
    { id: 3, status: 'Operational' },
  ]);
  const newerPage = await newerPageRequest;
  requests[0].resolve([
    { id: 2, status: 'Updating' },
    { id: 1, status: 'Updating', note: 'obsolete' },
  ]);
  const oldPage = await oldPageRequest;
  assert.deepEqual(oldPage.data, [
    { id: 2, status: 'Updating' },
    { id: 1, status: 'Operational' },
  ]);
  assert.deepEqual(
    newerPage.data.map((record) => record.id),
    [1, 3],
  );
  assert.deepEqual(client.getQueryData(listKey(1)), oldPage);
  assert.deepEqual(client.getQueryData(listKey(2)), newerPage);
  const newestRequest = list(1);
  requests[2].resolve([{ id: 1, status: 'Updating' }]);
  const newest = await newestRequest;
  assert.deepEqual(newest, { data: [{ id: 1, status: 'Updating' }], total: 42 });
  client.clear();
});

test('projected lists cannot replace authoritative device snapshots', async () => {
  const { requests, provider, client, list, many } = deviceRequestHarness();
  const slowRows = many([1]);
  const projected = provider.getList('device', {
    pagination: { page: 1, perPage: 2 },
    sort: { field: 'id', order: 'ASC' },
    filter: { 'select@': 'id' },
  });
  requests[1].resolve([{ id: 1 }]);
  assert.deepEqual((await projected).data, [{ id: 1 }]);
  requests[0].resolve([{ id: 1, status: 'Operational' }]);
  assert.deepEqual(await slowRows, [{ id: 1, status: 'Operational' }]);
  const listRequest = list();
  requests[2].resolve([{ id: 1, status: 'Updating' }]);
  assert.deepEqual((await listRequest).data, [{ id: 1, status: 'Updating' }]);
  client.clear();
});

test('an aborted list response does not supersede a successful row request', async () => {
  const { requests, provider, client, many } = deviceRequestHarness();
  const rowRequest = many([1]);
  const controller = new AbortController();
  const abortedList = provider.getList('device', {
    pagination: { page: 1, perPage: 2 },
    sort: { field: 'id', order: 'ASC' },
    filter: {},
    signal: controller.signal,
  });
  controller.abort();
  requests[1].resolve([{ id: 1, status: 'Updating' }]);
  await abortedList;
  requests[0].resolve([{ id: 1, status: 'Operational' }]);
  assert.deepEqual(await rowRequest, [{ id: 1, status: 'Operational' }]);
  client.clear();
});

test('row refresh matches complete IDs and preserves list membership and ordering', () => {
  const original = [
    { id: 1, status: 'Updating', note: 'keep' },
    { id: 10, status: 'Operational' },
  ];
  const updated = mergeDeviceRows(original, [
    { id: '1', status: 'Operational' },
    { id: 2, status: 'Configuring' },
  ]);
  assert.deepEqual(
    updated.map((record) => String(record.id)),
    ['1', '10'],
  );
  assert.equal(updated[0].status, 'Operational');
  assert.equal(updated[0].note, 'keep');
  assert.equal(updated[1], original[1]);
  assert.equal(original[0].status, 'Updating');
  assert.equal(mergeDeviceRows(original, [{ ...original[0] }]), original);
});

test('authoritative replacement preserves the exact field set, even for undefined values', () => {
  const previous = [{ id: 1, obsolete: undefined }];
  const latest = { id: 1, current: undefined };
  assert.deepEqual(mergeDeviceRows(previous, [latest], true), [latest]);
  assert.equal('obsolete' in mergeDeviceRows(previous, [latest], true)[0], false);
});

test('cache refresh uses RA result shapes, only touches the current list, and does not rewrite its source', () => {
  const client = new QueryClient();
  const currentList = [
    'device',
    'getList',
    {
      pagination: { page: 1, perPage: 10 },
      sort: { field: 'id', order: 'ASC' },
      filter: {},
    },
  ];
  const otherList = [
    'device',
    'getList',
    {
      pagination: { page: 1, perPage: 10 },
      sort: { field: 'id', order: 'ASC' },
      filter: { status: 'Updating' },
    },
  ];
  const one = ['device', 'getOne', { id: '1' }];
  const many = ['device', 'getMany', { ids: ['1', '10'] }];
  const source = ['device', 'getMany', { ids: ['1'] }];
  const row = { id: 1, status: 'Updating' };
  const page = { data: [row], total: 7, pageInfo: { hasNextPage: true }, meta: { keep: true } };
  client.setQueryData(currentList, page);
  client.setQueryData(otherList, page);
  client.setQueryData(one, row);
  client.setQueryData(many, [row, { id: 10, status: 'Operational' }]);
  client.setQueryData(source, [{ id: 1, status: 'Operational' }]);
  const sourceState = client.getQueryState(source);
  applyDeviceRowRefresh(client, currentList, [{ id: 1, status: 'Operational' }], [1]);
  assert.deepEqual(client.getQueryData(currentList), {
    ...page,
    data: [{ id: 1, status: 'Operational' }],
  });
  assert.equal(client.getQueryData(otherList), page);
  assert.deepEqual(client.getQueryData(one), { id: 1, status: 'Operational' });
  assert.deepEqual(client.getQueryData(many), [
    { id: 1, status: 'Operational' },
    { id: 10, status: 'Operational' },
  ]);
  assert.equal(client.getQueryState(source), sourceState);
  assert.deepEqual(client.getQueriesData({ queryKey: ['image install'] }), []);
  client.clear();
});

test('a slow activity-only response cannot overwrite a newer complete install snapshot', () => {
  const active = acceptDeviceInstallBatch(
    {},
    [18],
    {
      records: [{ id: 1, device: 18, status: 'Running' }],
      requestedAt: 200,
    },
    210,
    true,
  );
  const stale = acceptDeviceInstallBatch(
    active,
    [18],
    {
      records: [{ id: 1, device: 18, status: 'Installing' }],
      requestedAt: 100,
    },
    300,
    false,
  );
  assert.equal(stale, active);
  assert.equal(stale['18'].records[0].status, 'Running');
  assert.equal(stale['18'].complete, true);
  const tied = acceptDeviceInstallBatch(
    active,
    [18],
    {
      records: [{ id: 1, device: 18, status: 'Installing' }],
      requestedAt: 200,
    },
    310,
    false,
  );
  assert.equal(tied, active);
  const newer = acceptDeviceInstallBatch(
    active,
    [18],
    {
      records: [],
      requestedAt: 220,
    },
    230,
    false,
  );
  assert.equal(newer['18'].records.length, 0);
});

test('a steady full device response removes cached transient overall status and leaves no busy row', () => {
  const client = new QueryClient();
  const key = ['device', 'getList', { filter: {} }];
  const stale = { 'id': 18, 'status': 'Operational', 'overall status': 'configuring' };
  client.setQueryData(key, { data: [stale], total: 1 });
  assert.equal(isDeviceRefreshActive(stale), true);
  applyDeviceRowRefresh(client, key, [{ id: 18, status: 'Operational' }], [18]);
  const result = client.getQueryData<{ data: (typeof stale)[] }>(key)!;
  assert.equal('overall status' in result.data[0], false);
  assert.equal(isDeviceRefreshActive(result.data[0]), false);
  client.clear();
});
