import assert from 'node:assert/strict';
import test from 'node:test';
import { requestSignal } from './requestSignal';

test('requestSignal reads React Admin query signals but does not infer mutation signals from meta', () => {
  const controller = new AbortController();

  assert.equal(requestSignal({ signal: controller.signal }), controller.signal);
  assert.equal(requestSignal({ meta: { signal: controller.signal } }), undefined);
  assert.equal(requestSignal(undefined), undefined);
});
