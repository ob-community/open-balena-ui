import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
  type Query,
  type QueryKey,
  type QueryObserverOptions,
} from '@tanstack/react-query';
import { DataProviderContext, defaultDataProvider, type DataProvider } from 'react-admin';
import { MemoryRouter } from 'react-router-dom';
import { DeviceRefreshContext, DeviceRefreshProvider } from '../ui/DeviceRefreshContext';
import { useDeviceServicePresentation } from '../ui/useDeviceServicePresentation';
import {
  deviceServiceLogSource,
  deviceServiceTerminalTargets,
  getServiceColors,
} from '../lib/deviceServicePresentation';
import type { ResourceRecord } from '../types/resource';

type RefreshState = NonNullable<React.ContextType<typeof DeviceRefreshContext>>;
const device = {
  'id': 716116,
  'is running-release': 100,
  'should be managed by-release': 200,
};
const install = (id: number, imageId: number, releaseId = 100, status = 'Running'): ResourceRecord => ({
  'id': id,
  'installs-image': [{ __id: imageId }],
  'is provided by-release': { id: releaseId },
  status,
});
const initialInstalls = [install(1, 11), install(2, 12), install(3, 13, 200)];
const metadata = {
  image: [
    { 'id': 11, 'is a build of-service': { id: 21 } },
    { 'id': 12, 'is a build of-service': [{ __id: 22 }] },
    { 'id': 13, 'is a build of-service': 23 },
    { 'id': 14, 'is a build of-service': 24 },
  ],
  service: [
    { 'id': 21, 'service name': 'worker10' },
    { 'id': 22, 'service name': 'core' },
    { 'id': 23, 'service name': 'core' },
    { 'id': 24, 'service name': 'worker2' },
  ],
};
const listKey = [
  'image install',
  'getList',
  {
    pagination: { page: 1, perPage: 1000 },
    sort: { field: 'id', order: 'ASC' },
    filter: { device: device.id },
    meta: undefined,
  },
];
const ownerKey = ['image install', 'device-refresh', { filter: { device: device.id } }];
const refreshState = (installs: ResourceRecord[] | undefined = initialInstalls): RefreshState => ({
  deviceId: String(device.id),
  interval: 30_000,
  installs,
  installsIsPending: installs === undefined,
  installsError: null,
});

const harness = (context: test.TestContext) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  context.after(() => client.clear());
  const calls: Array<{ resource: string; ids?: (string | number)[] }> = [];
  const provider: DataProvider = {
    ...defaultDataProvider,
    getList: async (resource) => {
      calls.push({ resource });
      return { data: initialInstalls, total: initialInstalls.length } as never;
    },
    getMany: async (resource, { ids }) => {
      calls.push({ resource, ids });
      const records = metadata[resource as keyof typeof metadata] ?? [];
      return { data: records.filter(({ id }) => ids.map(String).includes(String(id))) } as never;
    },
  };
  for (const [resource, records] of Object.entries(metadata)) {
    for (const record of records)
      client.setQueryData([resource, 'getOne', { id: String(record.id), meta: undefined }], record);
  }
  client.setQueryData(['release', 'getOne', { id: '200', meta: undefined }], { 'id': 200, 'raw version': '20.0.0' });
  let presentation!: ReturnType<typeof useDeviceServicePresentation>;
  let owner: React.ContextType<typeof DeviceRefreshContext>;
  const Capture = ({ record }: { record: ResourceRecord }) => {
    owner = React.useContext(DeviceRefreshContext);
    presentation = useDeviceServicePresentation(record);
    return React.createElement('output', null, presentation.services.map(({ serviceName }) => serviceName).join(','));
  };
  const render = (state?: RefreshState, record: ResourceRecord = device, owned = false) => {
    const content = React.createElement(Capture, { record });
    const wrapped = owned
      ? React.createElement(DeviceRefreshProvider, { deviceId: String(device.id) }, content)
      : React.createElement(DeviceRefreshContext.Provider, { value: state }, content);
    const html = renderToString(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(DataProviderContext.Provider, { value: provider }, wrapped),
        ),
      ),
    );
    return { presentation, owner, html };
  };
  const query = (key: QueryKey) => {
    const result = client.getQueryCache().find({ queryKey: key, exact: true });
    assert.ok(result, `Missing query: ${JSON.stringify(key)}`);
    return result as Query & { options: QueryObserverOptions };
  };
  const manyKey = (resource: string, ids: number[]) => [resource, 'getMany', { ids: ids.map(String), meta: undefined }];
  const fetchMetadata = async (imageIds: number[], serviceIds: number[]) => {
    for (const [resource, ids] of [
      ['image', imageIds],
      ['service', serviceIds],
    ] as const) {
      const key = manyKey(resource, [...ids]);
      assert.equal(query(key).options.enabled, true);
      await client.fetchQuery({ queryKey: key, queryFn: query(key).options.queryFn });
    }
  };
  return { client, calls, render, query, manyKey, fetchMetadata };
};

