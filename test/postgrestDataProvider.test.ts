import assert from 'node:assert/strict';
import test from 'node:test';
import postgrestDataProvider from '../src/dataProvider/postgrestDataProvider';

type DeviceRecord = {
  id: number;
  'api heartbeat state': 'online' | 'offline' | 'timeout' | 'unknown';
  'changed api heartbeat state on-date': string;
  'last connectivity event': string;
  'device name': string;
};

const onlineDevices: DeviceRecord[] = [
  {
    id: 1,
    'api heartbeat state': 'online',
    'changed api heartbeat state on-date': '2026-09-10T12:00:00Z',
    'last connectivity event': '2026-09-10T12:00:00Z',
    'device name': 'Online',
  },
];

const offlineDevices: DeviceRecord[] = [
  {
    id: 2,
    'api heartbeat state': 'offline',
    'changed api heartbeat state on-date': '2026-09-09T12:00:00Z',
    'last connectivity event': '2026-09-09T12:00:00Z',
    'device name': 'Offline',
  },
  {
    id: 3,
    'api heartbeat state': 'timeout',
    'changed api heartbeat state on-date': '2026-09-08T12:00:00Z',
    'last connectivity event': '2026-09-08T12:00:00Z',
    'device name': 'Timeout',
  },
  {
    id: 4,
    'api heartbeat state': 'unknown',
    'changed api heartbeat state on-date': '2026-09-07T12:00:00Z',
    'last connectivity event': '2026-09-07T12:00:00Z',
    'device name': 'Unknown',
  },
];

const allDevices = [...onlineDevices, ...offlineDevices];

const sortByConnectivity = (records: DeviceRecord[], order: string | null) => {
  const sorted = [...records].sort((left, right) => {
    const timestampOrder = left['changed api heartbeat state on-date'].localeCompare(
      right['changed api heartbeat state on-date'],
    );
    if (timestampOrder !== 0) {
      return timestampOrder;
    }

    const nameOrder = left['device name'].localeCompare(right['device name']);
    return nameOrder !== 0 ? nameOrder : left.id - right.id;
  });

  return order?.includes('.desc') ? sorted.reverse() : sorted;
};

const createHttpClient = () => {
  const requests: URL[] = [];

  const httpClient = async (url: string) => {
    const request = new URL(url);
    requests.push(request);

    const heartbeatGroup = request.searchParams.get('and');
    const records = heartbeatGroup?.includes('api heartbeat state.eq.online')
      ? onlineDevices
      : heartbeatGroup?.includes('api heartbeat state.in.(offline,timeout,unknown)')
        ? offlineDevices
        : allDevices;
    const orderedRecords = sortByConnectivity(records, request.searchParams.get('order'));
    const offset = Number(request.searchParams.get('offset') ?? '0');
    const limit = Number(request.searchParams.get('limit') ?? `${orderedRecords.length}`);

    return {
      headers: new Headers({ 'content-range': `*/${orderedRecords.length}` }),
      json: orderedRecords.slice(offset, offset + limit),
    };
  };

  return { httpClient, requests };
};

const getIds = (result: { data: DeviceRecord[] }) => result.data.map((record) => record.id);

test('legacy connectivity pagination keeps heartbeat-online devices ahead of every offline state', async () => {
  const { httpClient, requests } = createHttpClient();
  const provider = postgrestDataProvider('https://postgrest.example', httpClient, 'eq', new Map(), false);

  const result = await provider.getList('device', {
    pagination: { page: 1, perPage: 3 },
    sort: { field: 'connectivity', order: 'DESC' },
    filter: { 'belongs to-application': 42 },
  });

  assert.deepEqual(getIds(result), [1, 2, 3]);
  assert.equal(result.total, 4);
  assert.equal(requests.length, 4);
  assert.ok(
    requests.every((request) => request.searchParams.get('belongs to-application') === 'eq.42'),
  );
  assert.ok(
    requests.some(
      (request) => request.searchParams.get('and') === '(api heartbeat state.eq.online)',
    ),
  );
  assert.ok(
    requests.some(
      (request) => request.searchParams.get('and') === '(api heartbeat state.in.(offline,timeout,unknown))',
    ),
  );
});

test('legacy connectivity pagination reverses the semantic groups for ascending order', async () => {
  const { httpClient } = createHttpClient();
  const provider = postgrestDataProvider('https://postgrest.example', httpClient, 'eq', new Map(), false);

  const result = await provider.getList('device', {
    pagination: { page: 1, perPage: 3 },
    sort: { field: 'connectivity', order: 'ASC' },
    filter: {},
  });

  assert.deepEqual(getIds(result), [4, 3, 2]);
  assert.equal(result.total, 4);
});

test('legacy connectivity pagination preserves reference constraints', async () => {
  const { httpClient, requests } = createHttpClient();
  const provider = postgrestDataProvider('https://postgrest.example', httpClient, 'eq', new Map(), false);

  const result = await provider.getManyReference('device', {
    target: 'belongs to-application',
    id: 42,
    pagination: { page: 1, perPage: 3 },
    sort: { field: 'connectivity', order: 'DESC' },
    filter: { 'is active': true },
  });

  assert.deepEqual(getIds(result), [1, 2, 3]);
  assert.equal(result.total, 4);
  assert.ok(
    requests.every(
      (request) =>
        request.searchParams.get('belongs to-application') === 'eq.42' &&
        request.searchParams.get('is active') === 'eq.true',
    ),
  );
});

test('modern connectivity uses one VPN query and semantic-version ordering ends with the primary key', async () => {
  const { httpClient, requests } = createHttpClient();
  const provider = postgrestDataProvider('https://postgrest.example', httpClient, 'eq', new Map(), true);

  await provider.getList('device', {
    pagination: { page: 1, perPage: 10 },
    sort: { field: 'connectivity', order: 'DESC' },
    filter: {},
  });

  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].searchParams.get('order'),
    'is connected to vpn.desc.nullslast,last vpn event.desc.nullslast,last connectivity event.desc.nullslast,device name.asc,id.asc',
  );

  requests.length = 0;

  await provider.getList('release', {
    pagination: { page: 1, perPage: 10 },
    sort: { field: 'version', order: 'DESC' },
    filter: {},
  });

  assert.equal(
    requests[0].searchParams.get('order'),
    'semver major.desc,semver minor.desc,semver patch.desc,semver revision.desc,id.desc',
  );
});
