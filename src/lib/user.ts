import { useDataProvider } from 'react-admin';
import type { DataProvider } from 'react-admin';
import type { OpenBalenaDataProvider } from '../dataProvider/openBalenaDataProvider';

export function useModifyUser() {
  const dataProvider = useDataProvider();
  return (data) => modifyUser(dataProvider, data);
}

export const modifyUser = async (
  dataProvider: Pick<DataProvider, 'getList' | 'create' | 'delete'>,
  input: Record<string, any>,
) => {
  const data = { ...input };
  const modifyMappingTable = async (data, field, table, sourceField, destField) => {
    if (!Array.isArray(data[field])) {
      return;
    }
    let existingMappings = await dataProvider.getList(table, {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: { [sourceField]: data.id },
    });
    let existingData = existingMappings.data.map((x) => x[destField]);
    let createData = (data[field] || []).filter((value) => !existingData.includes(value));
    let deleteIds = existingMappings.data
      .filter((value) => !(data[field] || []).includes(value[destField]))
      .map((x) => x.id);
    await Promise.all(
      createData.map((newData) =>
        dataProvider.create(table, { data: { [sourceField]: data.id, [destField]: newData } }),
      ),
    );
    await Promise.all(deleteIds.map((deleteId) => dataProvider.delete(table, { id: deleteId })));
  };

  const mappings = {
    roleMapping: { field: 'roleArray', table: 'user-has-role', sourceField: 'user', destField: 'role' },
    permissionMapping: {
      field: 'permissionArray',
      table: 'user-has-permission',
      sourceField: 'user',
      destField: 'permission',
    },
    organizationMapping: {
      field: 'organizationArray',
      table: 'organization membership',
      sourceField: 'user',
      destField: 'is member of-organization',
    },
  };
  await Promise.all(
    Object.values(mappings).map((mapping) =>
      modifyMappingTable(data, mapping.field, mapping.table, mapping.sourceField, mapping.destField),
    ),
  );
  Object.values(mappings).forEach(({ field }) => delete data[field]);
  return data;
};

export function useDeleteUser() {
  const dataProvider = useDataProvider<OpenBalenaDataProvider>();

  return async (user, authorizationChecked = false) => {
    if (!authorizationChecked) {
      await dataProvider.authorizeResourceActorDeletion({
        resource: 'user',
        id: user['id'],
        actorId: user['actor'],
      });
    }
    await dataProvider.deleteResourceActor({
      resource: 'user',
      id: user['id'],
      actorId: user['actor'],
    });
    return Promise.resolve();
  };
}

export function useDeleteUserBulk() {
  const dataProvider = useDataProvider<OpenBalenaDataProvider>();
  const deleteUser = useDeleteUser();

  return async (userIds) => {
    const selectedUsers = await dataProvider.getMany('user', { ids: userIds });
    await dataProvider.authorizeResourceActorDeletions({
      records: selectedUsers.data.map((user) => ({
        resource: 'user',
        id: user.id,
        actorId: user.actor,
      })),
    });
    return Promise.all(selectedUsers.data.map((user) => deleteUser(user, true)));
  };
}
