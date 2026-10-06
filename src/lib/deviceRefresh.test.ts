import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activeDeviceRefreshMs,
  deviceInstallFreshness,
  fetchDeviceInstallBatch,
  getDeviceRefreshInterval,
  isDeviceRefreshActive,
  settleDeviceActions,
  steadyDeviceRefreshMs,
  type PendingDeviceAction,
} from './deviceRefresh';
import { openBalenaDataProvider } from '../dataProvider/openBalenaDataProvider';
import { latestDeviceSnapshot } from './deviceSnapshots';

const device = { 'id': 25, 'status': 'idle', 'overall status': 'operational', 'is running-release': 100 };
const install = { 'id': 7, 'status': 'Running', 'is provided by-release': 100, 'installs-image': 11 };
const fresh = { device: 3000, installs: 3000 };
const action: PendingDeviceAction = {
  id: 'action',
  deviceId: 25,
  kind: 'restart',
  imageInstallId: 7,
  imageId: 11,
  startedAt: 1000,
  acknowledgedAt: 2000,
};

test('steady refresh is 30 seconds and in-progress state starts one-second polling on first load', () => {
  assert.equal(getDeviceRefreshInterval(device, [install]), steadyDeviceRefreshMs);
  for (const value of ['configuring', 'updating', 'restarting', 'rebooting'])
    assert.equal(getDeviceRefreshInterval({ ...device, 'overall status': value }), activeDeviceRefreshMs);
  assert.equal(getDeviceRefreshInterval(device, [{ ...install, status: 'Starting' }]), activeDeviceRefreshMs);
  assert.equal(getDeviceRefreshInterval({ ...device, 'update status': 'applying changes' }), activeDeviceRefreshMs);
  assert.equal(getDeviceRefreshInterval({ ...device, 'provisioning progress': 0 }), activeDeviceRefreshMs);
});

test('historical install transitions do not keep a settled device polling rapidly', () => {
  assert.equal(
    isDeviceRefreshActive(device, [{ ...install, 'status': 'Installed', 'is provided by-release': 99 }]),
    false,
  );
  assert.equal(
    isDeviceRefreshActive(device, [{ ...install, 'status': 'Downloading', 'is provided by-release': 101 }], 101),
    true,
  );
});

test('unreached OS, Supervisor and app targets remain rapid until convergence, but failures return steady', () => {
  const record = { ...device, 'os version': 'balenaOS 6.1.0', 'supervisor version': '20.1.0' };
  assert.equal(getDeviceRefreshInterval(record, [], [], { hostVersion: '6.2.0' }), 1000);
  assert.equal(getDeviceRefreshInterval(record, [], [], { supervisorVersion: '20.2.0' }), 1000);
  assert.equal(getDeviceRefreshInterval(record, [], [], { appReleaseId: 101 }), 1000);
  assert.equal(getDeviceRefreshInterval(record, [], [], { hostVersion: 'v6.1.0', appReleaseId: '100' }), 30000);
  assert.equal(
    getDeviceRefreshInterval({ ...record, 'update status': 'rejected' }, [], [], { hostVersion: '6.2.0' }),
    30000,
  );
});

test('command polling persists through request acknowledgment and requires a fresh post-ack install snapshot', () => {
  assert.equal(settleDeviceActions([{ ...action, acknowledgedAt: undefined }], device, [install], fresh).length, 1);
  assert.equal(settleDeviceActions([action], device, [install], { device: 3000, installs: 1999 }).length, 1);
  assert.equal(settleDeviceActions([action], device, [install], { device: 3000, installs: 2000 }).length, 1);
  assert.equal(settleDeviceActions([action], device, [{ ...install, status: 'Starting' }], fresh).length, 1);
  assert.deepEqual(settleDeviceActions([action], device, [install], fresh), []);
  assert.deepEqual(settleDeviceActions([action], device, [{ ...install, status: 'Error' }], fresh), []);
  assert.deepEqual(settleDeviceActions([action], device, [{ ...install, id: 8 }], fresh), []);
});