test('managed components use owner snapshots for external start/stop, release changes and metadata IDs', async (context) => {
  const { client, calls, render, query, fetchMetadata } = harness(context);
  // A permanently fresh legacy list must not participate in the managed presentation.
  client.setQueryData(listKey, { data: [install(99, 14)], total: 1 });
  const initial = render(refreshState()).presentation;
  assert.deepEqual(
    initial.services.map(({ serviceName }) => serviceName),
    ['core', 'worker10', 'core'],
  );
  assert.deepEqual(
    initial.services.map(({ serviceGroup }) => serviceGroup),
    ['app', 'app', 'supervisor'],
  );
  assert.equal(initial.isPending, false);
  assert.equal(initial.error, null);
  assert.equal(query(listKey).options.enabled, false);
  assert.equal(query(listKey).options.refetchInterval, false);
  const listObserver = new QueryObserver(client, query(listKey).options);
  const unsubscribe = listObserver.subscribe(() => {});
  context.after(unsubscribe);
  assert.equal(listObserver.getCurrentResult().fetchStatus, 'idle');
  await fetchMetadata([11, 12, 13], [21, 22, 23]);
  assert.deepEqual(calls, [
    { resource: 'image', ids: [11, 12, 13] },
    { resource: 'service', ids: [21, 22, 23] },
  ]);
  const color = getServiceColors(initial.appServices[0].serviceName);
  const stopped = render(
    refreshState([install(1, 11), install(2, 12, 100, 'Stopped'), install(3, 13, 200)]),
  ).presentation;
  assert.equal((stopped.appServices[0] as ResourceRecord).status, 'Stopped');
  assert.deepEqual(
    deviceServiceTerminalTargets(stopped.services).map(({ id }) => id),
    ['host', 'container:worker10', 'container:supervisor:core'],
  );
  const started = render(refreshState()).presentation;
  assert.deepEqual(deviceServiceTerminalTargets(started.services).slice(1), [
    { id: 'container:core', label: 'core', target: 'container', container: 'core', containerKind: 'service' },
    {
      id: 'container:worker10',
      label: 'worker10',
      target: 'container',
      container: 'worker10',
      containerKind: 'service',
    },
    {
      id: 'container:supervisor:core',
      label: 'core',
      target: 'container',
      container: 'balena_supervisor',
      containerKind: 'supervisor',
    },
  ]);
  assert.deepEqual(getServiceColors(started.appServices[0].serviceName), color);
  const changed = render(refreshState([install(4, 14, 101), install(5, 11, 101), install(3, 13, 200)]), {
    ...device,
    'is running-release': 101,
  }).presentation;
  assert.deepEqual(
    changed.appServices.map(({ serviceName }) => serviceName),
    ['worker2', 'worker10'],
  );
  await fetchMetadata([14, 11, 13], [24, 21, 23]);
  assert.deepEqual(calls.slice(2), [
    { resource: 'image', ids: [14, 11, 13] },
    { resource: 'service', ids: [24, 21, 23] },
  ]);
  assert.deepEqual(
    changed.services.map((service) => [service.serviceId, deviceServiceLogSource(service)]),
    [
      [24, 'service'],
      [21, 'service'],
      [23, 'supervisor'],
    ],
  );
  assert.equal(query(listKey).options.enabled, false);
  assert.deepEqual(client.getQueryData(listKey), { data: [install(99, 14)], total: 1 });
});

test('a new owner image fetches its metadata and then its service without invalidating the install list', async (context) => {
  const { client, calls, render, query, manyKey } = harness(context);
  render(refreshState());
  client.removeQueries({ queryKey: ['image', 'getOne', { id: '14', meta: undefined }], exact: true });
  client.removeQueries({ queryKey: ['service', 'getOne', { id: '24', meta: undefined }], exact: true });
  const state = refreshState([install(4, 14, 101)]);
  const record = { ...device, 'is running-release': 101 };
  const imagePending = render(state, record).presentation;
  assert.equal(imagePending.isPending, true);
  assert.equal(imagePending.appServices[0].serviceName, 'Unknown service');
  const imageKey = manyKey('image', [14]);
  await client.fetchQuery({ queryKey: imageKey, queryFn: query(imageKey).options.queryFn });
  const servicePending = render(state, record).presentation;
  assert.equal(servicePending.isPending, true);
  const serviceKey = manyKey('service', [24]);
  assert.equal(query(serviceKey).options.enabled, true);
  await client.fetchQuery({ queryKey: serviceKey, queryFn: query(serviceKey).options.queryFn });
  const ready = render(state, record).presentation;
  assert.equal(ready.isPending, false);
  assert.equal(ready.appServices[0].serviceName, 'worker2');
  assert.equal(deviceServiceTerminalTargets(ready.services)[1].id, 'container:worker2');
  assert.deepEqual(calls, [
    { resource: 'image', ids: [14] },
    { resource: 'service', ids: [24] },
  ]);
  assert.equal(query(listKey).options.enabled, false);
});

