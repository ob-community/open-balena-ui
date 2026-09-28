import { type DataProvider, type Identifier, useDataProvider } from 'react-admin';

export function useCreateApiKey() {
  return (data) => {
    data['is of-actor'] = data.userActor || data.deviceActor || data.fleetActor;
    ['userActor', 'deviceActor', 'fleetActor'].forEach((x) => delete data[x]);
    return data;
  };
}

export function useModifyApiKey() {
  const dataProvider = useDataProvider();
  return (data) => modifyApiKey(dataProvider, data);
}

export const modifyApiKey = async (
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
    let deleteIds = existingMappings.data.filter((value) => !data[field].includes(value[destField])).map((x) => x.id);
    await Promise.all(
      createData.map((newData) =>
        dataProvider.create(table, { data: { [sourceField]: data.id, [destField]: newData } }),
      ),
    );
    await Promise.all(deleteIds.map((deleteId) => dataProvider.delete(table, { id: deleteId })));
  };

  const mappings = {
    roleMapping: { field: 'roleArray', table: 'api key-has-role', sourceField: 'api key', destField: 'role' },
    permissionMapping: {
      field: 'permissionArray',
      table: 'api key-has-permission',
      sourceField: 'api key',
      destField: 'permission',
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

export function useDeleteApiKey() {
  const dataProvider = useDataProvider();

  return async (apiKey) => {
    await dataProvider.delete('api key', { id: apiKey.id });
    return Promise.resolve();
  };
}

export function useDeleteApiKeyBulk() {
  const dataProvider = useDataProvider();

  return (apiKeyIds: Identifier[]) => deleteApiKeysBulk(dataProvider, apiKeyIds);
}

export const deleteApiKeysBulk = (dataProvider: Pick<DataProvider, 'deleteMany'>, apiKeyIds: Identifier[]) =>
  dataProvider.deleteMany('api key', { ids: apiKeyIds });
