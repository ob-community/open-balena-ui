import assert from 'node:assert/strict';
import test from 'node:test';
import { getDeviceOverallState } from './deviceStatus';

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
