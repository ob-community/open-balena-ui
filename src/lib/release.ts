import { useDataProvider } from 'react-admin';
import { useDeleteImage } from './image';
import { deleteAllRelated } from './delete';

export function useDeleteRelease() {
  const dataProvider = useDataProvider();
  const deleteImage = useDeleteImage();

  return async (release) => {
    let relatedIndirectLookups = [
      {
        remoteResource: 'image',
        remoteField: 'id',
        viaRemoteField: 'image',
        viaResource: 'image-is part of-release',
        viaLocalField: 'is part of-release',
        localField: 'id',
        deleteFunction: deleteImage,
      },
    ];

    let relatedDirectLookups = [
      { remoteResource: 'release tag', remoteField: 'release', localField: 'id' },
      { remoteResource: 'release asset', remoteField: 'release', localField: 'id' },
    ];
    await deleteAllRelated(dataProvider, release, relatedIndirectLookups, relatedDirectLookups);
    await dataProvider.delete('release', { id: release['id'] });
    return Promise.resolve();
  };
}

export function useDeleteReleaseBulk() {
  const dataProvider = useDataProvider();
  const deleteRelease = useDeleteRelease();

  return async (releaseIds) => {
    const selectedReleases = await dataProvider.getMany('release', { ids: releaseIds });
    return Promise.all(selectedReleases.data.map((release) => deleteRelease(release)));
  };
}
