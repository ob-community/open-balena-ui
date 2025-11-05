import { bucketNames, listCommonPrefixes } from '../../util/s3';

const extractRepositoryName = (prefix: string): string | null => {
  const parts = prefix.split('repositories/v2/');
  if (parts.length < 2) {
    return null;
  }

  const repositorySegment = parts[1];
  const [name] = repositorySegment.split('/');
  return name ?? null;
};

const listRegistryImages = async (): Promise<string[]> => {
  const imageRepositories = 'data/docker/registry/v2/repositories/v2/';
  const registryImages = new Set<string>();
  const prefixes = await listCommonPrefixes(bucketNames.registry, imageRepositories);

  for (const prefix of prefixes) {
    const name = extractRepositoryName(prefix);
    if (name) {
      registryImages.add(name);
    }
  }

  return [...registryImages];
};

const deleteOrphanedRegistryImages = async (
  databaseImages: string[],
): Promise<{
  orphanedImages: string[];
  imagesToDelete: string[];
}> => {
  const registryImages = await listRegistryImages();

  const orphanedImages = registryImages.filter((image) => !databaseImages.includes(image));
  const imagesToDelete = databaseImages.filter((image) => !registryImages.includes(image));

  return { orphanedImages, imagesToDelete };
};

export default deleteOrphanedRegistryImages;
