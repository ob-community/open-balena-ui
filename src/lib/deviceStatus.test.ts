import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deviceOnlineStatusField,
  getDeviceOverallState,
  isDeviceOnline,
  isDeviceUpdating,
  usesVpnOnlineStatus,
} from './deviceStatus';

test('uses the API overall status when available', () => {
  assert.equal(
    getDeviceOverallState({
      'overall status': 'reduced-functionality',
      'api heartbeat state': 'online',
      'is connected to vpn': true,
    }),
    'Reduced Functionality',
  );
});

test('Host OS progress is updating rather than initial provisioning and does not invent connectivity', () => {
  const online = {
    [deviceOnlineStatusField]: usesVpnOnlineStatus ? true : 'online',
    'api heartbeat state': 'online',
    'last connectivity event': '2026-10-09T00:00:00Z',
  };
  const active = { ...online, 'provisioning state': 'Running OS update', 'provisioning progress': 50 };
  assert.equal(isDeviceUpdating(active), true);
  assert.equal(getDeviceOverallState(active), 'Updating');
  assert.equal(
    getDeviceOverallState({ ...online, 'provisioning state': 'post-provisioning', 'provisioning progress': 50 }),
    'Configuring',
  );
  const offline = {
    ...active,
    [deviceOnlineStatusField]: usesVpnOnlineStatus ? false : 'offline',
    'api heartbeat state': 'offline',
  };
  assert.equal(isDeviceOnline(offline), false);
  assert.equal(getDeviceOverallState(offline), 'Disconnected');
  assert.equal(
    getDeviceOverallState({ ...online, 'provisioning state': 'OS update failed', 'provisioning progress': 100 }),
    'OS update failed',
  );
  assert.equal(
    getDeviceOverallState({
      ...online,
      'provisioning state': 'Update successful, rebooting',
      'provisioning progress': 100,
    }),
    'Operational',
  );
});
