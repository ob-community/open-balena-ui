import { useDataProvider } from 'react-admin';
import { deleteAllRelated } from './delete';
import type { OpenBalenaDataProvider } from '../dataProvider/openBalenaDataProvider';

export function useCreateDevice() {
  return (data) => {
    // delete unused field
    delete data['operated by-application'];
    return data;
  };
}

export function useSetServicesForNewDevice() {
  const dataProvider = useDataProvider();

  return async (data) => {
    console.log(data);
    // create service installs
    const deviceServices = await dataProvider.getList('service', {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: { application: data['belongs to-application'] },
    });
    await Promise.all(
      deviceServices.data.map((service) =>
        dataProvider.create('service install', { data: { 'device': data.id, 'installs-service': service.id } }),
      ),
    );
  };
}

export function useModifyDevice() {
  const dataProvider = useDataProvider();

  return async (data) => {
    let existingMappings = await dataProvider.getList('service install', {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: { device: data.id },
    });
    let existingData = existingMappings.data.map((x) => x['installs-service']);
    let newMappings = await dataProvider.getList('service', {
      pagination: { page: 1, perPage: 1000 },
      sort: { field: 'id', order: 'ASC' },
      filter: { application: data['belongs to-application'] },
    });
    let newData = newMappings.data.map((x) => x.id);
    let deleteIds = existingMappings.data
      .filter((value) => !newData.includes(value['installs-service']))
      .map((x) => x.id);
    let createData = newData.filter((value) => !existingData.includes(value));
    await Promise.all(
      deleteIds.map((deleteId) =>
        dataProvider
          .getList('device service environment variable', {
            pagination: { page: 1, perPage: 1000 },
            sort: { field: 'id', order: 'ASC' },
            filter: { 'service install': deleteId },
          })
          .then((deviceServiceEnvVars) =>
            Promise.all(
              deviceServiceEnvVars.data.map((deviceServiceEnvVar) =>
                dataProvider.delete('device service environment variable', { id: deviceServiceEnvVar.id }),
              ),
            ),
          ),
      ),
    );
    await Promise.all(deleteIds.map((deleteId) => dataProvider.delete('service install', { id: deleteId })));
    await Promise.all(
      createData.map((createDataItem) =>
        dataProvider.create('service install', { data: { 'device': data.id, 'installs-service': createDataItem } }),
      ),
    );
    // delete unused field
    delete data['operated by-application'];
    return data;
  };
}

export function useDeleteDevice() {
  const dataProvider = useDataProvider<OpenBalenaDataProvider>();

  return async (device, authorizationChecked = false) => {
    if (!authorizationChecked) {
      await dataProvider.authorizeResourceActorDeletion({
        resource: 'device',
        id: device['id'],
        actorId: device['actor'],
      });
    }
    let relatedIndirectLookups = [
      {
        remoteResource: 'device service environment variable',
        remoteField: 'service install',
        viaRemoteField: 'id',
        viaResource: 'service install',
        viaLocalField: 'device',
        localField: 'id',
      },
    ];
    let relatedDirectLookups = [
      { remoteResource: 'device tag', remoteField: 'device', localField: 'id' },
      { remoteResource: 'device config variable', remoteField: 'device', localField: 'id' },
      { remoteResource: 'device environment variable', remoteField: 'device', localField: 'id' },
      { remoteResource: 'service install', remoteField: 'device', localField: 'id' },
      { remoteResource: 'image install', remoteField: 'device', localField: 'id' },
    ];
    await deleteAllRelated(dataProvider, device, relatedIndirectLookups, relatedDirectLookups);
    await dataProvider.deleteResourceActor({
      resource: 'device',
      id: device['id'],
      actorId: device['actor'],
    });
    return Promise.resolve();
  };
}

export function useDeleteDeviceBulk() {
  const dataProvider = useDataProvider<OpenBalenaDataProvider>();
  const deleteDevice = useDeleteDevice();

  return async (deviceIds) => {
    const selectedDevices = await dataProvider.getMany('device', { ids: deviceIds });
    await dataProvider.authorizeResourceActorDeletions({
      records: selectedDevices.data.map((device) => ({
        resource: 'device',
        id: device.id,
        actorId: device.actor,
      })),
    });
    return Promise.all(selectedDevices.data.map((device) => deleteDevice(device, true)));
  };
}
