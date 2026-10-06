import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { openBalenaDataProvider } from '../dataProvider/openBalenaDataProvider';
import { loadSupervisorChoices, saveSupervisorTarget } from '../ui/DeviceFieldEditor';
import { useDeviceRefreshActions } from '../ui/useDeviceRefreshActions';
import {
  acknowledgeDeviceAction,
  getDeviceRefreshInterval,
  settleDeviceActions,
  type PendingDeviceAction,
} from '../lib/deviceRefresh';

const record = {
  'id': 25,
  'is of-device type': 3,
  'overall status': 'operational',
  'supervisor version': '20.1.0',
  'should be managed by-release': 100,
};
const providerFor = (result: unknown) =>
  openBalenaDataProvider('https://api.example.test', async (url) => {
    const json = url.startsWith('/device-update-options')
      ? { operatingSystems: [], supervisors: [{ id: '20.2.0', version: '20.2.0', target: 'version' }] }
      : result;
    return { status: 200, headers: new Headers(), body: JSON.stringify(json), json };
  });

test('a version choice resolves its numeric Supervisor release before acknowledgment and returns to steady polling', async () => {
  const provider = providerFor({ releaseId: 201, version: '20.2.0' });
  const [choice] = await loadSupervisorChoices(provider, record);
  assert.equal(choice.id, '20.2.0');
  const pending: PendingDeviceAction = {
    id: 'supervisor',
    deviceId: record.id,
    kind: 'supervisor',
    targetField: 'should be managed by-release',
    targetReleaseId: choice.id,
    targetVersion: choice.targetVersion,
    startedAt: 1000,
  };
  const resolved = await saveSupervisorTarget(provider, record, choice);
  const acknowledged = acknowledgeDeviceAction(pending, 2000, resolved);
  assert.ok('targetReleaseId' in acknowledged);
  assert.equal(acknowledged.targetReleaseId, 201);
  assert.equal(acknowledged.acknowledgedAt, 2000);
  assert.equal(pending.targetReleaseId, '20.2.0');
  const target = { ...record, 'should be managed by-release': 201 };
  const fresh = { device: 3000, installs: 3000 };
  const waiting = settleDeviceActions([acknowledged], target, [], fresh);
  assert.equal(waiting.length, 1);
  assert.equal(getDeviceRefreshInterval(target, [], waiting), 1000);
  const completed = { ...target, 'supervisor version': '20.2.0' };
  const remaining = settleDeviceActions(waiting, completed, [], fresh);
  assert.deepEqual(remaining, []);
  assert.equal(getDeviceRefreshInterval(completed, [], remaining, { supervisorVersion: '20.2.0' }), 30000);
  const failed = { ...target, 'update status': 'failed' };
  const failedActions = settleDeviceActions(waiting, failed, [], fresh);
  assert.deepEqual(failedActions, []);
  assert.equal(getDeviceRefreshInterval(failed, [], failedActions, { supervisorVersion: '20.2.0' }), 30000);
});

test('Supervisor saves reject missing versions, invalid devices, malformed responses and request failures', async () => {
  const choice = { id: '20.2.0', name: '20.2.0', targetVersion: '20.2.0' };
  for (const result of [
    null,
    undefined,
    {},
    { releaseId: '201', version: '20.2.0' },
    { releaseId: 0, version: '20.2.0' },
    { releaseId: -1, version: '20.2.0' },
    { releaseId: 1.5, version: '20.2.0' },
    { releaseId: 201, version: 20 },
    { releaseId: 201, version: '20.1.0' },
  ]) {
    await assert.rejects(saveSupervisorTarget(providerFor(result), record, choice), /response is invalid/);
  }
  await assert.rejects(saveSupervisorTarget(providerFor({}), record, { ...choice, targetVersion: '' }), /no version/);
  await assert.rejects(saveSupervisorTarget(providerFor({}), { ...record, id: 'invalid' }, choice), /ID is invalid/);
  const provider = openBalenaDataProvider('https://api.example.test', async () => {
    throw new Error('Synchronization failed');
  });
  await assert.rejects(saveSupervisorTarget(provider, record, choice), /Synchronization failed/);
});

test('acknowledgment without a resolved target preserves existing OS and release requests', () => {
  for (const kind of ['host-os', 'release'] as const) {
    const action: PendingDeviceAction = {
      id: kind,
      kind,
      deviceId: 25,
      targetField: kind === 'host-os' ? 'should be operated by-release' : 'is pinned on-release',
      targetReleaseId: 201,
      targetVersion: '6.2.0',
      startedAt: 1000,
    };
    assert.deepEqual(acknowledgeDeviceAction(action, 2000), { ...action, acknowledgedAt: 2000 });
  }
});

test('action registry atomically acknowledges the resolved Supervisor target and cancels failed saves', async (context) => {
  context.mock.method(Date, 'now', () => 2000);
  const client = new QueryClient();
  context.after(() => client.clear());
  let registry!: ReturnType<typeof useDeviceRefreshActions>;
  const Capture = () => {
    registry = useDeviceRefreshActions();
    return null;
  };
  renderToString(React.createElement(QueryClientProvider, { client }, React.createElement(Capture)));
  const request = {
    deviceId: 25,
    kind: 'supervisor' as const,
    targetField: 'should be managed by-release',
    targetReleaseId: '20.2.0',
    targetVersion: '20.2.0',
  };
  const id = registry.begin(request);
  const resolved = await saveSupervisorTarget(providerFor({ releaseId: 201, version: '20.2.0' }), record, {
    id: '20.2.0',
    name: '20.2.0',
    targetVersion: '20.2.0',
  });
  registry.acknowledge(id, resolved);
  const actions = client.getQueryData<Record<string, PendingDeviceAction[]>>(['device-refresh-actions'])!;
  assert.equal(actions['25'].length, 1);
  assert.ok('targetReleaseId' in actions['25'][0]);
  assert.equal(actions['25'][0].targetReleaseId, 201);
  assert.equal(actions['25'][0].acknowledgedAt, 2000);
  const completed = { ...record, 'supervisor version': '20.2.0', 'should be managed by-release': 201 };
  const remaining = settleDeviceActions(actions['25'], completed, [], { device: 3000, installs: 3000 });
  registry.settle(25, remaining);
  assert.deepEqual(client.getQueryData(['device-refresh-actions']), {});
  assert.equal(getDeviceRefreshInterval(completed, [], remaining), 30000);
  const failedId = registry.begin(request);
  await assert.rejects(
    saveSupervisorTarget(providerFor(null), record, { id: '20.2.0', name: '20.2.0', targetVersion: '20.2.0' }),
    /response is invalid/,
  );
  registry.cancel(failedId);
  assert.deepEqual(client.getQueryData(['device-refresh-actions']), {});
  assert.equal(getDeviceRefreshInterval(record), 30000);
});
