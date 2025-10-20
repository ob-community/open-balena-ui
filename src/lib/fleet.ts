import { useDataProvider } from 'react-admin';
import { useDeleteRelease } from './release';
import { useDeleteDevice } from './device';
import { useDeleteService } from '../lib/service';
import { useGenerateApiKey, useDeleteApiKey } from './apiKey';
import { deleteAllRelated } from './delete';

export function useCreateFleet() {
  const dataProvider = useDataProvider();
  const generateApiKey = useGenerateApiKey();

  return async (data) => {
    const roles = await dataProvider.getList('role', {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: {},
    });
    // create fleet actor and provisioning API key
    const fleetActor = await dataProvider.create('actor', { data: {} });
    data.actor = fleetActor.data.id;
    const provisioningRole = roles.data.find((x) => x.name === 'provisioning-api-key');
    const provisioningApiKey = await dataProvider.create('api key', {
      data: { 'key': generateApiKey(), 'is of-actor': fleetActor.data.id },
    });
    await dataProvider.create('api key-has-role', {
      data: { 'api key': provisioningApiKey.data.id, 'role': provisioningRole.id },
    });
    return data;
  };
}

export function useDeleteFleet() {
  const dataProvider = useDataProvider();
  const deleteRelease = useDeleteRelease();
  const deleteDevice = useDeleteDevice();
  const deleteService = useDeleteService();
  const deleteApiKey = useDeleteApiKey();

  return async (fleet) => {
    // to do: set "should be running-release" to null
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
      { remoteResource: 'service', remoteField: 'application', localField: 'id', deleteFunction: deleteService },
      {
        remoteResource: 'release',
        remoteField: 'belongs to-application',
        localField: 'id',
        deleteFunction: deleteRelease,
      },
      {
        remoteResource: 'device',
        remoteField: 'belongs to-application',
        localField: 'id',
        deleteFunction: deleteDevice,
      },
      { remoteResource: 'application config variable', remoteField: 'application', localField: 'id' },
      { remoteResource: 'application environment variable', remoteField: 'application', localField: 'id' },
      { remoteResource: 'application tag', remoteField: 'application', localField: 'id' },
    ];
    await deleteAllRelated(dataProvider, fleet, relatedIndirectLookups, relatedDirectLookups);
    await dataProvider.delete('application', { id: fleet['id'] });
    await dataProvider.delete('actor', { id: fleet['actor'] });
    return Promise.resolve();
  };
}

export function useDeleteFleetBulk() {
  const dataProvider = useDataProvider();
  const deleteFleet = useDeleteFleet();

  return async (fleetIds) => {
    const selectedFleets = await dataProvider.getMany('application', { ids: fleetIds });
    return Promise.all(selectedFleets.data.map((fleet) => deleteFleet(fleet)));
  };
}
