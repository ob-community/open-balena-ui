import { useDataProvider } from 'react-admin';
import { useDeleteRelease } from './release';
import { useDeleteDevice } from './device';
import { useDeleteService } from '../lib/service';
import { deleteAllRelated } from './delete';
import type { OpenBalenaDataProvider } from '../dataProvider/openBalenaDataProvider';
export function useDeleteFleet() {
  const dataProvider = useDataProvider<OpenBalenaDataProvider>();
  const deleteRelease = useDeleteRelease();
  const deleteDevice = useDeleteDevice();
  const deleteService = useDeleteService();

  return async (fleet, authorizationChecked = false) => {
    if (!authorizationChecked) {
      await dataProvider.authorizeResourceActorDeletion({
        resource: 'application',
        id: fleet['id'],
        actorId: fleet['actor'],
      });
    }
    // to do: set "should be running-release" to null
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
    await deleteAllRelated(dataProvider, fleet, [], relatedDirectLookups);
    await dataProvider.deleteResourceActor({
      resource: 'application',
      id: fleet['id'],
      actorId: fleet['actor'],
    });
    return Promise.resolve();
  };
}

export function useDeleteFleetBulk() {
  const dataProvider = useDataProvider<OpenBalenaDataProvider>();
  const deleteFleet = useDeleteFleet();

  return async (fleetIds) => {
    const selectedFleets = await dataProvider.getMany('application', { ids: fleetIds });
    await dataProvider.authorizeResourceActorDeletions({
      records: selectedFleets.data.map((fleet) => ({
        resource: 'application',
        id: fleet.id,
        actorId: fleet.actor,
      })),
    });
    return Promise.all(selectedFleets.data.map((fleet) => deleteFleet(fleet, true)));
  };
}
