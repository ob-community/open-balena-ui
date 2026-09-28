import assert from 'node:assert/strict';
import test from 'node:test';
import { deleteAllRelated } from './delete';

test('direct relationship cleanup uses custom delete functions when provided', async () => {
  const customDeletes: Array<Record<string, unknown>> = [];
  const deleteManyCalls: unknown[] = [];
  const events: string[] = [];
  const dataProvider = {
    getList: async (resource: string) => {
      events.push(`list:${resource}`);
      const data = resource === 'device' ? [{ id: 11 }, { id: 12 }] : [{ id: 21 }];
      return { data, total: data.length };
    },
    deleteMany: async (...args: unknown[]) => {
      deleteManyCalls.push(args);
      events.push('bulk-delete');
      return { data: [] };
    },
  };

  await deleteAllRelated(
    dataProvider,
    { id: 7 },
    [],
    [
      {
        remoteResource: 'device',
        remoteField: 'belongs to-application',
        localField: 'id',
        deleteFunction: async (record: Record<string, unknown>) => {
          customDeletes.push(record);
          events.push(`custom-delete:${record.id}`);
        },
      },
      {
        remoteResource: 'device tag',
        remoteField: 'device',
        localField: 'id',
      },
    ],
  );

  assert.deepEqual(customDeletes, [{ id: 11 }, { id: 12 }]);
  assert.equal(deleteManyCalls.length, 1);
  assert.deepEqual(events, ['list:device', 'custom-delete:11', 'custom-delete:12', 'list:device tag', 'bulk-delete']);
});

test('relationship cleanup paginates and de-duplicates before invoking custom deleters', async () => {
  const deletedIds: number[] = [];
  const dataProvider = {
    getList: async (_resource: string, params: { pagination: { page: number } }) => {
      if (params.pagination.page === 1) {
        return {
          data: Array.from({ length: 1000 }, (_, index) => ({ id: index + 1 })),
          total: 1001,
        };
      }
      return { data: [{ id: 1000 }, { id: 1001 }], total: 1001 };
    },
    deleteMany: async () => ({ data: [] }),
  };

  await deleteAllRelated(
    dataProvider,
    { id: 7 },
    [],
    [
      {
        remoteResource: 'device',
        remoteField: 'belongs to-application',
        localField: 'id',
        deleteFunction: async (record) => {
          deletedIds.push(Number(record.id));
        },
      },
    ],
  );

  assert.equal(deletedIds.length, 1001);
  assert.deepEqual(deletedIds.slice(-2), [1000, 1001]);
});
