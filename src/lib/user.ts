import base32Encode from 'base32-encode';
import { hashSync } from 'bcrypt-ts';
import { useDataProvider } from 'react-admin';
import { useDeleteApiKey, useGenerateApiKey } from './apiKey';
import { deleteAllRelated } from './delete';

const hashPassword = (password) => {
  const saltRounds = 10;
  return hashSync(password, saltRounds).replace('2a', '2b');
};

export function useCreateUser() {
  const dataProvider = useDataProvider();
  const generateApiKey = useGenerateApiKey();

  return async (data) => {
    const roles = await dataProvider.getList('role', {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: {},
    });
    // create user actor and user API key
    const userRole = roles.data.find((x) => x.name === 'named-user-api-key');
    const userActor = await dataProvider.create('actor', { data: {} });
    data.actor = userActor.data.id;
    const userApiKey = await dataProvider.create('api key', {
      data: { 'key': generateApiKey(), 'is of-actor': userActor.data.id },
    });
    await dataProvider.create('api key-has-role', { data: { 'api key': userApiKey.data.id, 'role': userRole.id } });
    // hash password and generate jwt secret
    data.password = hashPassword(data.password);
    const randomBytes = new Uint8Array(20);
    crypto.getRandomValues(randomBytes);
    data['jwt secret'] = base32Encode(randomBytes, 'RFC3548').toString();
    return data;
  };
}

export function useModifyUser() {
  const dataProvider = useDataProvider();

  const modifyMappingTable = async (data, field, table, sourceField, destField) => {
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

  return async (data) => {
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
      Object.keys(mappings).map((x) =>
        modifyMappingTable(data, mappings[x].field, mappings[x].table, mappings[x].sourceField, mappings[x].destField),
      ),
    );
    Object.keys(mappings).forEach((x) => delete data[mappings[x].field]);
    return data;
  };
}

export function useDeleteUser() {
  const dataProvider = useDataProvider();
  const deleteApiKey = useDeleteApiKey();

  return async (user) => {
    let relatedIndirectLookups = [
      {
        remoteResource: 'api key',
        remoteField: 'is of-actor',
        viaRemoteField: 'id',
        viaResource: 'actor',
        viaLocalField: 'id',
        localField: 'actor',
        deleteFunction: deleteApiKey,
      },
    ];
    let relatedDirectLookups = [
      { remoteResource: 'user-has-permission', remoteField: 'user', localField: 'id' },
      { remoteResource: 'user-has-public key', remoteField: 'user', localField: 'id' },
      { remoteResource: 'user-has-role', remoteField: 'user', localField: 'id' },
      { remoteResource: 'organization membership', remoteField: 'user', localField: 'id' },
    ];
    await deleteAllRelated(dataProvider, user, relatedIndirectLookups, relatedDirectLookups);
    await dataProvider.delete('user', { id: user['id'] });
    await dataProvider.delete('actor', { id: user['actor'] });
    return Promise.resolve();
  };
}

export function useDeleteUserBulk() {
  const dataProvider = useDataProvider();
  const deleteUser = useDeleteUser();

  return async (userIds) => {
    const selectedUsers = await dataProvider.getMany('user', { ids: userIds });
    return Promise.all(selectedUsers.data.map((user) => deleteUser(user)));
  };
}
