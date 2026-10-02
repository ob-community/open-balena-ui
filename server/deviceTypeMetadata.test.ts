import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Server } from 'node:http';
import test from 'node:test';
import express from 'express';
import type { GetObjectCommandInput, PutObjectCommandInput } from '@aws-sdk/client-s3';
import {
  allowedDeviceTypeSlugs,
  createDeviceTypeMetadataStore,
  DEVICE_TYPE_METADATA_MAX_BYTES,
  DeviceTypeMetadataForbiddenError,
  DeviceTypeMetadataNotFoundError,
  DeviceTypeMetadataValidationError,
  type DeviceTypeMetadataStorage,
} from './deviceTypeMetadata';
import { createDeviceTypeMetadataRouter } from './routes/deviceTypeMetadata';

const slug = 'generic-amd64';
const version = '6.0.1+rev1.prod';
const json = Buffer.from(JSON.stringify({ slug, name: 'Generic AMD64' }));
const checksum = createHash('sha256').update(json).digest('hex');
const env = {
  OPEN_BALENA_OS_METADATA_BUCKET: 'private-os-metadata',
  REACT_APP_OPEN_BALENA_UI_URL: 'https://ui.example.test/',
};

function fixture(
  response: () => Response = () => new Response(json),
  config: Readonly<Record<string, string | undefined>> = env,
) {
  const puts: PutObjectCommandInput[] = [];
  const gets: GetObjectCommandInput[] = [];
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const objects = new Map<string, Buffer>();
  const storage: DeviceTypeMetadataStorage = {
    async put(input) {
      puts.push(input);
      assert.ok(input.Key);
      assert.ok(Buffer.isBuffer(input.Body));
      objects.set(input.Key, Buffer.from(input.Body));
    },
    async get(input) {
      gets.push(input);
      const body = objects.get(input.Key ?? '');
      if (!body) {
        throw Object.assign(new Error('Not found'), { name: 'NoSuchKey' });
      }
      return { body: new Response(new Uint8Array(body)).body ?? undefined, contentLength: body.length };
    },
  };
  const store = createDeviceTypeMetadataStore({
    env: config,
    storage: async () => storage,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return response();
    },
  });
  return { store, storage, puts, gets, requests, objects };
}

