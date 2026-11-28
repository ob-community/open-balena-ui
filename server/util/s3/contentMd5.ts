import { createHash } from 'node:crypto';
import type { S3Client } from '@aws-sdk/client-s3';

const hasHeader = (headers: Record<string, string>, name: string): boolean =>
  Object.keys(headers).some((header) => header.toLowerCase() === name);

/**
 * Adds a Content-MD5 header to DeleteObjects (bulk delete) requests.
 *
 * Since @aws-sdk/client-s3 3.729 the SDK protects DeleteObjects with a CRC32 checksum
 * (x-amz-checksum-crc32) instead of Content-MD5. MinIO releases from before 2025 still require
 * Content-MD5 for DeleteObjects and reject the request with "MissingContentMD5" (HTTP 400), which
 * makes deleting releases/images fail. The SDK's own checksum headers are left untouched, so AWS S3
 * and newer MinIO keep their CRC32 integrity check and older MinIO gets the header it needs.
 * Every other operation is unaffected.
 */
export const addContentMd5ToDeleteObjects = (client: S3Client): S3Client => {
  client.middlewareStack.add(
    (next, context) => async (args) => {
      const request = args.request as { headers?: Record<string, string>; body?: unknown };
      const body = request?.body;
      if (
        context.commandName === 'DeleteObjectsCommand' &&
        request?.headers &&
        (typeof body === 'string' || body instanceof Uint8Array) &&
        !hasHeader(request.headers, 'content-md5')
      ) {
        request.headers['content-md5'] = createHash('md5').update(body).digest('base64');
      }
      return next(args);
    },
    { step: 'build', name: 'addContentMd5ToDeleteObjects', priority: 'low', override: true },
  );
  return client;
};

export default addContentMd5ToDeleteObjects;
