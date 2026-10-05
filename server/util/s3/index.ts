import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import s3Client from './client';
import bucketNames from './bucketNames';

const nextPageToken = (
  isTruncated: boolean | undefined,
  token: string | undefined,
  seen: Set<string>,
): string | undefined => {
  if (!isTruncated) {
    return undefined;
  }
  if (!token || seen.has(token)) {
    throw new Error('S3 returned a truncated listing without a new continuation token.');
  }
  seen.add(token);
  return token;
};

const listObjectKeys = async (bucket: string, prefix: string): Promise<string[]> => {
  const objectKeys: string[] = [];
  const seenTokens = new Set<string>();
  let continuationToken: string | undefined;

  do {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );

    const contents = response.Contents ?? [];
    for (const item of contents) {
      if (item.Key) {
        objectKeys.push(item.Key);
      }
    }

    continuationToken = nextPageToken(response.IsTruncated, response.NextContinuationToken, seenTokens);
  } while (continuationToken);

  return objectKeys;
};

const listCommonPrefixes = async (bucket: string, prefix: string): Promise<string[]> => {
  const prefixes = new Set<string>();
  const seenTokens = new Set<string>();
  let continuationToken: string | undefined;

  do {
    const response = await s3Client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        Delimiter: '/',
        ContinuationToken: continuationToken,
      }),
    );

    const commonPrefixes = response.CommonPrefixes ?? [];
    for (const item of commonPrefixes) {
      if (item.Prefix) {
        prefixes.add(item.Prefix);
      }
    }

    continuationToken = nextPageToken(response.IsTruncated, response.NextContinuationToken, seenTokens);
  } while (continuationToken);

  return [...prefixes];
};

const deleteObjects = async (bucket: string, keys: string[]): Promise<void> => {
  if (keys.length === 0) {
    return;
  }

  const chunkSize = 1000;
  for (let index = 0; index < keys.length; index += chunkSize) {
    const chunk = keys.slice(index, index + chunkSize);
    const response = await s3Client.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
          Quiet: true,
        },
      }),
    );

    const errors = response.Errors ?? [];
    if (errors.length > 0) {
      const failedKeys = errors.map((error) => error.Key).filter((key): key is string => Boolean(key));
      throw new Error(`Failed to delete S3 objects: ${failedKeys.join(', ')}`);
    }
  }
};

export { s3Client, bucketNames, listObjectKeys, listCommonPrefixes, deleteObjects };

export default {
  s3Client,
  bucketNames,
  listObjectKeys,
  listCommonPrefixes,
  deleteObjects,
};
