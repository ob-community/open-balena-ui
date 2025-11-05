import { useDataProvider } from 'react-admin';
import { deleteAllRelated } from './delete';

export function useGenerateApiKey() {
  return () => {
    const keyLength = 32;
    const characters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let i,
      key = '';
    const charactersLength = characters.length;
    for (i = 0; i < keyLength; i++) {
      key += characters.substr(Math.floor(Math.random() * charactersLength + 1), 1);
    }
    return key;
  };
}

export function useCreateApiKey() {
  return (data) => {
    data['is of-actor'] = data.userActor || data.deviceActor || data.fleetActor;
    ['userActor', 'deviceActor', 'fleetActor'].forEach((x) => delete data[x]);
    return data;
  };
}

export function useModifyApiKey() {
  const dataProvider = useDataProvider();

  const modifyMappingTable = async (data, field, table, sourceField, destField) => {
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

  return async (data) => {
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
      Object.keys(mappings).map((x) =>
        modifyMappingTable(data, mappings[x].field, mappings[x].table, mappings[x].sourceField, mappings[x].destField),
      ),
    );
    Object.keys(mappings).forEach((x) => delete data[mappings[x].field]);
    return data;
  };
}

export function useDeleteApiKey() {
  const dataProvider = useDataProvider();

  return async (apiKey) => {
    let relatedIndirectLookups = [];
    let relatedDirectLookups = [
      { remoteResource: 'api key-has-permission', remoteField: 'api key', localField: 'id' },
      { remoteResource: 'api key-has-role', remoteField: 'api key', localField: 'id' },
    ];
    await deleteAllRelated(dataProvider, apiKey, relatedIndirectLookups, relatedDirectLookups);
    await dataProvider.delete('api key', { id: apiKey.id });
    return Promise.resolve();
  };
}

export function useDeleteApiKeyBulk() {
  const dataProvider = useDataProvider();
  const deleteApiKey = useDeleteApiKey();

  return async (apiKeyIds) => {
    const selectedApiKeys = await dataProvider.getMany('api key', { ids: apiKeyIds });
    return Promise.all(selectedApiKeys.data.map((apiKey) => deleteApiKey(apiKey)));
  };
}