test('managed pending, error and empty snapshots never fall back to a successful legacy list or cached owner rows', (context) => {
  const { client, render, query, manyKey } = harness(context);
  client.setQueryData(listKey, { data: initialInstalls, total: initialInstalls.length });
  for (const state of [
    { ...refreshState(), installs: undefined, installsIsPending: true },
    { ...refreshState(), installsIsPending: true },
    { ...refreshState(), installsError: new Error('Owner request failed') },
    refreshState([]),
  ]) {
    const result = render(state).presentation;
    assert.deepEqual(result.services, []);
    assert.equal(result.isPending, state.installsIsPending);
    assert.equal(result.error, state.installsError);
    assert.equal(query(listKey).options.enabled, false);
    assert.equal(query(manyKey('image', [])).options.enabled, false);
    assert.equal(query(manyKey('service', [])).options.enabled, false);
    assert.deepEqual(deviceServiceTerminalTargets(result.services), [{ id: 'host', label: 'Host OS', target: 'host' }]);
  }
  query(listKey).setState({ status: 'error', error: new Error('Unused legacy failure') });
  const recovered = render(refreshState()).presentation;
  assert.equal(recovered.error, null);
  assert.equal(recovered.services.length, 3);
});

test('new image metadata is pending rather than reusing the previous service identity', async (context) => {
  const { client, render, query, manyKey } = harness(context);
  render(refreshState());
  const result = render(refreshState([install(6, 999)])).presentation;
  assert.equal(result.isPending, true);
  assert.equal(query(manyKey('image', [999])).options.enabled, true);
  assert.deepEqual(
    result.appServices.map(({ serviceName }) => serviceName),
    ['Unknown service'],
  );
  assert.deepEqual(deviceServiceTerminalTargets(result.services), [{ id: 'host', label: 'Host OS', target: 'host' }]);
  const failure = new Error('Image metadata failed');
  client.setQueryData(manyKey('image', [999]), []);
  query(manyKey('image', [999])).setState({ status: 'error', error: failure });
  assert.equal(render(refreshState([install(6, 999)])).presentation.error, failure);
});

test('standalone and nonmatching managed contexts retain their own list and adaptive polling', async (context) => {
  const { client, calls, render, query } = harness(context);
  for (const state of [undefined, { ...refreshState([]), deviceId: 'another-device' }]) {
    render(state);
    const list = query(listKey);
    assert.equal(list.options.enabled, true);
    assert.equal(list.options.staleTime, 30_000);
    assert.equal(list.options.refetchIntervalInBackground, false);
    assert.equal(typeof list.options.refetchInterval, 'function');
    assert.ok(typeof list.options.refetchInterval === 'function');
    assert.equal(list.options.refetchInterval(list), 30_000);
    client.setQueryData(listKey, { data: [install(1, 11, 100, 'Stopping')], total: 1 });
    assert.equal(list.options.refetchInterval(list), 1000);
    assert.equal((render(state).presentation.appServices[0] as ResourceRecord).status, 'Stopping');
    client.removeQueries({ queryKey: listKey, exact: true });
  }
  render();
  await client.fetchQuery({ queryKey: listKey, queryFn: query(listKey).options.queryFn });
  assert.deepEqual(calls, [{ resource: 'image install' }]);
  assert.equal(render().presentation.services.length, 3);
});

test('refresh owner exposes installation loading/error and passes updated snapshots to managed components', (context) => {
  const { client, render, query } = harness(context);
  client.setQueryData(['device', 'getOne', { id: String(device.id), meta: undefined }], device);
  const pending = render(undefined, device, true);
  assert.equal(pending.owner?.installs, undefined);
  assert.equal(pending.owner?.installsIsPending, true);
  assert.equal(pending.presentation.isPending, true);
  assert.deepEqual(pending.presentation.services, []);
  client.setQueryData(ownerKey, { records: initialInstalls, requestedAt: 1 });
  const ready = render(undefined, device, true);
  assert.deepEqual(ready.owner?.installs, initialInstalls);
  assert.equal(ready.owner?.installsIsPending, false);
  assert.equal(ready.owner?.installsError, null);
  assert.equal(ready.presentation.services.length, 3);
  client.setQueryData(ownerKey, { records: [install(1, 11, 100, 'Stopped')], requestedAt: 2 });
  assert.equal((render(undefined, device, true).presentation.appServices[0] as ResourceRecord).status, 'Stopped');
  const failure = new Error('Install refresh failed');
  query(ownerKey).setState({ status: 'error', error: failure });
  const failed = render(undefined, device, true);
  assert.equal(failed.owner?.installsError, failure);
  assert.equal(failed.presentation.error, failure);
  assert.deepEqual(failed.presentation.services, []);
  assert.match(failed.html, /Unable to refresh device state:.*Install refresh failed/);
  client.setQueryData(ownerKey, { records: [], requestedAt: 3 });
  const empty = render(undefined, device, true);
  assert.equal(empty.presentation.isPending, false);
  assert.equal(empty.presentation.error, null);
  assert.deepEqual(empty.presentation.services, []);
  assert.equal(query(listKey).options.enabled, false);
});
