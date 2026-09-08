import { useDataProvider } from 'react-admin';
import { useDeleteRelease } from './release';
import { useDeleteDevice } from './device';
import { useDeleteService } from '../lib/service';
import { useDeleteApiKey } from './apiKey';
import { deleteAllRelated } from './delete';
import type { OpenBalenaDataProvider } from '../dataProvider/openBalenaDataProvider';

export function useCreateFleet() {
  const dataProvider = useDataProvider<OpenBalenaDataProvider>();

  return async (data) => {
    const { actorId } = await dataProvider.createCredentialActor({ role: 'provisioning-api-key' });
    data.actor = actorId;
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
