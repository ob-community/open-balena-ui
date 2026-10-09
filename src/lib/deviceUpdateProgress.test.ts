import assert from 'node:assert/strict';
import test from 'node:test';
import { getDeviceOsUpdateProgress, getProgressPercentage } from './deviceUpdateProgress';

test('reported percentages include zero and 100 but exclude invalid or missing values', () => {
  for (const value of [0, 25, 50, 99.5, 100, '0', '50', '100']) {
    assert.equal(getProgressPercentage(value), Number(value));
  }
  for (const value of [null, undefined, '', ' ', false, -1, 101, Infinity, NaN, 'unknown']) {
    assert.equal(getProgressPercentage(value), undefined);
  }
});

test('Host OS updater stages remain distinct from initial provisioning and app updates', () => {
  for (const [stage, progress] of [
    ['Preparing OS update', 25],
    ['Running OS update', 50],
    ['Patching supervisor update', 90],
    ['Running supervisor update', 95],
  ] as const) {
    assert.deepEqual(getDeviceOsUpdateProgress({ 'provisioning state': stage, 'provisioning progress': progress }), {
      stage,
      progress,
      status: 'active',
    });
  }
  for (const stage of [undefined, null, '', 'post-provisioning', 'configuring', 'Downloading', 'Installed']) {
    assert.equal(
      getDeviceOsUpdateProgress({ 'provisioning state': stage, 'provisioning progress': 50, 'download progress': 31 }),
      undefined,
    );
  }
  assert.equal(getDeviceOsUpdateProgress(null), undefined);
});

test('Host OS terminal reports distinguish failure from successful installation awaiting reboot', () => {
  assert.deepEqual(
    getDeviceOsUpdateProgress({ 'provisioning state': 'OS update failed', 'provisioning progress': 100 }),
    { stage: 'OS update failed', progress: 100, status: 'failed' },
  );
  for (const stage of ['Update successful, rebooting', 'Update successful pending reboot.']) {
    assert.deepEqual(getDeviceOsUpdateProgress({ 'provisioning state': stage, 'provisioning progress': 100 }), {
      stage,
      progress: 100,
      status: 'complete',
    });
  }
  assert.deepEqual(getDeviceOsUpdateProgress({ 'provisioning state': '  Running OS update  ' }), {
    stage: 'Running OS update',
    progress: undefined,
    status: 'active',
  });
});
