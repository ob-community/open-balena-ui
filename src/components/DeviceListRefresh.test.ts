import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryClient } from '@tanstack/react-query';
import { acceptDeviceInstallBatch, applyDeviceRowRefresh, mergeDeviceRows } from '../ui/DeviceListRefresh';
import { isDeviceRefreshActive } from '../lib/deviceRefresh';

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
