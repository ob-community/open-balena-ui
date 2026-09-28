import assert from 'node:assert/strict';
import test from 'node:test';
import type { DataProvider } from 'react-admin';
import { modifyUser } from './user';

test('organization-admin user updates skip hidden direct permissions', async () => {
  const listResources: string[] = [];
  const dataProvider = {
    getList: async (resource: string) => {
      listResources.push(resource);
      return { data: [], total: 0 };
    },
    create: async () => ({ data: { id: 1 } }),
    delete: async () => ({ data: { id: 1 } }),
  } as Pick<DataProvider, 'getList' | 'create' | 'delete'>;

  const result = await modifyUser(dataProvider, {
    id: 11,
    email: 'user@example.test',
    organizationArray: [2],
    roleArray: [4],
  });

  assert.deepEqual(result, { id: 11, email: 'user@example.test' });
  assert.deepEqual(listResources.sort(), ['organization membership', 'user-has-role']);
});
