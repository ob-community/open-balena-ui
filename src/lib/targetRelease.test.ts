import assert from 'node:assert/strict';
import test from 'node:test';
import { openBalenaDataProvider } from '../dataProvider/openBalenaDataProvider';
import { fleetPinField, resolveDeviceTargetRelease, resolveFleetTargetRelease } from './targetRelease';

test('fleet release changes persist through the application relationship on legacy and modern APIs', async () => {
  for (const version of ['v0.139.0', 'v25.2.8', 'v26.1.0', 'v49.6.5']) {
    let stored = { id: 3, should_track_latest_release: false, should_be_running__release: 185 };
    const provider = openBalenaDataProvider(
      'https://api.example.test',
      async (url, options) => {
        assert.match(url, /\/v[67]\/application\(3\)$/);
        if (options?.method === 'PATCH') {
          const data = JSON.parse(String(options.body));
          assert.equal(data.should_be_running__release, 186);
          assert.equal('is_pinned_on__release' in data, false);
          stored = { ...stored, ...data };
          return { status: 204, headers: new Headers(), body: '', json: null };
        }
        return { status: 200, headers: new Headers(), body: JSON.stringify(stored), json: { d: stored } };
      },
      version,
    );
    const previousData = (await provider.getOne('application', { id: 3 })).data;
    await provider.update('application', {
      id: 3,
      previousData,
      data: { ...previousData, [fleetPinField]: 186 },
    });
    const reloaded = (await provider.getOne('application', { id: 3 })).data;
    assert.equal(reloaded[fleetPinField], 186);
    assert.deepEqual(resolveFleetTargetRelease({ record: reloaded, pinField: fleetPinField }), {
      targetReleaseId: 186,
      origin: 'fleet',
    });
  }
});

test('fleet target origins distinguish a fixed release from tracking latest', () => {
  for (const tracking of [true, false]) {
    assert.deepEqual(
      resolveFleetTargetRelease({
        record: { [fleetPinField]: 186, 'should track latest release': tracking },
        pinField: fleetPinField,
      }),
      { targetReleaseId: 186, origin: tracking ? 'latest' : 'fleet' },
    );
  }
  assert.deepEqual(resolveFleetTargetRelease({ record: null, pinField: fleetPinField }), {
    targetReleaseId: undefined,
    origin: 'latest',
  });
});

test('device pins take precedence over fleet targets without changing the fleet field', () => {
  const fleetRecord = { [fleetPinField]: 186, 'should track latest release': false };
  assert.deepEqual(
    resolveDeviceTargetRelease({
      record: { 'is pinned on-release': 185 },
      fleetRecord,
      pinField: 'is pinned on-release',
    }),
    { targetReleaseId: 185, origin: 'device' },
  );
  assert.deepEqual(resolveDeviceTargetRelease({ record: {}, fleetRecord, pinField: 'is pinned on-release' }), {
    targetReleaseId: 186,
    origin: 'fleet',
  });
  assert.deepEqual(
    resolveDeviceTargetRelease({
      record: {},
      fleetRecord: { ...fleetRecord, 'should track latest release': true },
      pinField: 'is pinned on-release',
    }),
    { targetReleaseId: 186, origin: 'latest' },
  );
});
