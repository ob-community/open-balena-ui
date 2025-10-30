import { bucketNames, deleteObjects, listObjectKeys } from '../../util/s3/index.js';

const deleteRegistryImage = async (imageLocationHash: string): Promise<void> => {
  const imageRepository = `data/docker/registry/v2/repositories/v2/${imageLocationHash}`;

  const objectKeys = await listObjectKeys(bucketNames.registry, imageRepository);

  if (objectKeys.length === 0) {
    throw new Error('image not found');
  }

  await deleteObjects(bucketNames.registry, objectKeys);
};

export default deleteRegistryImage;
