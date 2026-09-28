import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addDeviceConnectionCredentials,
  buildDeviceConnectionUrl,
  parseRemoteBaseUrl,
  type DeviceConnectionTarget,
} from './deviceConnect';

test('remote connection base URLs fail closed for unsafe configuration', () => {
  for (const value of [
    undefined,
    '',
    ' remote.example.test',
    'javascript:alert(1)',
    'data:text/html,unsafe',
    '//remote.example.test',
    'https://user:password@remote.example.test',
  ]) {
    assert.equal(parseRemoteBaseUrl(value), undefined, String(value));
  }

  assert.equal(parseRemoteBaseUrl('https://remote.example.test/base')?.toString(), 'https://remote.example.test/base');
  assert.equal(parseRemoteBaseUrl('http://127.0.0.1:3002')?.origin, 'http://127.0.0.1:3002');
});

test('connection URLs remain on the configured remote origin', () => {
  const baseUrl = parseRemoteBaseUrl('https://remote.example.test/base');
  assert.ok(baseUrl);

  assert.equal(buildDeviceConnectionUrl(baseUrl, 'javascript:alert(1)', {}), undefined);
  assert.equal(buildDeviceConnectionUrl(baseUrl, 'data:text/html,unsafe', {}), undefined);
  assert.equal(buildDeviceConnectionUrl(baseUrl, '//remote.example.test/terminal', {}), undefined);
  assert.equal(buildDeviceConnectionUrl(baseUrl, '//attacker.example.test/terminal', {}), undefined);
  assert.equal(buildDeviceConnectionUrl(baseUrl, 'https://attacker.example.test/terminal', {}), undefined);

  const url = buildDeviceConnectionUrl(baseUrl, '/terminal?attacker=value#fragment', {
    service: 'tunnel',
    uuid: 'device uuid',
    jwt: 'header.payload/signature',
  });
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.origin, baseUrl.origin);
  assert.equal(parsed.pathname, '/terminal');
  assert.equal(parsed.hash, '');
  assert.equal(parsed.searchParams.get('attacker'), null);
  assert.equal(parsed.searchParams.get('service'), 'tunnel');
  assert.equal(parsed.searchParams.get('uuid'), 'device uuid');
  assert.equal(parsed.searchParams.get('jwt'), 'header.payload/signature');
});

test('terminal target selection accepts only known opaque identifiers', () => {
  const targets: DeviceConnectionTarget[] = [
    {
      id: 'host:ssh',
      label: 'host - SSH',
      url: 'https://remote.example.test/?service=ssh&uuid=device',
    },
  ];

  assert.equal(
    addDeviceConnectionCredentials(
      targets,
      'https://attacker.example.test/?service=ssh',
      'https://remote.example.test',
      'user',
      'private key',
    ),
    undefined,
  );

  const url = addDeviceConnectionCredentials(
    targets,
    'host:ssh',
    'https://remote.example.test',
    'user name',
    'private/key+=',
  );
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://remote.example.test');
  assert.equal(parsed.searchParams.get('username'), 'user name');
  assert.equal(parsed.searchParams.get('privateKey'), 'private/key+=');
});

test('credential completion rejects targets outside the expected origin', () => {
  assert.equal(
    addDeviceConnectionCredentials(
      [{ id: 'host:ssh', label: 'host - SSH', url: 'https://attacker.example.test/' }],
      'host:ssh',
      'https://remote.example.test',
      'user',
      'key',
    ),
    undefined,
  );
});
