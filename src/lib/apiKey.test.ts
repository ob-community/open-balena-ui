import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataProvider } from 'react-admin';
import { deleteApiKeysBulk, modifyApiKey } from './apiKey';

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

test('API-key metadata updates skip hidden privilege mappings', async () => {
  const calls: string[] = [];
  const dataProvider = {
    getList: async () => {
      calls.push('getList');
      return { data: [], total: 0 };
    },
    create: async () => {
      calls.push('create');
      return { data: { id: 1 } };
    },
    delete: async () => {
      calls.push('delete');
      return { data: { id: 1 } };
    },
  } as Pick<DataProvider, 'getList' | 'create' | 'delete'>;

  assert.deepEqual(await modifyApiKey(dataProvider, { id: 373, name: 'Personal', description: 'Self-service key' }), {
    id: 373,
    name: 'Personal',
    description: 'Self-service key',
  });
  assert.deepEqual(calls, []);
});
