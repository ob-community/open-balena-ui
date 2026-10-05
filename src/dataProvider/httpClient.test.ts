import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpError } from 'react-admin';
import { withPermissionHints } from './httpClient';
import { PERMISSION_HINT } from '../lib/httpErrorMessage';

test('HTTP 401 errors include guidance without changing status, body, or error identity', async () => {
  const body = { message: 'Unauthorized', details: 'Missing permission' };
  const error = new HttpError('Unauthorized', 401, body);
  const client = withPermissionHints(async () => {
    throw error;
  });

  await assert.rejects(client('https://api.example.test/v7/device(309)'), (caught) => {
    assert.equal(caught, error);
    assert.equal(error.message, `Unauthorized. ${PERMISSION_HINT}`);
    assert.equal(error.status, 401);
    assert.equal(error.body, body);
    return true;
  });
});

test('non-401 and already annotated forwarded errors preserve their messages', async () => {
  for (const error of [
    new HttpError('Forbidden', 403),
    new HttpError('Service unavailable', 503),
    new HttpError(`Unable to delete device (401). ${PERMISSION_HINT}`, 502),
    new Error('Network failure'),
  ]) {
    const message = error.message;
    const client = withPermissionHints(async () => {
      throw error;
    });
    await assert.rejects(client('/admin-db/actions/delete-resource-actor'), (caught) => {
      assert.equal(caught, error);
      assert.equal(error.message, message);
      return true;
    });
  }
});

test('successful requests retain their response, headers and abort signal', async () => {
  const controller = new AbortController();
  const options = { signal: controller.signal, headers: new Headers({ Accept: 'application/json' }) };
  const response = { status: 200, headers: new Headers(), body: '{}', json: {} };
  const client = withPermissionHints(async (url, receivedOptions) => {
    assert.equal(url, 'https://api.example.test/v7/device(309)');
    assert.equal(receivedOptions, options);
    return response;
  });
  assert.equal(await client('https://api.example.test/v7/device(309)', options), response);
});
