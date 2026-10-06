import assert from 'node:assert/strict';
import test from 'node:test';
import type { Request } from 'express';
import { loadRemoteAccessConfig } from './config';
import { transferParameters } from './index';
import { parseControlMessage } from './protocol';
import { containerSelectionCommand } from './ssh';

const config = loadRemoteAccessConfig({
  OPEN_BALENA_TUNNEL_URL: 'https://tunnel.internal',
  OPEN_BALENA_POSTGREST_URL: 'http://postgrest:3000',
  REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test',
});
const transfer = (query: Record<string, unknown>) =>
  transferParameters(
    { query: { deviceUuid: 'a'.repeat(32), path: '/data/file', ...query } } as unknown as Request,
    config,
  );
const open = (values: Record<string, unknown>) =>
  parseControlMessage(
    JSON.stringify({ v: 1, type: 'open', channel: 1, target: 'container', cols: 80, rows: 24, ...values }),
  );

test('terminal and transfer validators normalize the same explicit and legacy selectors before SSH lookup', () => {
  for (const containerKind of ['service', 'supervisor', undefined] as const) {
    const parameters = { container: 'balena_supervisor', ...(containerKind === undefined ? {} : { containerKind }) };
    const terminal = open(parameters);
    const files = transfer(parameters);
    assert.equal(terminal.type, 'open');
    if (terminal.type !== 'open' || terminal.target !== 'container') assert.fail('Expected container terminal');
    assert.deepEqual(files.container, {
      target: 'container',
      container: terminal.container,
      containerKind: terminal.containerKind,
    });
    assert.equal(containerSelectionCommand(terminal), containerSelectionCommand(files.container!));
    assert.equal(terminal.containerKind, containerKind ?? 'supervisor');
  }
  assert.equal(transfer({}).container, undefined);
  assert.deepEqual(open({ target: 'host' }), { v: 1, type: 'open', channel: 1, target: 'host', cols: 80, rows: 24 });
});

test('terminal and transfer inputs reject malformed or incompatible selector combinations', () => {
  for (const values of [
    { container: 'app', containerKind: 'supervisor' },
    { container: 'app', containerKind: null },
    { container: 'app', containerKind: ['service'] },
    { container: 'app', containerKind: {} },
    { container: 'app', containerKind: 'unknown' },
    { container: 'bad;id', containerKind: 'service' },
    { container: ['app'], containerKind: 'service' },
    { containerKind: 'service' },
    { containerKind: 'supervisor' },
  ]) {
    assert.throws(() => open(values));
    assert.throws(() => transfer(values));
  }
  assert.throws(() => open({ target: 'host', container: 'app' }), /Host targets/);
  assert.throws(() => open({ target: 'host', containerKind: 'service' }), /Host targets/);
  assert.throws(() => transfer({ containerKind: ['service', 'supervisor'] }), /Host targets/);
});
