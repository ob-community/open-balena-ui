import { useDataProvider } from 'react-admin';
import { useDeleteImage } from './image';
import { deleteAllRelated } from './delete';

export function useDeleteService() {
  const dataProvider = useDataProvider();
  const deleteImage = useDeleteImage();

  return async (service) => {
    let relatedIndirectLookups = [
      {
        remoteResource: 'device service environment variable',
        remoteField: 'service install',
        viaRemoteField: 'id',
        viaResource: 'service install',
        viaLocalField: 'installs-service',
        localField: 'id',
      },
    ];

    let relatedDirectLookups = [
      { remoteResource: 'service environment variable', remoteField: 'service', localField: 'id' },
      { remoteResource: 'service label', remoteField: 'service', localField: 'id' },
      { remoteResource: 'service install', remoteField: 'installs-service', localField: 'id' },
      { remoteResource: 'image', remoteField: 'is a build of-service', localField: 'id', deleteFunction: deleteImage },
    ];
    await deleteAllRelated(dataProvider, service, relatedIndirectLookups, relatedDirectLookups);
    await dataProvider.delete('service', { id: service['id'] });
    return Promise.resolve();
  };
}
