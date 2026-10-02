import {
  GetObjectCommand,
  PutObjectCommand,
  type GetObjectCommandInput,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';

export interface DeviceTypeAsset {
  filename: string;
  href: string;
  content_type: string;
  size: number;
  checksum: string;
}

export const DEVICE_TYPE_METADATA_MAX_BYTES = 1024 * 1024;

export class DeviceTypeMetadataNotFoundError extends Error {}
export class DeviceTypeMetadataValidationError extends Error {}
export class DeviceTypeMetadataForbiddenError extends Error {}

export interface DeviceTypeMetadataStorage {
  put(input: PutObjectCommandInput): Promise<void>;
  get(input: GetObjectCommandInput): Promise<{
    body?: ReadableStream<Uint8Array>;
    contentLength?: number;
  }>;
}

export interface DeviceTypeMetadataDependencies {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof globalThis.fetch;
  storage?: () => Promise<DeviceTypeMetadataStorage>;
}

export function allowedDeviceTypeSlugs(value: string | undefined): Set<string> {
  const slugs = new Set<string>();
  for (const entry of (value ?? '').split(';')) {
    const match = /^hw.device-type\/([\w-]+)$/.exec(entry);
    if (match) {
      slugs.add(match[1]);
    }
  }
  return slugs;
}

export function validateDeviceTypeMetadataPath(
  slug: string,
  version: string,
  checksum?: string,
  allowlist?: string,
): void {
  if (!/^[\w-]{1,128}$/.test(slug) || !/^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/.test(version)) {
    throw new DeviceTypeMetadataValidationError('A valid device type slug and version are required.');
  }
  if (checksum !== undefined && !/^[a-f0-9]{64}$/.test(checksum)) {
    throw new DeviceTypeMetadataValidationError('A valid SHA-256 metadata checksum is required.');
  }
  const allowed = allowedDeviceTypeSlugs(allowlist);
  if (allowed.size > 0 && !allowed.has(slug)) {
    throw new DeviceTypeMetadataForbiddenError(`Device type ${slug} is not permitted by CONTRACT_ALLOWLIST.`);
  }
}

function publicBaseUrl(value: string | undefined, name: string): URL {
  if (!value) {
    throw new Error(`${name} is required for device type metadata.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL.`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be an HTTP(S) URL without credentials, query, or fragment.`);
  }
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/`;
  return url;
}

async function boundedBody(
  body: ReadableStream<Uint8Array> | null | undefined,
  contentLength?: number,
): Promise<Buffer> {
  if (!body) {
    throw new Error('Device type metadata response has no body.');
  }
  if (contentLength !== undefined && contentLength > DEVICE_TYPE_METADATA_MAX_BYTES) {
    await body.cancel().catch(() => undefined);
    throw new Error('Device type metadata exceeds the 1 MiB size limit.');
  }
  const reader = body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      size += value.byteLength;
      if (size > DEVICE_TYPE_METADATA_MAX_BYTES) {
        throw new Error('Device type metadata exceeds the 1 MiB size limit.');
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

function validateMetadata(body: Buffer, slug: string): void {
  let metadata: unknown;
  try {
    metadata = JSON.parse(body.toString('utf8'));
  } catch {
    throw new Error('Device type metadata is not valid JSON.');
  }
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new Error('Device type metadata must be a JSON object.');
  }
  const record = metadata as Record<string, unknown>;
  const aliases = record.aliases;
  if (
    typeof record.slug !== 'string' ||
    !/^[\w-]{1,128}$/.test(record.slug) ||
    (record.slug !== slug && !(Array.isArray(aliases) && aliases.some((alias: unknown) => alias === slug)))
  ) {
    throw new Error(`Device type metadata does not match requested slug ${slug}.`);
  }
}

function objectKey(slug: string, version: string, checksum: string): string {
  return `device-types/${slug}/${version}/${checksum}.json`;
}

function errorDetails(error: unknown): { name?: unknown; status?: unknown } {
  if (typeof error !== 'object' || error === null) {
    return {};
  }
  const record = error as Record<string, unknown>;
  const metadata = record.$metadata;
  return {
    name: record.name,
    status:
      typeof metadata === 'object' && metadata !== null
        ? (metadata as Record<string, unknown>).httpStatusCode
        : undefined,
  };
}

async function defaultStorage(): Promise<DeviceTypeMetadataStorage> {
  const { default: client } = await import('./util/s3/client');
  return {
    async put(input) {
      await client.send(new PutObjectCommand(input));
    },
    async get(input) {
      const result = await client.send(new GetObjectCommand(input));
      return { body: result.Body?.transformToWebStream(), contentLength: result.ContentLength };
    },
  };
}

export function createDeviceTypeMetadataStore(dependencies: DeviceTypeMetadataDependencies = {}) {
  const env = dependencies.env ?? process.env;
  const storage = dependencies.storage ?? defaultStorage;
  const bucket = (): string => {
    const value = env.OPEN_BALENA_OS_METADATA_BUCKET;
    if (!value?.trim()) {
      throw new Error('OPEN_BALENA_OS_METADATA_BUCKET is required for private device type metadata storage.');
    }
    return value;
  };
  return {
    async storeDeviceTypeMetadata(slug: string, version: string): Promise<DeviceTypeAsset> {
      validateDeviceTypeMetadataPath(slug, version, undefined, env.CONTRACT_ALLOWLIST);
      const Bucket = bucket();
      const base = publicBaseUrl(
        env.OPEN_BALENA_OS_METADATA_URL ?? env.REACT_APP_OPEN_BALENA_UI_URL,
        'OPEN_BALENA_OS_METADATA_URL (or REACT_APP_OPEN_BALENA_UI_URL)',
      );
      const source = publicBaseUrl(
        env.OPEN_BALENA_OS_METADATA_SOURCE_URL ?? 'https://resin-production-img-cloudformation.s3.amazonaws.com/images',
        'OPEN_BALENA_OS_METADATA_SOURCE_URL',
      );
      const sourceUrl = new URL(`${encodeURIComponent(slug)}/${encodeURIComponent(version)}/device-type.json`, source);
      const response = await (dependencies.fetch ?? globalThis.fetch)(sourceUrl, {
        method: 'GET',
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`Device type metadata download failed with HTTP ${response.status}.`);
      }
      const body = await boundedBody(
        response.body,
        response.headers.has('content-length') ? Number(response.headers.get('content-length')) : undefined,
      );
      validateMetadata(body, slug);
      const checksum = createHash('sha256').update(body).digest('hex');
      const client = await storage();
      try {
        await client.put({
          Bucket,
          Key: objectKey(slug, version, checksum),
          Body: body,
          ContentType: 'application/json',
          IfNoneMatch: '*',
        });
      } catch (error) {
        const details = errorDetails(error);
        if (details.name !== 'PreconditionFailed' && details.status !== 412) {
          throw error;
        }
      }
      return {
        filename: 'device-type.json',
        href: new URL(
          `balena-os/device-types/${encodeURIComponent(slug)}/${encodeURIComponent(version)}/${checksum}/device-type.json`,
          base,
        ).href,
        content_type: 'application/json',
        size: body.byteLength,
        checksum,
      };
    },
    async readDeviceTypeMetadata(slug: string, version: string, checksum: string): Promise<Buffer> {
      validateDeviceTypeMetadataPath(slug, version, checksum, env.CONTRACT_ALLOWLIST);
      const Bucket = bucket();
      const client = await storage();
      let result: Awaited<ReturnType<DeviceTypeMetadataStorage['get']>>;
      try {
        result = await client.get({ Bucket, Key: objectKey(slug, version, checksum) });
      } catch (error) {
        const details = errorDetails(error);
        if (details.name === 'NoSuchKey' || details.name === 'NotFound') {
          throw new DeviceTypeMetadataNotFoundError('Stored device type metadata was not found.');
        }
        throw error;
      }
      const body = await boundedBody(result.body, result.contentLength);
      if (createHash('sha256').update(body).digest('hex') !== checksum) {
        throw new Error('Stored device type metadata checksum does not match.');
      }
      validateMetadata(body, slug);
      return body;
    },
  };
}

const defaultStore = createDeviceTypeMetadataStore();
export const { storeDeviceTypeMetadata, readDeviceTypeMetadata } = defaultStore;
