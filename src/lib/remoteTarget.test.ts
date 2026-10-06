import assert from 'node:assert/strict';
import test from 'node:test';
import { parseContainerSelector, parseRemoteTarget } from './remoteTarget';

test('explicit selector kinds take priority while absent kinds retain legacy reserved-name semantics', () => {
  assert.deepEqual(parseContainerSelector('balena_supervisor', 'service'), {
    container: 'balena_supervisor',
    containerKind: 'service',
  });
  assert.deepEqual(
    parseContainerSelector('balena_supervisor', 'supervisor'),
    parseContainerSelector('balena_supervisor'),
  );
  assert.deepEqual(parseContainerSelector('core'), { container: 'core', containerKind: 'service' });
  assert.deepEqual(parseRemoteTarget('host', undefined), { target: 'host' });
});

test('target validation rejects malformed discriminators, names, and incompatible host or Supervisor combinations', () => {
  for (const kind of [null, '', 'host', 'Service', 1, [], {}, ['service']]) {
    assert.throws(() => parseContainerSelector('balena_supervisor', kind), /container kind/);
  }
  for (const name of [undefined, null, '', [], {}, ['app'], 'app;id', 'x'.repeat(129)]) {
    assert.throws(() => parseContainerSelector(name, 'service'), /container name/);
  }
  assert.throws(() => parseContainerSelector('core', 'supervisor'), /Supervisor selector/);
  assert.throws(() => parseRemoteTarget('container', undefined, 'service'), /container name/);
  assert.throws(() => parseRemoteTarget('host', 'app'), /Host targets/);
  assert.throws(() => parseRemoteTarget('host', undefined, 'service'), /Host targets/);
  assert.throws(() => parseRemoteTarget('Host', undefined), /remote target/);
});
