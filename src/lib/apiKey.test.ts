import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataProvider } from 'react-admin';
import { deleteApiKeysBulk } from './apiKey';

test('bulk API-key deletion uses one data provider deleteMany request', async () => {
  const calls: Array<{ resource: string; ids: Array<string | number> }> = [];
  const deleteMany: DataProvider['deleteMany'] = async (resource, params) => {
    calls.push({ resource, ids: [...params.ids] });
    return { data: params.ids };
  };

  const result = await deleteApiKeysBulk({ deleteMany }, [41, 42]);

  assert.deepEqual(result.data, [41, 42]);
  assert.deepEqual(calls, [{ resource: 'api key', ids: [41, 42] }]);
});
