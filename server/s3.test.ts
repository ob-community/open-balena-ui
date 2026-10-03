import assert from 'node:assert/strict';
import test from 'node:test';
import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

process.env.OPEN_BALENA_S3_URL = 'https://s3.example.test';
process.env.OPEN_BALENA_S3_ACCESS_KEY = 'test-access';
process.env.OPEN_BALENA_S3_SECRET_KEY = 'test-secret';
const storage = import('./util/s3');

test('S3-compatible endpoints use path-style addressing and configured credentials', async () => {
  const { s3Client } = await storage;
  assert.equal(s3Client.config.forcePathStyle, true);
  assert.equal((await s3Client.config.credentials()).accessKeyId, 'test-access');
  const endpoint = await s3Client.config.endpoint!();
  assert.equal(endpoint.hostname, 's3.example.test');
});

test('object and delimiter listings follow continuation tokens and tolerate empty pages', async (t) => {
  const { s3Client, listObjectKeys, listCommonPrefixes } = await storage;
  for (const list of [listObjectKeys, listCommonPrefixes]) {
    const inputs: unknown[] = [];
    let page = 0;
    t.mock.method(s3Client, 'send', async (command: ListObjectsV2Command) => {
      assert.ok(command instanceof ListObjectsV2Command);
      inputs.push(command.input);
      return [
        { IsTruncated: true, NextContinuationToken: 'page-2' },
        {
          IsTruncated: true,
          NextContinuationToken: 'page-3',
          Contents: [{ Key: 'prefix/a' }, {}],
          CommonPrefixes: [{ Prefix: 'prefix/a/' }, {}],
        },
        {
          IsTruncated: false,
          Contents: [{ Key: 'prefix/b' }],
          CommonPrefixes: [{ Prefix: 'prefix/a/' }, { Prefix: 'prefix/b/' }],
        },
      ][page++];
    });
    assert.deepEqual(
      await list('private', 'prefix/'),
      list === listObjectKeys ? ['prefix/a', 'prefix/b'] : ['prefix/a/', 'prefix/b/'],
    );
    assert.deepEqual(
      inputs,
      [undefined, 'page-2', 'page-3'].map((ContinuationToken) => ({
        Bucket: 'private',
        Prefix: 'prefix/',
        ...(list === listCommonPrefixes ? { Delimiter: '/' } : {}),
        ContinuationToken,
      })),
    );
    t.mock.restoreAll();
  }
});

test('incomplete or cycling pagination fails closed instead of returning partial inventory', async (t) => {
  const { s3Client, listObjectKeys, listCommonPrefixes } = await storage;
  for (const list of [listObjectKeys, listCommonPrefixes]) {
    for (const token of [undefined, '', 'repeated']) {
      t.mock.method(s3Client, 'send', async () => ({
        IsTruncated: true,
        NextContinuationToken: token,
      }));
      await assert.rejects(list('private', 'prefix/'), /continuation token/);
      t.mock.restoreAll();
    }
  }
});

test('multi-object deletion uses quiet batches of at most 1000 and reports per-object failures', async (t) => {
  const { s3Client, deleteObjects } = await storage;
  const inputs: DeleteObjectsCommand['input'][] = [];
  t.mock.method(s3Client, 'send', async (command: DeleteObjectsCommand) => {
    assert.ok(command instanceof DeleteObjectsCommand);
    inputs.push(command.input);
    return {};
  });
  await deleteObjects('private', []);
  assert.equal(inputs.length, 0);
  const keys = Array.from({ length: 1001 }, (_, index) => `prefix/${index}`);
  await deleteObjects('private', keys);
  assert.deepEqual(
    inputs,
    [keys.slice(0, 1000), keys.slice(1000)].map((chunk) => ({
      Bucket: 'private',
      Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
    })),
  );
  t.mock.restoreAll();
  t.mock.method(s3Client, 'send', async () => ({
    Errors: [{ Key: 'prefix/0', Code: 'AccessDenied' }],
  }));
  await assert.rejects(deleteObjects('private', keys), /Failed to delete S3 objects: prefix\/0/);
});

test('listing and deletion propagate backend failures', async (t) => {
  const { s3Client, listObjectKeys, listCommonPrefixes, deleteObjects } = await storage;
  t.mock.method(s3Client, 'send', async () => {
    throw new Error('AccessDenied');
  });
  for (const list of [listObjectKeys, listCommonPrefixes]) {
    await assert.rejects(list('private', 'prefix/'), /AccessDenied/);
  }
  await assert.rejects(deleteObjects('private', ['prefix/a']), /AccessDenied/);
});
