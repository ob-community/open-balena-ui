import { useDataProvider } from 'react-admin';
import versions from '../versions';
import { deleteAllRelated } from './delete';
import environment from './reactAppEnv';

const deviceTypeAlias = versions.resource('deviceTypeAlias', environment.REACT_APP_OPEN_BALENA_API_VERSION);

export function useCreateDeviceType() {
  const dataProvider = useDataProvider();

  return async (data) => {
    const deviceType = await dataProvider.create('device type', { data: data });
    if (deviceTypeAlias) {
      await dataProvider.create('device type alias', {
        data: { 'device type': deviceType.data.id, 'is referenced by-alias': data['slug'] },
      });
    }
    return null;
  };
}

export function useDeleteDeviceType() {
  const dataProvider = useDataProvider();

  return async (deviceType) => {
    let relatedIndirectLookups = [];
    let relatedDirectLookups = deviceTypeAlias
      ? [{ remoteResource: 'device type alias', remoteField: 'device type', localField: 'id' }]
      : [];
    await deleteAllRelated(dataProvider, deviceType, relatedIndirectLookups, relatedDirectLookups);
    await dataProvider.delete('device type', { id: deviceType['id'] });
    return Promise.resolve();
  };
}

export function useDeleteDeviceTypeBulk() {
  const dataProvider = useDataProvider();
  const deleteDeviceType = useDeleteDeviceType();

  return async (deviceTypeIds) => {
    const selectedDeviceTypes = await dataProvider.getMany('device type', { ids: deviceTypeIds });
    return Promise.all(selectedDeviceTypes.data.map((device) => deleteDeviceType(device)));
  };
}
