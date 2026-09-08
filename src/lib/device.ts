import { useDataProvider } from 'react-admin';
import { useDeleteApiKey } from './apiKey';
import { deleteAllRelated } from './delete';
import type { OpenBalenaDataProvider } from '../dataProvider/openBalenaDataProvider';

export function useCreateDevice() {
  const dataProvider = useDataProvider<OpenBalenaDataProvider>();

  return async (data) => {
    const { actorId } = await dataProvider.createCredentialActor({ role: 'device-api-key' });
    data.actor = actorId;

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
  const dataProvider = useDataProvider();
  const deleteApiKey = useDeleteApiKey();

  return async (device) => {
    let relatedIndirectLookups = [
      {
        remoteResource: 'device service environment variable',
        remoteField: 'service install',
        viaRemoteField: 'id',
        viaResource: 'service install',
        viaLocalField: 'device',
        localField: 'id',
      },
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
      { remoteResource: 'device tag', remoteField: 'device', localField: 'id' },
      { remoteResource: 'device config variable', remoteField: 'device', localField: 'id' },
      { remoteResource: 'device environment variable', remoteField: 'device', localField: 'id' },
      { remoteResource: 'service install', remoteField: 'device', localField: 'id' },
      { remoteResource: 'image install', remoteField: 'device', localField: 'id' },
    ];
    await deleteAllRelated(dataProvider, device, relatedIndirectLookups, relatedDirectLookups);
    await dataProvider.delete('device', { id: device['id'] });
    await dataProvider.delete('actor', { id: device['actor'] });
    return Promise.resolve();
  };
}

export function useDeleteDeviceBulk() {
  const dataProvider = useDataProvider();
  const deleteDevice = useDeleteDevice();

  return async (deviceIds) => {
    const selectedDevices = await dataProvider.getMany('device', { ids: deviceIds });
    return Promise.all(selectedDevices.data.map((device) => deleteDevice(device)));
  };
}
