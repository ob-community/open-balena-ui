import assert from 'node:assert/strict';
import test from 'node:test';
import { PERMISSION_HINT, withPermissionHint } from './httpErrorMessage';

test('401 messages retain their context and include permission guidance once', () => {
  assert.equal(withPermissionHint('Unauthorized', 401), `Unauthorized. ${PERMISSION_HINT}`);
  assert.equal(
    withPermissionHint('Unable to delete device (401).', 401),
    `Unable to delete device (401). ${PERMISSION_HINT}`,
  );
  assert.equal(withPermissionHint('', 401), PERMISSION_HINT);
  const message = `Unauthorized. ${PERMISSION_HINT}`;
  assert.equal(withPermissionHint(message, 401), message);
});

test('other statuses do not receive permission guidance', () => {
  for (const status of [undefined, 200, 400, 403, 404, 500, 502, 504]) {
    assert.equal(withPermissionHint('Original error', status), 'Original error');
  }
});