for (const requestedAt of [1500, 2000]) {
  test(`single-device pre-ack installs started at ${requestedAt} cannot settle a restart acknowledged at 2000`, async (context) => {
    let now = requestedAt;
    context.mock.method(Date, 'now', () => now);
    let respond!: (records: (typeof install)[]) => void;
    const provider = openBalenaDataProvider('https://api.example.test', async (url) => {
      const json = url.includes('/$count')
        ? 1
        : { value: await new Promise<(typeof install)[]>((resolve) => (respond = resolve)) };
      return { status: 200, headers: new Headers(), body: JSON.stringify(json), json };
    });
    const delayed = fetchDeviceInstallBatch(provider, [25], false, new AbortController().signal, true);
    now = 3000;
    respond([install]);
    const stale = await delayed;
    assert.equal(stale.requestedAt, requestedAt);
    const waiting = settleDeviceActions([action], device, stale.records, {
      device: now,
      installs: deviceInstallFreshness(stale),
    });
    assert.equal(waiting.length, 1);
    assert.equal(getDeviceRefreshInterval(device, stale.records, waiting), 1000);
    now = 3100;
    const request = fetchDeviceInstallBatch(provider, [25], false, new AbortController().signal, true);
    now = 4000;
    respond([install]);
    const fresh = await request;
    assert.equal(fresh.requestedAt, 3100);
    const remaining = settleDeviceActions(waiting, device, fresh.records, {
      device: now,
      installs: deviceInstallFreshness(fresh),
    });
    assert.deepEqual(remaining, []);
    assert.equal(getDeviceRefreshInterval(device, fresh.records, remaining), 30000);
  });
}

test('single-device snapshot freshness is the request start, not its delayed response time', async (context) => {
  let now = 1500;
  context.mock.method(Date, 'now', () => now);
  let respond!: (record: typeof device) => void;
  const provider = openBalenaDataProvider('https://api.example.test', async () => {
    const record = await new Promise<typeof device>((resolve) => (respond = resolve));
    const json = { value: [record] };
    return { status: 200, headers: new Headers(), body: JSON.stringify(json), json };
  });
  const delayed = provider.getOne('device', { id: 25 });
  now = 3000;
  respond(device);
  const result = await delayed;
  assert.equal(latestDeviceSnapshot(result.data)?.requestedAt, 1500);
});

test('stop completion recognizes stopped/exited/removed installs and does not accept still-running state', () => {
  const stop: PendingDeviceAction = { ...action, kind: 'stop' };
  assert.equal(settleDeviceActions([stop], device, [install], fresh).length, 1);
  for (const state of ['Stopped', 'Exited', 'Error'])
    assert.deepEqual(settleDeviceActions([stop], device, [{ ...install, status: state }], fresh), []);
  assert.deepEqual(settleDeviceActions([stop], device, [], fresh), []);
});

test('config polling survives the unchanged pre-action state and completes only after targets/reporting converge', () => {
  const os: PendingDeviceAction = {
    id: 'os',
    deviceId: 25,
    kind: 'host-os',
    targetField: 'should be operated by-release',
    targetReleaseId: 201,
    targetVersion: '6.2.0',
    startedAt: 1000,
    acknowledgedAt: 2000,
  };
  const old = { ...device, 'os version': '6.1.0', 'should be operated by-release': 200 };
  assert.equal(settleDeviceActions([os], old, [], fresh).length, 1);
  const started = { ...old, 'should be operated by-release': 201, 'overall status': 'updating' };
  const pending = settleDeviceActions([os], started, [], fresh);
  assert.equal(pending[0].observedTarget, true);
  assert.deepEqual(settleDeviceActions(pending, { ...started, 'update status': 'aborted' }, [], fresh), []);
  assert.deepEqual(
    settleDeviceActions(pending, { ...started, 'overall status': 'operational', 'os version': '6.2.0' }, [], fresh),
    [],
  );
  assert.deepEqual(settleDeviceActions(pending, old, [], fresh), []);
});

test('app target changes wait for deployment and fresh image state rather than settling on the previous running release', () => {
  const release: PendingDeviceAction = {
    id: 'release',
    deviceId: 25,
    kind: 'release',
    targetField: 'is pinned on-release',
    targetReleaseId: 101,
    startedAt: 1000,
    acknowledgedAt: 2000,
  };
  const record = { ...device, 'is pinned on-release': 101 };
  assert.equal(settleDeviceActions([release], record, [install], fresh).length, 1);
  assert.equal(
    settleDeviceActions([release], { ...record, 'is running-release': 101 }, [install], { ...fresh, installs: 1999 })
      .length,
    1,
  );
  assert.deepEqual(settleDeviceActions([release], { ...record, 'is running-release': 101 }, [install], fresh), []);
  assert.equal(
    settleDeviceActions([{ ...release, targetReleaseId: null }], device, [install], fresh).length,
    1,
    'an unknown fleet/latest target must not be reported as completed immediately',
  );
  assert.deepEqual(
    settleDeviceActions([{ ...release, targetReleaseId: null }], device, [install], fresh, { appReleaseId: 100 }),
    [],
  );
});
