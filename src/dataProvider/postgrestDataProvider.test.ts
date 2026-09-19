import assert from 'node:assert/strict';
import test from 'node:test';
import type { Options } from 'ra-core';
import postgrestDataProvider from './postgrestDataProvider';

const response = (json: unknown) => ({
  status: 200,
  headers: new Headers({ 'content-range': '0-0/1' }),
  body: JSON.stringify(json),
  json,
});

test('PostgREST bulk updates use the React Admin object-data contract', async () => {
  let request: { url: string; options?: Options } | undefined;
  const provider = postgrestDataProvider('/admin-db', async (url, options) => {
    request = { url, options };
    return response([{ id: 7 }, { id: 8 }]);
  });

  const result = await provider.updateMany('user', {
    ids: [7, 8],
    data: { id: 7, username: 'renamed' },
  });

  assert.equal(provider.supportAbortSignal, true);
  assert.deepEqual(result, { data: [7, 8] });
  assert.deepEqual(JSON.parse(String(request?.options?.body)), { username: 'renamed' });
});