async function withRouter(
  read: (slug: string, version: string, checksum: string) => Promise<Buffer>,
  config: Readonly<Record<string, string | undefined>>,
  run: (base: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(createDeviceTypeMetadataRouter(read, config));
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('private immutable persistence returns credential-free URLs and never forwards local auth', async () => {
  const { store, puts, requests } = fixture();
  const asset = await store.storeDeviceTypeMetadata(slug, version);
  assert.deepEqual(asset, {
    filename: 'device-type.json',
    href: `https://ui.example.test/balena-os/device-types/${slug}/${encodeURIComponent(version)}/${checksum}/device-type.json`,
    content_type: 'application/json',
    size: json.length,
    checksum,
  });
  assert.equal(puts.length, 1);
  assert.equal(puts[0].ACL, undefined);
  assert.deepEqual(puts[0], {
    Bucket: env.OPEN_BALENA_OS_METADATA_BUCKET,
    Key: `device-types/${slug}/${version}/${checksum}.json`,
    Body: json,
    ContentType: 'application/json',
    IfNoneMatch: '*',
  });
  assert.equal(
    requests[0].url,
    `https://resin-production-img-cloudformation.s3.amazonaws.com/images/${slug}/${encodeURIComponent(version)}/device-type.json`,
  );
  assert.equal(requests[0].init?.credentials, 'omit');
  assert.equal(requests[0].init?.redirect, 'error');
  assert.equal(new Headers(requests[0].init?.headers).get('authorization'), null);
  assert.ok(requests[0].init?.signal);
  assert.equal((await store.storeDeviceTypeMetadata(slug, version)).href, asset.href);
  assert.notEqual((await store.storeDeviceTypeMetadata(slug, '6.0.2')).href, asset.href);
});

test('changed metadata gets a different content-addressed URL, and configured base paths are preserved', async () => {
  let body = json;
  const { store, requests } = fixture(() => new Response(body), {
    ...env,
    OPEN_BALENA_OS_METADATA_URL: 'https://metadata.example.test/ui/',
    OPEN_BALENA_OS_METADATA_SOURCE_URL: 'https://source.example.test/images/',
  });
  const first = await store.storeDeviceTypeMetadata(slug, version);
  body = Buffer.from(JSON.stringify({ slug, name: 'New name' }));
  const second = await store.storeDeviceTypeMetadata(slug, version);
  assert.notEqual(first.href, second.href);
  assert.match(first.href, /^https:\/\/metadata.example.test\/ui\/balena-os\/device-types\//);
  assert.equal(
    requests[0].url,
    `https://source.example.test/images/${slug}/${encodeURIComponent(version)}/device-type.json`,
  );
});

test('JSON must be an object for the requested slug or its explicit alias', async () => {
  for (const body of [
    'not JSON',
    'null',
    '[]',
    '42',
    '{}',
    '{"slug":"other"}',
    '{"slug":"other","aliases":"generic-amd64"}',
  ]) {
    const { store, puts } = fixture(() => new Response(body));
    await assert.rejects(store.storeDeviceTypeMetadata(slug, version), /JSON|slug/);
    assert.equal(puts.length, 0);
  }
  const { store } = fixture(() => Response.json({ slug: 'canonical-device', aliases: [slug] }));
  assert.equal((await store.storeDeviceTypeMetadata(slug, version)).content_type, 'application/json');
});

test('HTTP failure is explicit, never persisted, and redirects are disallowed', async () => {
  for (const status of [301, 403, 404, 500]) {
    const { store, puts } = fixture(() => new Response('failure', { status }));
    await assert.rejects(store.storeDeviceTypeMetadata(slug, version), new RegExp(`HTTP ${status}`));
    assert.equal(puts.length, 0);
  }
});

test('upstream size limit applies to both advertised size and actual streaming bytes', async () => {
  for (const advertised of [false, true]) {
    let cancelled = false;
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          reads++;
          controller.enqueue(new Uint8Array(DEVICE_TYPE_METADATA_MAX_BYTES + 1));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const { store, puts } = fixture(
      () =>
        new Response(stream, {
          headers: advertised ? { 'Content-Length': String(DEVICE_TYPE_METADATA_MAX_BYTES + 1) } : {},
        }),
    );
    await assert.rejects(store.storeDeviceTypeMetadata(slug, version), /size limit/);
    assert.equal(cancelled, true);
    assert.equal(reads, advertised ? 0 : 1);
    assert.equal(puts.length, 0);
  }
});

test('exactly 1 MiB is accepted and bounded reads count split chunks rather than trusting Content-Length', async () => {
  const prefix = `{"slug":"${slug}","padding":"`;
  const body = `${prefix}${'x'.repeat(DEVICE_TYPE_METADATA_MAX_BYTES - Buffer.byteLength(prefix) - 2)}"}`;
  assert.equal(Buffer.byteLength(body), DEVICE_TYPE_METADATA_MAX_BYTES);
  const { store } = fixture(() => new Response(body));
  assert.equal((await store.storeDeviceTypeMetadata(slug, version)).size, DEVICE_TYPE_METADATA_MAX_BYTES);
  let cancelled = false;
  let reads = 0;
  const chunks = [new Uint8Array(DEVICE_TYPE_METADATA_MAX_BYTES), new Uint8Array(1)];
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        controller.enqueue(chunks[reads++]);
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const oversized = fixture(() => new Response(stream, { headers: { 'Content-Length': '1' } }));
  await assert.rejects(oversized.store.storeDeviceTypeMetadata(slug, version), /size limit/);
  assert.equal(reads, 2);
  assert.equal(cancelled, true);
});

test('missing bucket or public URL and unsafe URL settings fail before downloading or storing', async () => {
  const configs: Array<Readonly<Record<string, string | undefined>>> = [
    { REACT_APP_OPEN_BALENA_UI_URL: env.REACT_APP_OPEN_BALENA_UI_URL },
    { OPEN_BALENA_OS_METADATA_BUCKET: 'private' },
    ...[
      'file:///etc',
      'https://user:password@example.test',
      'https://example.test?token=secret',
      'https://example.test#secret',
      'not-a-url',
    ].flatMap((url) => [
      { ...env, OPEN_BALENA_OS_METADATA_URL: url },
      { ...env, OPEN_BALENA_OS_METADATA_SOURCE_URL: url },
    ]),
  ];
  for (const config of configs) {
    const { store, requests, puts } = fixture(undefined, config);
    await assert.rejects(store.storeDeviceTypeMetadata(slug, version), /required|HTTP/);
    assert.equal(requests.length, 0);
    assert.equal(puts.length, 0);
  }
  await assert.rejects(fixture(undefined, {}).store.readDeviceTypeMetadata(slug, version, checksum), /BUCKET/);
});

test('allowlist follows ob-api semicolon extraction, with empty extracted set unrestricted', async () => {
  assert.deepEqual([...allowedDeviceTypeSlugs(undefined)], []);
  assert.deepEqual(
    [...allowedDeviceTypeSlugs('arch.sw/amd64;hw.device-type/generic-amd64;hw.device-type/raspberrypi4-64')],
    [slug, 'raspberrypi4-64'],
  );
  assert.deepEqual([...allowedDeviceTypeSlugs('arch.sw/amd64;bad; hw.device-type/foo;hw.device-type/foo/bar')], []);
  const restricted = fixture(undefined, { ...env, CONTRACT_ALLOWLIST: 'hw.device-type/raspberrypi4-64;arch.sw/amd64' });
  await assert.rejects(restricted.store.storeDeviceTypeMetadata(slug, version), DeviceTypeMetadataForbiddenError);
  await assert.rejects(
    restricted.store.readDeviceTypeMetadata(slug, version, checksum),
    DeviceTypeMetadataForbiddenError,
  );
  assert.equal(restricted.requests.length, 0);
  assert.equal(restricted.gets.length, 0);
  assert.ok(
    await fixture(undefined, { ...env, CONTRACT_ALLOWLIST: 'arch.sw/amd64' }).store.storeDeviceTypeMetadata(
      slug,
      version,
    ),
  );
});

test('invalid segments and checksums cannot perform arbitrary object reads or downloads', async () => {
  const { store, gets, requests } = fixture();
  for (const bad of ['../secret', 'foo/bar', '.', '..', '', 'foo%2fbar', 'x'.repeat(129)]) {
    await assert.rejects(store.storeDeviceTypeMetadata(bad, version), DeviceTypeMetadataValidationError);
    await assert.rejects(store.readDeviceTypeMetadata(slug, bad, checksum), DeviceTypeMetadataValidationError);
  }
  for (const bad of ['../secret', checksum.toUpperCase(), '', 'f'.repeat(63)]) {
    await assert.rejects(store.readDeviceTypeMetadata(slug, version, bad), DeviceTypeMetadataValidationError);
  }
  assert.equal(gets.length, 0);
  assert.equal(requests.length, 0);
});

test('reads only persisted content with checksum verification and a bounded S3 body', async () => {
  const { store, gets, requests, objects } = fixture();
  const asset = await store.storeDeviceTypeMetadata(slug, version);
  assert.deepEqual(await store.readDeviceTypeMetadata(slug, version, asset.checksum), json);
  assert.deepEqual(gets[0], {
    Bucket: env.OPEN_BALENA_OS_METADATA_BUCKET,
    Key: `device-types/${slug}/${version}/${checksum}.json`,
  });
  assert.equal(requests.length, 1);
  objects.set(gets[0].Key!, Buffer.from('changed content'));
  await assert.rejects(store.readDeviceTypeMetadata(slug, version, asset.checksum), /checksum/);
  objects.set(gets[0].Key!, Buffer.alloc(DEVICE_TYPE_METADATA_MAX_BYTES + 1));
  await assert.rejects(store.readDeviceTypeMetadata(slug, version, asset.checksum), /size limit/);
});

test('stored streaming data is bounded even without ContentLength', async () => {
  let cancelled = false;
  const store = createDeviceTypeMetadataStore({
    env,
    storage: async () => ({
      async put() {},
      async get() {
        return {
          body: new ReadableStream<Uint8Array>(
            {
              pull(controller) {
                controller.enqueue(new Uint8Array(DEVICE_TYPE_METADATA_MAX_BYTES + 1));
              },
              cancel() {
                cancelled = true;
              },
            },
            { highWaterMark: 0 },
          ),
        };
      },
    }),
  });
  await assert.rejects(store.readDeviceTypeMetadata(slug, version, checksum), /size limit/);
  assert.equal(cancelled, true);
});

test('S3 object missing is distinguished from permissions, bucket missing and storage failures', async () => {
  for (const name of ['NoSuchKey', 'NotFound', 'NoSuchBucket', 'AccessDenied', 'Error']) {
    const store = createDeviceTypeMetadataStore({
      env,
      storage: async () => ({
        async put() {},
        async get() {
          throw Object.assign(new Error('S3 failed'), { name, $metadata: { httpStatusCode: 404 } });
        },
      }),
    });
    await assert.rejects(
      store.readDeviceTypeMetadata(slug, version, checksum),
      (error: unknown) =>
        error instanceof Error &&
        (['NoSuchKey', 'NotFound'].includes(name)
          ? error instanceof DeviceTypeMetadataNotFoundError
          : !(error instanceof DeviceTypeMetadataNotFoundError)),
    );
  }
});

test('immutable conditional writes permit existing identical content but propagate other errors', async () => {
  for (const name of ['PreconditionFailed', 'AccessDenied']) {
    const { storage } = fixture();
    const store = createDeviceTypeMetadataStore({
      env,
      fetch: async () => new Response(json),
      storage: async () => ({
        ...storage,
        async put() {
          throw Object.assign(new Error('write failed'), { name });
        },
      }),
    });
    if (name === 'PreconditionFailed') {
      assert.equal((await store.storeDeviceTypeMetadata(slug, version)).checksum, checksum);
    } else {
      await assert.rejects(store.storeDeviceTypeMetadata(slug, version), /write failed/);
    }
  }
});

test('public GET serves stored data without Authorization and provides no write or list endpoint', async () => {
  const { store, requests, gets } = fixture();
  await store.storeDeviceTypeMetadata(slug, version);
  await withRouter(store.readDeviceTypeMetadata, env, async (base) => {
    const path = `/balena-os/device-types/${slug}/${encodeURIComponent(version)}/${checksum}/device-type.json`;
    const response = await fetch(`${base}${path}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal(await response.text(), json.toString());
    assert.equal((await fetch(`${base}${path}`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${base}/balena-os/device-types`)).status, 404);
  });
  assert.equal(requests.length, 1);
  assert.equal(gets.length, 1);
});

test('route validates paths and enforces allowlist before invoking read', async () => {
  let reads = 0;
  await withRouter(
    async () => {
      reads++;
      return json;
    },
    { CONTRACT_ALLOWLIST: 'hw.device-type/raspberrypi4-64' },
    async (base) => {
      assert.equal(
        (await fetch(`${base}/balena-os/device-types/${slug}/${version}/${checksum}/device-type.json`)).status,
        403,
      );
      assert.equal(
        (await fetch(`${base}/balena-os/device-types/foo%2Fbar/${version}/${checksum}/device-type.json`)).status,
        400,
      );
      assert.equal((await fetch(`${base}/balena-os/device-types/${slug}/${version}/bad/device-type.json`)).status, 400);
    },
  );
  assert.equal(reads, 0);
});

test('route returns JSON 404 only for a missing object, otherwise 502', async () => {
  for (const [error, status] of [
    [new DeviceTypeMetadataNotFoundError('missing object'), 404],
    [new Error('OPEN_BALENA_OS_METADATA_BUCKET is required'), 502],
    [Object.assign(new Error('bucket missing'), { name: 'NoSuchBucket' }), 502],
    [new Error('AccessDenied'), 502],
    [new Error('checksum mismatch'), 502],
  ] as const) {
    await withRouter(
      async () => {
        throw error;
      },
      env,
      async (base) => {
        const response = await fetch(`${base}/balena-os/device-types/${slug}/${version}/${checksum}/device-type.json`);
        assert.equal(response.status, status);
        assert.deepEqual(await response.json(), { message: error.message });
      },
    );
  }
});
