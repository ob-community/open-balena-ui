import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import test from 'node:test';
import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { addContentMd5ToDeleteObjects } from './util/s3/contentMd5';

interface CapturedRequest {
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

// An S3 client whose requests never leave the process: a fake request handler records each request
// as it would be sent (after signing and checksums) and answers with a canned XML response.
const createCapturingClient = (responseXml: string) => {
  const requests: CapturedRequest[] = [];
  const client = new S3Client({
    endpoint: 'http://minio.test',
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
    requestHandler: {
      handle: async (request: CapturedRequest) => {
        requests.push({ method: request.method, headers: { ...request.headers }, body: request.body });
        return {
          response: {
            statusCode: 200,
            headers: { 'content-type': 'application/xml' },
            body: Readable.from([Buffer.from(responseXml)]),
          },
        };
      },
    } as never,
  });
  return { client, requests };
};

const header = (headers: Record<string, string>, name: string): string | undefined =>
  Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];

const deleteResult = '<?xml version="1.0" encoding="UTF-8"?><DeleteResult></DeleteResult>';

test('DeleteObjects requests get a correct Content-MD5 header and keep the SDK checksum headers', async () => {
  const { client, requests } = createCapturingClient(deleteResult);
  addContentMd5ToDeleteObjects(client);

  await client.send(
    new DeleteObjectsCommand({
      Bucket: 'registry-data',
      Delete: { Objects: [{ Key: 'data/docker/registry/v2/repositories/v2/abc/_layers/link' }], Quiet: true },
    }),
  );

  assert.equal(requests.length, 1);
  const [request] = requests;
  const body = request.body as string | Uint8Array;
  assert.ok(typeof body === 'string' || body instanceof Uint8Array, 'DeleteObjects body should be buffered');
  assert.equal(header(request.headers, 'content-md5'), createHash('md5').update(body).digest('base64'));
  // Nothing removed: whatever checksum the SDK computes (CRC32 on current versions) is still sent.
  const sdkChecksums = Object.keys(request.headers).filter((name) => /^x-amz-checksum-/i.test(name));
  const { requests: baselineRequests, client: baseline } = createCapturingClient(deleteResult);
  await baseline.send(
    new DeleteObjectsCommand({
      Bucket: 'registry-data',
      Delete: { Objects: [{ Key: 'data/docker/registry/v2/repositories/v2/abc/_layers/link' }], Quiet: true },
    }),
  );
  const baselineChecksums = Object.keys(baselineRequests[0].headers).filter((name) => /^x-amz-checksum-/i.test(name));
  assert.deepEqual(sdkChecksums.sort(), baselineChecksums.sort());
});

test('an existing Content-MD5 header is not overwritten', async () => {
  const { client, requests } = createCapturingClient(deleteResult);
  client.middlewareStack.add(
    (next) => async (args) => {
      (args.request as CapturedRequest).headers['Content-MD5'] = 'preset';
      return next(args);
    },
    { step: 'build', name: 'presetContentMd5', priority: 'high' },
  );
  addContentMd5ToDeleteObjects(client);

  await client.send(new DeleteObjectsCommand({ Bucket: 'b', Delete: { Objects: [{ Key: 'k' }] } }));

  const md5Headers = Object.entries(requests[0].headers).filter(([key]) => key.toLowerCase() === 'content-md5');
  assert.deepEqual(md5Headers, [['Content-MD5', 'preset']]);
});

test('other operations are not modified', async () => {
  const listResult =
    '<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>b</Name><KeyCount>0</KeyCount></ListBucketResult>';
  const { client, requests } = createCapturingClient(listResult);
  addContentMd5ToDeleteObjects(client);

  await client.send(new ListObjectsV2Command({ Bucket: 'b', Prefix: 'data/' }));

  assert.equal(requests.length, 1);
  assert.equal(header(requests[0].headers, 'content-md5'), undefined);
});
