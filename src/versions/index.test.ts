import assert from 'node:assert/strict';
import test from 'node:test';
import versions from './index';

test('legacy versions use v0.139 compatibility mappings', () => {
  assert.equal(versions.resource('isPinnedOnRelease', 'v0.139.0'), 'should be running-release');
  assert.equal(versions.optionalField('applicationIsOfClass', 'v0.139.0'), undefined);
  assert.equal(versions.optionalResource('deviceTypeAlias', 'v0.139.0'), undefined);
});

test('features become available at their documented version boundaries', () => {
  assert.equal(versions.optionalField('applicationIsOfClass', 'v0.157.3'), 'is of-class');
  assert.equal(versions.optionalResource('deviceTypeAlias', 'v0.185.0'), 'device type alias');
  assert.equal(versions.resource('isPinnedOnRelease', 'v25.2.8'), 'is pinned on-release');
});

test('versions below the supported floor clamp to the oldest mappings', () => {
  assert.equal(versions.resource('isPinnedOnRelease', 'v0.100.0'), 'should be running-release');
  assert.equal(versions.optionalResource('deviceTypeAlias', 'v0.100.0'), undefined);
});
