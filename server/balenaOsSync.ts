import semver from 'semver';
import { setTimeout as delay } from 'node:timers/promises';
import versions from '../src/versions';
import { withPermissionHint } from '../src/lib/httpErrorMessage';
import { allowedDeviceTypeSlugs, storeDeviceTypeMetadata, type DeviceTypeAsset } from './deviceTypeMetadata';

type RecordValue = Record<string, unknown>;

export type BalenaOsSyncMode = 'all' | 'latest-and-in-use' | 'newer-and-in-use' | 'in-use' | 'single';

export interface BalenaOsSyncOptions {
  mode: BalenaOsSyncMode;
  version?: string;
}

export class BalenaOsSyncValidationError extends Error {}

export interface BalenaOsSyncStatus {
  state: 'idle' | 'running' | 'completed' | 'failed';
  phase: string;
  processed: number;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  mode?: BalenaOsSyncMode;
  version?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
}

export interface BalenaOsCatalogDeviceType {
  id: number;
  slug: string;
  availableVersions: number;
  localApplications: number;
  localReleases: number;
  latestAvailable?: string;
  latestLocal?: string;
}

export interface BalenaOsCatalog {
  deviceTypes: BalenaOsCatalogDeviceType[];
  organizations: Array<{ id: number; name: string }>;
  totals: {
    availableVersions: number;
    localApplications: number;
    localReleases: number;
  };
}

interface SourceGraph {
  application: RecordValue;
  deviceType: { id: number; slug: string };
  releases: RecordValue[];
  services: RecordValue[];
  images: RecordValue[];
  releaseImages: RecordValue[];
  isHostAppUpdater?: boolean;
}

export interface SyncDependencies {
  fetch: typeof fetch;
  apiUrl: () => string;
  apiVersion: () => 'v6' | 'v7';
  apiSoftwareVersion: () => string | undefined;
  catalogApiUrl: () => string;
  registryHost: () => string | undefined;
  postgrestUrl?: () => string | undefined;
  contractAllowlist?: () => string | undefined;
  metadataVerificationTimeoutMs?: number;
  metadataVerificationPollIntervalMs?: number;
  storeDeviceTypeMetadata?: (slug: string, version: string) => Promise<DeviceTypeAsset>;
  setHostAppUpdaterRelation?: (
    authorization: string,
    hostApplicationId: number,
    updaterApplicationId: number,
  ) => Promise<void>;
}

const DEFAULT_CATALOG_API_URL = 'https://api.balena-cloud.com';
const PAGE_SIZE = 1000;
const MAX_RECORDS = 10000;
const HOST_APP_IMAGE_CATALOG_REMOVED_VERSION = '46.0.0';
const HOST_APP_UPDATER_RELATION_VERSION = '43.4.0';
const RELEASE_ASSET_METADATA_VERSION = '46.1.0';
const HOST_APP_UPDATER_SLUG = 'balena_os/balenahup';
const ESR_MIN_MAJOR = 2000;
const METADATA_VERIFICATION_TIMEOUT_MS = 6 * 60 * 1000;
const METADATA_REQUEST_TIMEOUT_MS = 10000;

class SyncRequestError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const trimUrl = (value: string): string => value.replace(/\/+$/, '');

const configuredApiUrl = (): string => {
  const value = process.env.REACT_APP_OPEN_BALENA_API_URL;
  if (!value) throw new Error('REACT_APP_OPEN_BALENA_API_URL must be configured.');
  return trimUrl(value);
};

const configuredApiVersion = (): 'v6' | 'v7' => {
  const override = process.env.REACT_APP_OPEN_BALENA_ODATA_VERSION;
  if (override === 'v6' || override === '6') return 'v6';
  if (override === 'v7' || override === '7') return 'v7';
  return versions.odataVersion(process.env.REACT_APP_OPEN_BALENA_API_VERSION);
};

const setHostAppUpdaterRelation = async (
  authorization: string,
  hostApplicationId: number,
  updaterApplicationId: number,
): Promise<void> => {
  const baseUrl = process.env.OPEN_BALENA_POSTGREST_URL?.replace(/\/+$/, '');
  if (!baseUrl) throw new Error('OPEN_BALENA_POSTGREST_URL must be configured for Host OS updater relationships.');
  const response = await fetch(
    `${baseUrl}/${encodeURIComponent('application')}?${new URLSearchParams({ id: `eq.${hostApplicationId}` })}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': authorization,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({ 'is updated by-application': updaterApplicationId }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `PostgREST could not link Host OS application ${hostApplicationId} to its updater (${response.status}).`,
    );
  }
  const records = (await response.json()) as unknown;
  if (!Array.isArray(records) || records.length !== 1) {
    throw new Error(`PostgREST did not update Host OS application ${hostApplicationId}.`);
  }
};

const defaultDependencies: SyncDependencies = {
  fetch,
  apiUrl: configuredApiUrl,
  apiVersion: configuredApiVersion,
  apiSoftwareVersion: () => process.env.REACT_APP_OPEN_BALENA_API_VERSION,
  catalogApiUrl: () => trimUrl(process.env.OPEN_BALENA_OS_CATALOG_API_URL ?? DEFAULT_CATALOG_API_URL),
  registryHost: () => process.env.OPEN_BALENA_OS_REGISTRY_HOST?.replace(/^https?:\/\//, '').replace(/\/+$/, ''),
  postgrestUrl: () => process.env.OPEN_BALENA_POSTGREST_URL?.replace(/\/+$/, ''),
  contractAllowlist: () => process.env.CONTRACT_ALLOWLIST,
  storeDeviceTypeMetadata,
  setHostAppUpdaterRelation,
};

const relationId = (value: unknown): number | undefined => {
  const candidate = value && typeof value === 'object' && '__id' in value ? (value as { __id: unknown }).__id : value;
  const id = Number(candidate);
  return Number.isInteger(id) && id > 0 ? id : undefined;
};

const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const isRecord = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const matchesDeviceTypeAsset = (value: unknown, asset: DeviceTypeAsset): boolean =>
  isRecord(value) && Object.entries(asset).every(([key, expected]) => value[key] === expected);

const quote = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const structuredField = (
  value: unknown,
  field: string,
  recordDescription: string,
  fallback: RecordValue | unknown[] | null,
): RecordValue | unknown[] | null => {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value as RecordValue | unknown[];
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (parsed !== null && typeof parsed === 'object') return parsed as RecordValue | unknown[];
    } catch {
      // Report the malformed source field with catalog context below.
    }
  }
  throw new Error(`Catalog ${recordDescription} field "${field}" is not valid JSON object or array data.`);
};

const hostReleaseImageLabels = (graph: SourceGraph, sourceLink: RecordValue): Array<[string, string]> => {
  if (graph.application.is_host !== true) return [];
  const sourceReleaseId = relationId(sourceLink.is_part_of__release);
  const sourceImageId = relationId(sourceLink.image);
  const sourceRelease = graph.releases.find(({ id }) => relationId(id) === sourceReleaseId);
  const sourceImage = graph.images.find(({ id }) => relationId(id) === sourceImageId);
  const sourceServiceId = relationId(sourceImage?.is_a_build_of__service);
  const serviceName = asString(graph.services.find(({ id }) => relationId(id) === sourceServiceId)?.service_name);
  if (!sourceRelease || !serviceName) return [];
  const composition = structuredField(sourceRelease.composition, 'composition', `release ${sourceRelease.commit}`, {});
  if (!composition || Array.isArray(composition)) return [];
  const services = composition.services;
  if (!services || typeof services !== 'object' || Array.isArray(services)) return [];
  const service = (services as RecordValue)[serviceName];
  if (!service || typeof service !== 'object' || Array.isArray(service)) return [];
  const labels = (service as RecordValue).labels;
  if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return [];
  return Object.entries(labels as RecordValue).flatMap(([name, value]) =>
    typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? [[name, String(value)]] : [],
  );
};

const extractRecords = (input: unknown): RecordValue[] => {
  if (!input || typeof input !== 'object') return [];
  const body = input as RecordValue;
  if (Array.isArray(body.value)) return body.value as RecordValue[];
  if (Array.isArray(body.d)) return body.d as RecordValue[];
  if (body.d && typeof body.d === 'object' && Array.isArray((body.d as RecordValue).results)) {
    return (body.d as { results: RecordValue[] }).results;
  }
  return 'id' in body ? [body] : [];
};

const errorMessage = async (response: Response): Promise<string> => {
  const body = await response.text();
  try {
    const parsed = JSON.parse(body) as { message?: unknown; error?: { message?: unknown } };
    const message = parsed.message ?? parsed.error?.message;
    if (typeof message === 'string') return message;
  } catch {
    // The response body is included below in a bounded form.
  }
  return body.slice(0, 500) || response.statusText;
};

const comparable = (value: unknown): unknown => {
  const id = relationId(value);
  if (id !== undefined && value && typeof value === 'object') return id;
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as RecordValue)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nestedValue]) => [key, comparable(nestedValue)]),
    );
  }
  return value;
};

const changedPayload = (existing: RecordValue, payload: RecordValue): RecordValue =>
  Object.fromEntries(
    Object.entries(payload).filter(
      ([field, value]) =>
        !(
          field === 'image_size' &&
          existing[field] != null &&
          value != null &&
          String(existing[field]) === String(value)
        ) && JSON.stringify(comparable(existing[field])) !== JSON.stringify(comparable(value)),
    ),
  );

const parsedVersion = (value: unknown): semver.SemVer | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const embedded = trimmed.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/)?.[0];
  return semver.parse(trimmed) ?? (embedded ? semver.parse(embedded) : null) ?? semver.coerce(trimmed);
};

const sameRequestedVersion = (candidate: semver.SemVer, requested: semver.SemVer): boolean => {
  if (
    candidate.major !== requested.major ||
    candidate.minor !== requested.minor ||
    candidate.patch !== requested.patch ||
    candidate.prerelease.join('.') !== requested.prerelease.join('.')
  ) {
    return false;
  }
  return requested.build.length === 0 || candidate.build.join('.') === requested.build.join('.');
};

const revisionNumber = (version: semver.SemVer): number | undefined => {
  const value = version.build.map((part) => /^rev(\d+)$/.exec(part)?.[1]).find((part) => part != null);
  return value == null ? undefined : Number(value);
};

const compareBalenaVersions = (left: semver.SemVer, right: semver.SemVer): number => {
  const precedence = semver.compare(left, right);
  if (precedence !== 0) return precedence;
  const leftRevision = revisionNumber(left);
  const rightRevision = revisionNumber(right);
  if (leftRevision != null || rightRevision != null) return (leftRevision ?? -1) - (rightRevision ?? -1);
  return semver.compareBuild(left, right);
};

const latestVersion = (records: string[]): string | undefined =>
  records
    .map((value) => ({ raw: value, parsed: parsedVersion(value) }))
    .filter((entry): entry is { raw: string; parsed: semver.SemVer } => entry.parsed != null)
    .sort((left, right) => compareBalenaVersions(right.parsed, left.parsed))[0]?.raw;

const newerThanRequested = (candidate: semver.SemVer, requested: semver.SemVer): boolean => {
  const precedence = semver.compare(candidate, requested);
  if (precedence !== 0) return precedence > 0;
  if (candidate.build.length === 0) return false;
  if (requested.build.length === 0) return true;
  return compareBalenaVersions(candidate, requested) > 0;
};

export const selectBalenaOsReleases = <T extends { raw_version?: unknown; is_invalidated?: unknown }>(
  releases: T[],
  options: BalenaOsSyncOptions,
  inUseVersions: string[],
): T[] => {
  const requested = options.version ? parsedVersion(options.version) : null;
  const inUse = inUseVersions.map(parsedVersion).filter((version): version is semver.SemVer => version != null);
  const latest =
    options.mode === 'latest-and-in-use'
      ? releases
          .filter((release) => release.is_invalidated !== true)
          .map((release) => ({ release, version: parsedVersion(release.raw_version) }))
          .filter((entry): entry is { release: T; version: semver.SemVer } => entry.version != null)
          .sort((left, right) => compareBalenaVersions(right.version, left.version))[0]?.release
      : undefined;
  return releases.filter((release) => {
    const candidate = parsedVersion(release.raw_version);
    if (!candidate) return false;
    const isInUse = inUse.some((version) => sameRequestedVersion(candidate, version));
    if (release.is_invalidated === true && !isInUse) return false;
    if (options.mode === 'all') return true;
    if (options.mode === 'latest-and-in-use') return release === latest || isInUse;
    if (options.mode === 'in-use') return isInUse;
    if (!requested) return false;
    if (options.mode === 'single') return sameRequestedVersion(candidate, requested);
    return newerThanRequested(candidate, requested) || isInUse;
  });
};

export const expandBalenaOsRevisionChain = <T extends RecordValue>(
  releases: T[],
  selectedReleaseIds: Set<number>,
): T[] => {
  const requiredIds = new Set(selectedReleaseIds);
  for (const selected of releases.filter(({ id }) => requiredIds.has(relationId(id) ?? -1))) {
    const selectedVersion = parsedVersion(selected.raw_version);
    const selectedRevision =
      typeof selected.revision === 'number' ? selected.revision : selectedVersion && revisionNumber(selectedVersion);
    if (!selectedVersion || !selectedRevision || selectedRevision < 1) continue;
    for (let revision = 0; revision < selectedRevision; revision += 1) {
      const prerequisite = releases.find((candidate) => {
        if (candidate.is_invalidated === true || candidate.variant !== selected.variant) return false;
        const candidateVersion = parsedVersion(candidate.raw_version);
        if (!candidateVersion) return false;
        const candidateRevision =
          typeof candidate.revision === 'number' ? candidate.revision : (revisionNumber(candidateVersion) ?? 0);
        return (
          candidateRevision === revision &&
          candidateVersion.major === selectedVersion.major &&
          candidateVersion.minor === selectedVersion.minor &&
          candidateVersion.patch === selectedVersion.patch &&
          candidateVersion.prerelease.join('.') === selectedVersion.prerelease.join('.')
        );
      });
      const prerequisiteId = relationId(prerequisite?.id);
      if (!prerequisiteId) {
        throw new Error(
          `Catalog release ${String(selected.raw_version)} requires unavailable non-invalidated revision ${revision}.`,
        );
      }
      requiredIds.add(prerequisiteId);
    }
  }
  return releases.filter(({ id }) => requiredIds.has(relationId(id) ?? -1));
};

const validatedSyncOptions = (options: BalenaOsSyncOptions): BalenaOsSyncOptions => {
  if (!['all', 'latest-and-in-use', 'newer-and-in-use', 'in-use', 'single'].includes(options.mode)) {
    throw new BalenaOsSyncValidationError('A valid BalenaOS synchronization mode is required.');
  }
  if (options.mode === 'newer-and-in-use' || options.mode === 'single') {
    const version = options.version?.trim();
    if (!version || !semver.valid(version)) {
      throw new BalenaOsSyncValidationError(
        'A valid semantic version is required for the selected synchronization mode.',
      );
    }
    return { mode: options.mode, version };
  }
  if (options.version != null && options.version.trim() !== '') {
    throw new BalenaOsSyncValidationError(
      'A semantic version must not be provided for the selected synchronization mode.',
    );
  }
  return { mode: options.mode };
};

const supportsReleaseSemver = (apiVersion: string | undefined): boolean =>
  semver.gte(semver.coerce(apiVersion) ?? '0.0.0', '0.149.0');

const supportsApplicationClass = (apiVersion: string | undefined): boolean =>
  semver.gte(semver.coerce(apiVersion) ?? '0.0.0', '0.157.3');

const supportsHostAppImageCatalog = (apiVersion: string | undefined): boolean =>
  semver.lt(semver.coerce(apiVersion) ?? '0.0.0', HOST_APP_IMAGE_CATALOG_REMOVED_VERSION);

const supportsHostAppUpdaterRelation = (apiVersion: string | undefined): boolean =>
  semver.gte(semver.coerce(apiVersion) ?? '0.0.0', HOST_APP_UPDATER_RELATION_VERSION);

const supportsReleaseAssetMetadata = (apiVersion: string | undefined): boolean =>
  semver.gte(semver.coerce(apiVersion) ?? '0.0.0', RELEASE_ASSET_METADATA_VERSION);

const isNonEsrRelease = (release: RecordValue): boolean => {
  const version = parsedVersion(release.raw_version);
  return version != null && version.major < ESR_MIN_MAJOR;
};

const chunks = <T>(values: T[], size = 100): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
};

export class BalenaOsSyncManager {
  private status: BalenaOsSyncStatus = {
    state: 'idle',
    phase: 'Not started',
    processed: 0,
    total: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
  };

  public constructor(private readonly dependencies: SyncDependencies = defaultDependencies) {}

  public getStatus(): BalenaOsSyncStatus {
    return { ...this.status };
  }

  public async getBalenaOsOrganizationId(authorization: string): Promise<number | undefined> {
    const organization = await this.getOne('organization', `name eq ${quote('balena_os')}`, 'id,name', authorization);
    return relationId(organization?.id);
  }

  private async requestJson(
    url: string,
    authorization?: string,
    init: RequestInit = {},
    allowNotFound = false,
  ): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (authorization) headers.set('Authorization', authorization);
    if (init.body != null) headers.set('Content-Type', 'application/json');

    let response: Response | undefined;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      response = await this.dependencies.fetch(url, { ...init, headers });
      if (response.status !== 429 || attempt === 3) break;
      const retryAfter = Number(response.headers.get('Retry-After'));
      await delay(Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000 * (attempt + 1), undefined, {
        signal: init.signal ?? undefined,
      });
    }
    if (response?.status === 404 && allowNotFound) return undefined;
    if (!response?.ok) {
      if (response?.status === 401) {
        throw new Error(
          withPermissionHint(
            'Synchronization authorization expired or was rejected; sign in again and re-run to resume.',
            response.status,
          ),
        );
      }
      throw new SyncRequestError(
        response?.status ?? 0,
        `Request failed (${response?.status ?? 'unknown'}): ${response ? await errorMessage(response) : url}`,
      );
    }
    if (response.status === 204) return undefined;
    const body = await response.text();
    if (!body) return undefined;
    if (response.headers.get('Content-Type')?.includes('json')) return JSON.parse(body);
    return body;
  }

  private collectionUrl(
    baseUrl: string,
    version: 'v6' | 'v7',
    resource: string,
    query: Record<string, string | number>,
  ): string {
    const queryString = Object.entries(query)
      .map(
        ([key, value]) =>
          `${key.startsWith('$') ? key : encodeURIComponent(key)}=${encodeURIComponent(String(value))
            .replace(/%2C/gi, ',')
            .replace(/%2F/gi, '/')
            .replace(/%3A/gi, ':')}`,
      )
      .join('&');
    return `${baseUrl}/${version}/${resource}?${queryString}`;
  }

  private async getAll(
    baseUrl: string,
    version: 'v6' | 'v7',
    resource: string,
    query: Record<string, string | number>,
    authorization?: string,
  ): Promise<RecordValue[]> {
    const records: RecordValue[] = [];
    const stableQuery = '$orderby' in query ? query : { ...query, $orderby: 'id asc' };
    const requestedLimit = Number(query.$top);
    const hasRequestedLimit = Number.isInteger(requestedLimit) && requestedLimit > 0;
    const limit = hasRequestedLimit ? Math.min(requestedLimit, MAX_RECORDS) : MAX_RECORDS;
    for (let skip = 0; skip < limit; skip += PAGE_SIZE) {
      const pageSize = Math.min(PAGE_SIZE, limit - skip);
      const page = extractRecords(
        await this.requestJson(
          this.collectionUrl(baseUrl, version, resource, { ...stableQuery, $top: pageSize, $skip: skip }),
          authorization,
        ),
      );
      records.push(...page);
      if (page.length < pageSize || (hasRequestedLimit && records.length >= limit)) return records;
    }
    throw new Error(`${resource} exceeded the ${MAX_RECORDS}-record synchronization safety limit.`);
  }

  private async getOne(
    resource: string,
    filter: string,
    select: string,
    authorization: string,
  ): Promise<RecordValue | undefined> {
    return (
      await this.getAll(
        this.dependencies.apiUrl(),
        this.dependencies.apiVersion(),
        resource,
        { $filter: filter, $select: select, $top: 1 },
        authorization,
      )
    )[0];
  }

  private async write(
    resource: string,
    existing: RecordValue | undefined,
    payload: RecordValue,
    lookupFilter: string,
    lookupSelect: string,
    authorization: string,
  ): Promise<RecordValue> {
    if (existing) {
      const changes = changedPayload(existing, payload);
      if (Object.keys(changes).length === 0) {
        this.status.unchanged += 1;
        this.status.processed += 1;
        return existing;
      }
      const id = relationId(existing.id);
      if (!id) throw new Error(`Existing ${resource} record has no valid ID.`);
      await this.requestJson(
        `${this.dependencies.apiUrl()}/${this.dependencies.apiVersion()}/${resource}(${id})`,
        authorization,
        {
          method: 'PATCH',
          body: JSON.stringify(changes),
        },
      );
      this.status.updated += 1;
      this.status.processed += 1;
      return { ...existing, ...changes, id };
    }

    const response = extractRecords(
      await this.requestJson(
        `${this.dependencies.apiUrl()}/${this.dependencies.apiVersion()}/${resource}`,
        authorization,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        },
      ),
    )[0];
    const created = response ?? (await this.getOne(resource, lookupFilter, lookupSelect, authorization));
    if (!relationId(created?.id)) throw new Error(`Created ${resource} could not be read back from open-balena-api.`);
    this.status.created += 1;
    this.status.processed += 1;
    return created;
  }

  private async reconcileImageLocation(
    image: RecordValue,
    location: string,
    authorization: string,
  ): Promise<RecordValue> {
    if (image.is_stored_at__image_location === location) return image;
    const id = relationId(image.id);
    if (!id) throw new Error('Created image record has no valid ID.');
    await this.requestJson(
      `${this.dependencies.apiUrl()}/${this.dependencies.apiVersion()}/image(${id})`,
      authorization,
      {
        method: 'PATCH',
        body: JSON.stringify({ is_stored_at__image_location: location }),
      },
    );
    return { ...image, is_stored_at__image_location: location };
  }

  private async imageCatalog(authorization: string, slug: string): Promise<string[] | undefined> {
    const body = (await this.requestJson(
      `${this.dependencies.apiUrl()}/device-types/v1/${encodeURIComponent(slug)}/images`,
      authorization,
      {},
      true,
    )) as { versions?: unknown };
    if (body == null) return undefined;
    if (!Array.isArray(body?.versions) || !body.versions.every((version) => typeof version === 'string')) {
      throw new Error(`The image catalog for ${slug} returned an invalid response.`);
    }
    return body.versions;
  }

  private async localDeviceTypes(authorization: string): Promise<RecordValue[]> {
    const records = await this.getAll(
      this.dependencies.apiUrl(),
      this.dependencies.apiVersion(),
      'device_type',
      { $select: 'id,slug', $orderby: 'slug asc' },
      authorization,
    );
    const allowlist = allowedDeviceTypeSlugs(this.dependencies.contractAllowlist?.());
    return records.filter(({ slug }) => allowlist.size === 0 || (typeof slug === 'string' && allowlist.has(slug)));
  }

  private async synchronizeDeviceTypeAssets(authorization: string, deviceTypes: RecordValue[]): Promise<void> {
    const persist = this.dependencies.storeDeviceTypeMetadata;
    if (!persist) throw new Error('Device-type metadata storage is not configured.');
    const postgrestUrl = this.dependencies.postgrestUrl?.();
    if (!postgrestUrl) throw new Error('OPEN_BALENA_POSTGREST_URL is required to persist device-type release assets.');
    const expectedSlugs = allowedDeviceTypeSlugs(this.dependencies.contractAllowlist?.());
    const missingSlugs = [...expectedSlugs].filter((slug) => !deviceTypes.some((record) => record.slug === slug));
    if (missingSlugs.length > 0) {
      throw new Error(`Allowlisted device types are missing from open-balena-api: ${missingSlugs.join(', ')}.`);
    }
    const metadata = new Map<string, { version: string; applicationId: number }>();
    for (const deviceType of deviceTypes) {
      const slug = asString(deviceType.slug);
      const deviceTypeId = relationId(deviceType.id);
      if (!slug || !deviceTypeId) throw new Error('Local device type has no valid ID or slug.');
      const applications = await this.getAll(
        this.dependencies.apiUrl(),
        this.dependencies.apiVersion(),
        'application',
        {
          $filter: `(is_for__device_type eq ${deviceTypeId}) and (is_host eq true) and (not application_tag/any(tag:tag/tag_key eq 'release-policy'))`,
          $select: 'id,slug',
          $top: 2,
        },
        authorization,
      );
      if (applications.length !== 1) {
        throw new Error(`Device type ${slug} requires exactly one standard Host OS application for config metadata.`);
      }
      const applicationId = relationId(applications[0].id);
      if (!applicationId) throw new Error(`Host OS application for ${slug} has no valid ID.`);
      const releases = await this.getAll(
        this.dependencies.apiUrl(),
        this.dependencies.apiVersion(),
        'release',
        {
          $filter: `(belongs_to__application eq ${applicationId}) and (status eq 'success') and (is_final eq true) and (is_invalidated eq false) and (semver_major gt 0) and (semver_major lt ${ESR_MIN_MAJOR})`,
          $select: 'id,raw_version',
          $orderby: 'semver_major desc,semver_minor desc,semver_patch desc,revision desc,variant desc,created_at desc',
          $top: 1,
        },
        authorization,
      );
      const releaseId = relationId(releases[0]?.id);
      const version = asString(releases[0]?.raw_version);
      if (!releaseId || !version) {
        throw new Error(`Device type ${slug} has no usable Host OS release for config metadata.`);
      }
      this.status.phase = `Synchronizing config metadata for ${slug}`;
      const filter = `(release eq ${releaseId}) and (asset_key eq 'device-type.json')`;
      const select = 'id,release,asset_key,asset';
      const existingAssets = await this.getAll(
        this.dependencies.apiUrl(),
        this.dependencies.apiVersion(),
        'release_asset',
        { $filter: filter, $select: select, $top: 2 },
        authorization,
      );
      if (existingAssets.length > 1) throw new Error(`Release ${releaseId} has duplicate device-type.json assets.`);
      const asset = await persist(slug, version);
      await this.persistDeviceTypeAssetReference(
        authorization,
        trimUrl(postgrestUrl),
        releaseId,
        existingAssets[0],
        asset,
      );
      const verified = await this.getAll(
        this.dependencies.apiUrl(),
        this.dependencies.apiVersion(),
        'release_asset',
        { $filter: filter, $select: select, $top: 2 },
        authorization,
      );
      if (
        verified.length !== 1 ||
        relationId(verified[0].release) !== releaseId ||
        verified[0].asset_key !== 'device-type.json' ||
        !matchesDeviceTypeAsset(verified[0].asset, asset)
      ) {
        throw new Error(`Device-type metadata reference for ${slug}, release ${releaseId}, failed OData read-back.`);
      }
      metadata.set(slug, { version, applicationId });
    }

    // release_asset writes have no metadata-cache hook. The same-value host flag
    // PATCH invokes ob-api's existing application hook without changing targets.
    this.status.phase = 'Refreshing API device-type metadata';
    for (const applicationId of new Set([...metadata.values()].map((entry) => entry.applicationId))) {
      await this.requireMetadataWriteAccess(authorization, 'application', applicationId);
      await this.requestJson(
        `${this.dependencies.apiUrl()}/${this.dependencies.apiVersion()}/application(${applicationId})`,
        authorization,
        { method: 'PATCH', body: JSON.stringify({ is_host: true }) },
      );
    }
    await this.verifyDeviceTypeMetadata(authorization, metadata);
  }

  private async persistDeviceTypeAssetReference(
    authorization: string,
    postgrestUrl: string,
    releaseId: number,
    existing: RecordValue | undefined,
    asset: DeviceTypeAsset,
  ): Promise<void> {
    if (existing && matchesDeviceTypeAsset(existing.asset, asset)) {
      this.status.unchanged += 1;
      this.status.processed += 1;
      return;
    }
    let record = existing;
    const filter = `(release eq ${releaseId}) and (asset_key eq 'device-type.json')`;
    const select = 'id,release,asset_key,asset';
    const apiUrl = `${this.dependencies.apiUrl()}/${this.dependencies.apiVersion()}/release_asset`;
    if (!record) {
      try {
        await this.requestJson(apiUrl, authorization, {
          method: 'POST',
          body: JSON.stringify({ release: releaseId, asset_key: 'device-type.json' }),
        });
      } catch (error) {
        if (!(error instanceof SyncRequestError) || error.status !== 409) throw error;
        // A concurrent sync may have created this same unique release/key pair.
      }
      const records = await this.getAll(
        this.dependencies.apiUrl(),
        this.dependencies.apiVersion(),
        'release_asset',
        { $filter: filter, $select: select, $top: 2 },
        authorization,
      );
      if (records.length !== 1) throw new Error(`Release ${releaseId} requires exactly one device-type.json asset.`);
      record = records[0];
    }
    const id = relationId(record.id);
    if (!id || relationId(record.release) !== releaseId || record.asset_key !== 'device-type.json') {
      throw new Error(`Release ${releaseId} has an invalid device-type.json asset record.`);
    }

    await this.requireMetadataWriteAccess(authorization, 'release_asset', id);
    const query = new URLSearchParams({
      'id': `eq.${id}`,
      'release': `eq.${releaseId}`,
      'asset key': 'eq.device-type.json',
    });
    const response = await this.requestJson(
      `${postgrestUrl}/${encodeURIComponent('release asset')}?${query}`,
      authorization,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ asset }),
      },
    );
    if (
      !Array.isArray(response) ||
      response.length !== 1 ||
      !isRecord(response[0]) ||
      relationId(response[0].id) !== id ||
      relationId(response[0].release) !== releaseId ||
      response[0]['asset key'] !== 'device-type.json' ||
      !matchesDeviceTypeAsset(response[0].asset, asset)
    ) {
      throw new Error(`PostgREST did not persist the device-type.json reference for release ${releaseId}.`);
    }
    if (existing) this.status.updated += 1;
    else this.status.created += 1;
    this.status.processed += 1;
  }

  private async requireMetadataWriteAccess(
    authorization: string,
    resource: 'release_asset' | 'application',
    id: number,
  ): Promise<void> {
    // A PATCH can succeed with zero affected rows. canAccess explicitly rejects
    // row-level permission misses and returns the authorized record's ID.
    const records = extractRecords(
      await this.requestJson(
        `${this.dependencies.apiUrl()}/${this.dependencies.apiVersion()}/${resource}(${id})/canAccess`,
        authorization,
        { method: 'POST', body: JSON.stringify({ method: 'PATCH' }) },
      ),
    );
    if (records.length !== 1 || relationId(records[0].id) !== id) {
      throw new Error(`open-balena-api did not confirm write access to ${resource}(${id}).`);
    }
  }

  private async verifyDeviceTypeMetadata(
    authorization: string,
    metadata: Map<string, { version: string; applicationId: number }>,
  ): Promise<void> {
    const timeout = this.dependencies.metadataVerificationTimeoutMs ?? METADATA_VERIFICATION_TIMEOUT_MS;
    const interval = this.dependencies.metadataVerificationPollIntervalMs ?? 1000;
    if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isFinite(interval) || interval <= 0) {
      throw new Error('Metadata verification timeout and polling interval must be positive finite milliseconds.');
    }
    const deadline = Date.now() + timeout;
    let issue = 'No API metadata response.';
    while (Date.now() < deadline) {
      try {
        const response = await this.requestJson(`${this.dependencies.apiUrl()}/device-types/v1`, authorization, {
          signal: AbortSignal.timeout(Math.max(1, Math.min(METADATA_REQUEST_TIMEOUT_MS, deadline - Date.now()))),
        });
        if (!Array.isArray(response) || !response.every(isRecord)) {
          throw new Error('The API device-type metadata endpoint did not return a JSON array.');
        }
        const unresolved = [...metadata].filter(
          ([slug, { version }]) => !response.some((record) => record.slug === slug && record.buildId === version),
        );
        if (unresolved.length === 0) return;
        issue = `Missing or stale API metadata for ${unresolved.map(([slug]) => slug).join(', ')}.`;
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !(
            ['AbortError', 'TimeoutError'].includes(error.name) ||
            (error instanceof SyncRequestError && error.status >= 500)
          )
        ) {
          throw error;
        }
        issue = error.message;
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(interval, Math.max(0, deadline - Date.now()))));
    }
    throw new Error(
      `Device-type release assets were verified, but ob-api metadata refresh did not complete: ${issue} ` +
        'Check ob-api access to the internal metadata URL. An already-stuck upstream metadata request cannot be ' +
        'cleared by cache invalidation; restart the affected ob-api instance and rerun synchronization. ' +
        'Existing release assets will be reused.',
    );
  }

  private async sourceApplications(deviceTypeSlug: string, includeEsr: boolean): Promise<RecordValue[]> {
    const standardSlug = `balena_os/${deviceTypeSlug}`;
    const esrSlug = `${standardSlug}-esr`;
    return this.getAll(this.dependencies.catalogApiUrl(), 'v6', 'application', {
      $filter: `(is_host eq true) and (is_public eq true) and (${
        includeEsr
          ? `(slug eq ${quote(standardSlug)}) or (slug eq ${quote(esrSlug)})`
          : `slug eq ${quote(standardSlug)}`
      })`,
      $select: 'id,uuid,app_name,slug,is_host,is_public,is_of__class,is_archived',
      $orderby: 'slug asc',
    });
  }

  private async sourceSupervisorApplications(cpuArchitectureSlug: string): Promise<RecordValue[]> {
    return this.getAll(this.dependencies.catalogApiUrl(), 'v7', 'application', {
      $filter: `(is_host eq false) and (is_public eq true) and (startswith(slug,'balena_os/')) and (endswith(slug,'-supervisor')) and (is_for__device_type/any(type:type/is_of__cpu_architecture/any(architecture:architecture/slug eq ${quote(cpuArchitectureSlug)})))`,
      $select: 'id,uuid,app_name,slug,is_host,is_public,is_of__class,is_archived',
      $orderby: 'slug asc',
    });
  }

  private async sourceHostAppUpdaterApplications(): Promise<RecordValue[]> {
    return this.getAll(this.dependencies.catalogApiUrl(), 'v6', 'application', {
      $filter: `(is_host eq false) and (is_public eq true) and (slug eq ${quote(HOST_APP_UPDATER_SLUG)})`,
      $select: 'id,uuid,app_name,slug,is_host,is_public,is_of__class,is_archived',
      $orderby: 'id asc',
    });
  }

  private async sourceReleases(application: RecordValue, includeInvalidated = false): Promise<RecordValue[]> {
    const sourceApplicationId = relationId(application.id);
    if (!sourceApplicationId) throw new Error(`Catalog application ${application.slug} has no valid ID.`);
    return this.getAll(this.dependencies.catalogApiUrl(), 'v6', 'release', {
      $filter: `(belongs_to__application eq ${sourceApplicationId}) and (is_final eq true) and (status eq 'success')${
        includeInvalidated ? '' : ' and (is_invalidated eq false)'
      }`,
      $select:
        'id,created_at,modified_at,commit,composition,status,source,is_invalidated,start_timestamp,end_timestamp,update_timestamp,release_version,contract,is_passing_tests,is_finalized_at__date,phase,semver,raw_version,variant,revision,known_issue_list,note,invalidation_reason',
      $orderby: 'semver_major asc,semver_minor asc,semver_patch asc,revision asc',
    });
  }

  private async sourceGraph(
    deviceType: { id: number; slug: string },
    application: RecordValue,
    releases: RecordValue[],
  ): Promise<SourceGraph> {
    const sourceApplicationId = relationId(application.id);
    if (!sourceApplicationId) throw new Error(`Catalog application ${application.slug} has no valid ID.`);
    const services = await this.getAll(this.dependencies.catalogApiUrl(), 'v6', 'service', {
      $filter: `application eq ${sourceApplicationId}`,
      $select: 'id,service_name,application',
      $orderby: 'id asc',
    });
    const releaseIds = releases.map(({ id }) => relationId(id)).filter((id): id is number => id !== undefined);
    const releaseImages: RecordValue[] = [];
    for (const releaseIdChunk of chunks(releaseIds)) {
      releaseImages.push(
        ...(await this.getAll(this.dependencies.catalogApiUrl(), 'v6', 'release_image', {
          $filter: releaseIdChunk.map((id) => `is_part_of__release eq ${id}`).join(' or '),
          $select: 'id,image,is_part_of__release',
          $orderby: 'id asc',
        })),
      );
    }
    const imageIds = [
      ...new Set(releaseImages.map(({ image }) => relationId(image)).filter((id): id is number => id !== undefined)),
    ];
    const images: RecordValue[] = [];
    for (const imageIdChunk of chunks(imageIds)) {
      images.push(
        ...(await this.getAll(this.dependencies.catalogApiUrl(), 'v6', 'image', {
          $filter: `(${imageIdChunk.map((id) => `id eq ${id}`).join(' or ')}) and (status eq 'success')`,
          $select:
            'id,created_at,modified_at,start_timestamp,end_timestamp,dockerfile,is_a_build_of__service,image_size,is_stored_at__image_location,project_type,error_message,push_timestamp,status,content_hash,contract',
          $orderby: 'id asc',
        })),
      );
    }
    const selectedServiceIds = new Set(
      images
        .map(({ is_a_build_of__service }) => relationId(is_a_build_of__service))
        .filter((id): id is number => id !== undefined),
    );
    return {
      application,
      deviceType,
      releases,
      services: services.filter(({ id }) => selectedServiceIds.has(relationId(id) ?? -1)),
      images,
      releaseImages,
    };
  }

  private async resolveRegistryHost(authorization: string): Promise<string> {
    const configured = this.dependencies.registryHost();
    if (configured) return configured;
    const existingImage = (
      await this.getAll(
        this.dependencies.apiUrl(),
        this.dependencies.apiVersion(),
        'image',
        { $select: 'is_stored_at__image_location', $top: 1 },
        authorization,
      )
    )[0];
    const location = asString(existingImage?.is_stored_at__image_location);
    if (location) return location.split('/')[0];
    const hostname = new URL(this.dependencies.apiUrl()).hostname;
    if (!hostname.startsWith('api.')) {
      throw new Error(
        'OPEN_BALENA_OS_REGISTRY_HOST must be configured when the registry hostname cannot be discovered.',
      );
    }
    return `registry.${hostname.slice(4)}`;
  }

  public async getCatalog(authorization: string): Promise<BalenaOsCatalog> {
    const version = this.dependencies.apiVersion();
    const softwareVersion = this.dependencies.apiSoftwareVersion();
    const hasReleaseSemver = supportsReleaseSemver(softwareVersion);
    const hasHostAppImageCatalog = supportsHostAppImageCatalog(softwareVersion);
    const localTypes = await this.localDeviceTypes(authorization);
    const [organizations, localApplications] = await Promise.all([
      this.getAll(
        this.dependencies.apiUrl(),
        version,
        'organization',
        { $select: 'id,name', $orderby: 'name asc' },
        authorization,
      ),
      this.getAll(
        this.dependencies.apiUrl(),
        version,
        'application',
        {
          $filter: 'is_host eq true',
          $select: 'id,slug,is_for__device_type',
          $orderby: 'slug asc',
        },
        authorization,
      ),
    ]);
    const localApplicationIds = localApplications
      .map(({ id }) => relationId(id))
      .filter((id): id is number => id !== undefined);
    const localReleases =
      localApplicationIds.length === 0
        ? []
        : await this.getAll(
            this.dependencies.apiUrl(),
            version,
            'release',
            {
              $filter: localApplicationIds.map((id) => `belongs_to__application eq ${id}`).join(' or '),
              $select: hasReleaseSemver ? 'id,raw_version,belongs_to__application' : 'id,belongs_to__application',
            },
            authorization,
          );
    if (!hasReleaseSemver && localReleases.length > 0) {
      const releaseIds = localReleases.map(({ id }) => relationId(id)).filter((id): id is number => id != null);
      const versionTags: RecordValue[] = [];
      for (const releaseIdChunk of chunks(releaseIds)) {
        versionTags.push(
          ...(await this.getAll(
            this.dependencies.apiUrl(),
            version,
            'release_tag',
            {
              $filter: `(tag_key eq 'version') and (${releaseIdChunk.map((id) => `release eq ${id}`).join(' or ')})`,
              $select: 'release,value',
            },
            authorization,
          )),
        );
      }
      const versionsByRelease = new Map(
        versionTags.map((tag) => [relationId(tag.release), asString(tag.value)] as const),
      );
      for (const release of localReleases) {
        release.raw_version = versionsByRelease.get(relationId(release.id)) ?? null;
      }
    }

    const deviceTypes = await Promise.all(
      localTypes.flatMap((record) => {
        const id = relationId(record.id);
        const slug = asString(record.slug);
        if (!id || !slug) return [];
        return [
          (async (): Promise<BalenaOsCatalogDeviceType> => {
            const catalog = hasHostAppImageCatalog ? await this.imageCatalog(authorization, slug) : undefined;
            const catalogVersions = catalog ? new Set(catalog) : undefined;
            const sourceApplications = await this.sourceApplications(slug, catalogVersions != null);
            const usableVersions: string[] = [];
            for (const sourceApplication of sourceApplications) {
              usableVersions.push(
                ...(await this.sourceReleases(sourceApplication))
                  .filter(
                    (release) =>
                      release.is_invalidated !== true &&
                      (catalogVersions ? catalogVersions.has(String(release.raw_version)) : isNonEsrRelease(release)),
                  )
                  .map(({ raw_version }) => asString(raw_version))
                  .filter((rawVersion): rawVersion is string => rawVersion != null),
              );
            }
            const typeApplications = localApplications.filter(
              (application) => relationId(application.is_for__device_type) === id,
            );
            const typeApplicationIds = new Set(
              typeApplications
                .map(({ id: appId }) => relationId(appId))
                .filter((appId): appId is number => appId != null),
            );
            const typeReleases = localReleases.filter((release) =>
              typeApplicationIds.has(relationId(release.belongs_to__application) ?? -1),
            );
            return {
              id,
              slug,
              availableVersions: usableVersions.length,
              localApplications: typeApplications.length,
              localReleases: typeReleases.length,
              latestAvailable: latestVersion(usableVersions),
              latestLocal: latestVersion(
                typeReleases.map(({ raw_version }) => String(raw_version ?? '')).filter(Boolean),
              ),
            };
          })(),
        ];
      }),
    );

    return {
      deviceTypes,
      organizations: organizations.flatMap((organization) => {
        const id = relationId(organization.id);
        const name = asString(organization.name);
        return id && name ? [{ id, name }] : [];
      }),
      totals: {
        availableVersions: deviceTypes.reduce((total, item) => total + item.availableVersions, 0),
        localApplications: localApplications.length,
        localReleases: localReleases.length,
      },
    };
  }

  public start(
    authorization: string,
    organizationId: number,
    requestedOptions: BalenaOsSyncOptions = { mode: 'all' },
  ): BalenaOsSyncStatus {
    if (this.status.state === 'running') {
      throw new Error('A BalenaOS catalog synchronization is already running.');
    }
    const options = validatedSyncOptions(requestedOptions);
    this.status = {
      state: 'running',
      phase: 'Discovering catalog',
      processed: 0,
      total: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      mode: options.mode,
      version: options.version,
      startedAt: new Date().toISOString(),
    };
    void this.run(authorization, organizationId, options).catch((error: unknown) => {
      this.status = {
        ...this.status,
        state: 'failed',
        phase: 'Failed',
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'BalenaOS synchronization failed.',
      };
    });
    return this.getStatus();
  }

  public async setSupervisorTarget(
    authorization: string,
    deviceId: number,
    requestedVersion: string,
  ): Promise<{ releaseId: number; version: string }> {
    const parsed = parsedVersion(requestedVersion);
    if (!parsed || parsed.raw !== requestedVersion) {
      throw new BalenaOsSyncValidationError('A valid Supervisor semantic version is required.');
    }
    const device = await this.getOne('device', `id eq ${deviceId}`, 'id,is_of__device_type', authorization);
    if (!device) throw new BalenaOsSyncValidationError('The device does not exist or is not accessible.');
    const deviceTypeId = relationId(device.is_of__device_type);
    if (!deviceTypeId) throw new Error('The device has no device type.');
    const organizationId = await this.getBalenaOsOrganizationId(authorization);
    if (!organizationId) {
      throw new Error(
        'The balena_os system organization does not exist or is not accessible. Create it during deployment before assigning Supervisor releases.',
      );
    }

    this.status = {
      state: 'running',
      phase: 'Synchronizing Supervisor release',
      processed: 0,
      total: 0,
      created: 0,
      updated: 0,
      unchanged: 0,
      mode: 'single',
      version: requestedVersion,
      startedAt: new Date().toISOString(),
    };
    const releases = await this.run(
      authorization,
      organizationId,
      { mode: 'single', version: requestedVersion },
      deviceTypeId,
    );
    const releaseId = [...releases.entries()].find(([key]) => key.endsWith(`:${requestedVersion}`))?.[1];
    if (!releaseId) throw new Error(`Supervisor release ${requestedVersion} was not synchronized.`);
    await this.requestJson(
      `${this.dependencies.apiUrl()}/${this.dependencies.apiVersion()}/device(${deviceId})`,
      authorization,
      {
        method: 'PATCH',
        body: JSON.stringify({ should_be_managed_by__release: releaseId }),
      },
    );
    return { releaseId, version: requestedVersion };
  }

  private async run(
    authorization: string,
    organizationId: number,
    options: BalenaOsSyncOptions,
    supervisorDeviceTypeId?: number,
  ): Promise<Map<string, number>> {
    const apiVersion = this.dependencies.apiVersion();
    const softwareVersion = this.dependencies.apiSoftwareVersion();
    const hasReleaseSemver = supportsReleaseSemver(softwareVersion);
    const hasApplicationClass = supportsApplicationClass(softwareVersion);
    const hasHostAppImageCatalog = supportsHostAppImageCatalog(softwareVersion);
    const synchronizeMetadata = supervisorDeviceTypeId == null && supportsReleaseAssetMetadata(softwareVersion);
    const [organization, applicationType, allDeviceTypes, registryHost, devices] = await Promise.all([
      this.getOne('organization', `id eq ${organizationId}`, 'id,name', authorization),
      this.getOne('application_type', "slug eq 'default'", 'id,slug', authorization),
      this.localDeviceTypes(authorization),
      this.resolveRegistryHost(authorization),
      this.getAll(
        this.dependencies.apiUrl(),
        apiVersion,
        'device',
        {
          $filter: supervisorDeviceTypeId == null ? 'os_version ne null' : 'id eq 0',
          $select: 'id,os_version,is_of__device_type',
        },
        authorization,
      ),
    ]);
    if (!organization) throw new Error('The selected destination organization does not exist or is not accessible.');
    const applicationTypeId = relationId(applicationType?.id);
    if (!applicationTypeId) throw new Error('The default application type does not exist.');
    const deviceTypes =
      supervisorDeviceTypeId == null
        ? allDeviceTypes
        : allDeviceTypes.filter(({ id }) => relationId(id) === supervisorDeviceTypeId);
    if (deviceTypes.length === 0) throw new Error('The device type does not exist or is not accessible.');
    const inUseVersionsByDeviceType = new Map<number, string[]>();
    for (const device of devices) {
      const deviceTypeId = relationId(device.is_of__device_type);
      const osVersion = asString(device.os_version);
      if (!deviceTypeId || !osVersion) continue;
      const versionsForType = inUseVersionsByDeviceType.get(deviceTypeId) ?? [];
      versionsForType.push(osVersion);
      inUseVersionsByDeviceType.set(deviceTypeId, versionsForType);
    }

    const graphs: SourceGraph[] = [];
    for (const deviceType of deviceTypes) {
      const id = relationId(deviceType.id);
      const slug = asString(deviceType.slug);
      if (!id || !slug) continue;
      let catalogVersions: Set<string> | undefined;
      let applications: RecordValue[];
      if (supervisorDeviceTypeId == null) {
        const catalog = hasHostAppImageCatalog ? await this.imageCatalog(authorization, slug) : undefined;
        catalogVersions = catalog ? new Set(catalog) : undefined;
        applications = await this.sourceApplications(slug, catalogVersions != null);
      } else {
        const localDeviceType = await this.getOne(
          'device_type',
          `id eq ${id}`,
          'id,is_of__cpu_architecture',
          authorization,
        );
        const cpuArchitectureId = relationId(localDeviceType?.is_of__cpu_architecture);
        if (!cpuArchitectureId) throw new Error(`Device type ${slug} has no CPU architecture.`);
        const cpuArchitecture = await this.getOne(
          'cpu_architecture',
          `id eq ${cpuArchitectureId}`,
          'id,slug',
          authorization,
        );
        const cpuArchitectureSlug = asString(cpuArchitecture?.slug);
        if (!cpuArchitectureSlug) throw new Error(`Device type ${slug} has no valid CPU architecture slug.`);
        applications = await this.sourceSupervisorApplications(cpuArchitectureSlug);
      }
      const releasesByApplication = new Map<number, RecordValue[]>();
      for (const application of applications) {
        const applicationId = relationId(application.id);
        if (!applicationId) continue;
        releasesByApplication.set(
          applicationId,
          (await this.sourceReleases(application, true)).filter((release) =>
            catalogVersions ? catalogVersions.has(String(release.raw_version)) : isNonEsrRelease(release),
          ),
        );
      }
      const selectedReleaseIds = new Set(
        selectBalenaOsReleases(
          [...releasesByApplication.values()].flat(),
          options,
          inUseVersionsByDeviceType.get(id) ?? [],
        )
          .map(({ id: releaseId }) => relationId(releaseId))
          .filter((releaseId): releaseId is number => releaseId != null),
      );
      if (synchronizeMetadata) {
        for (const releases of releasesByApplication.values()) {
          const latest = releases
            .filter((release) => release.is_invalidated !== true && isNonEsrRelease(release))
            .map((release) => ({ release, version: parsedVersion(release.raw_version) }))
            .filter(
              (entry): entry is { release: RecordValue; version: semver.SemVer } =>
                entry.version != null && entry.version.major > 0,
            )
            .sort((left, right) => compareBalenaVersions(right.version, left.version))[0]?.release;
          const latestId = relationId(latest?.id);
          if (!latestId)
            throw new Error(`Device type ${slug} has no usable public Host OS release for config metadata.`);
          selectedReleaseIds.add(latestId);
        }
        if (applications.length === 0) {
          throw new Error(`Device type ${slug} has no public Host OS application for config metadata.`);
        }
      }
      for (const application of applications) {
        const selectedReleases = expandBalenaOsRevisionChain(
          releasesByApplication.get(relationId(application.id) ?? -1) ?? [],
          selectedReleaseIds,
        );
        const graph = await this.sourceGraph({ id, slug }, application, selectedReleases);
        if (graph.releases.length > 0) graphs.push(graph);
      }
    }
    if (graphs.length === 0) {
      throw new Error(
        supervisorDeviceTypeId == null
          ? 'No assignable public BalenaOS releases matched the selected synchronization mode.'
          : 'No assignable public Supervisor release matched the selected version.',
      );
    }
    if (supervisorDeviceTypeId == null && supportsHostAppUpdaterRelation(softwareVersion)) {
      const updaterApplications = await this.sourceHostAppUpdaterApplications();
      if (updaterApplications.length !== 1) {
        throw new Error(`The public ${HOST_APP_UPDATER_SLUG} updater application is unavailable or ambiguous.`);
      }
      const updaterApplication = updaterApplications[0];
      const updaterRelease = (await this.sourceReleases(updaterApplication))
        .map((release) => ({ release, version: parsedVersion(release.raw_version) }))
        .filter((entry): entry is { release: RecordValue; version: semver.SemVer } => entry.version != null)
        .sort((left, right) => compareBalenaVersions(right.version, left.version))[0]?.release;
      if (!updaterRelease) throw new Error(`The public ${HOST_APP_UPDATER_SLUG} application has no usable release.`);
      const updaterDeviceType = deviceTypes[0];
      const updaterDeviceTypeId = relationId(updaterDeviceType.id);
      const updaterDeviceTypeSlug = asString(updaterDeviceType.slug);
      if (!updaterDeviceTypeId || !updaterDeviceTypeSlug) {
        throw new Error('The updater application cannot be associated with a valid local device type.');
      }
      const updaterGraph = await this.sourceGraph(
        { id: updaterDeviceTypeId, slug: updaterDeviceTypeSlug },
        updaterApplication,
        [updaterRelease],
      );
      updaterGraph.isHostAppUpdater = true;
      graphs.unshift(updaterGraph);
    }

    this.status.total = graphs.reduce(
      (total, graph) =>
        total +
        1 +
        graph.services.length +
        graph.releases.length +
        graph.images.length +
        graph.releaseImages.length +
        graph.releaseImages.reduce((total, link) => total + hostReleaseImageLabels(graph, link).length, 0) +
        (graph.isHostAppUpdater ? 1 : 0) +
        (graph.application.is_host === true && supportsHostAppUpdaterRelation(softwareVersion) ? 1 : 0) +
        (hasReleaseSemver ? 0 : graph.releases.length),
      synchronizeMetadata ? deviceTypes.length : 0,
    );
    this.status.phase = 'Synchronizing catalog';

    const synchronizedReleases = new Map<string, number>();
    let localHostAppUpdaterId: number | undefined;
    for (const graph of graphs) {
      const slug = String(graph.application.slug);
      const sourceUuid = asString(graph.application.uuid);
      if (!sourceUuid) throw new Error(`Catalog application ${slug} has no valid UUID.`);
      const isHost = graph.application.is_host === true;
      const applicationSelect = `id,uuid,app_name,slug,organization,application_type,is_for__device_type,is_host,is_public,is_archived,should_track_latest_release${
        supportsHostAppUpdaterRelation(softwareVersion) ? ',should_be_running__release' : ''
      }${hasApplicationClass ? ',is_of__class' : ''}`;
      const existingApplication = await this.getOne(
        'application',
        `uuid eq ${quote(sourceUuid)}`,
        applicationSelect,
        authorization,
      );
      if (existingApplication && existingApplication.is_host !== isHost) {
        throw new Error(`Cannot synchronize ${slug}: an application of a different type already uses its UUID.`);
      }
      const applicationPayload: RecordValue = {
        uuid: sourceUuid,
        app_name: graph.application.app_name,
        organization: organizationId,
        application_type: applicationTypeId,
        is_for__device_type: relationId(existingApplication?.is_for__device_type) ?? graph.deviceType.id,
        is_host: isHost,
        is_public: true,
        is_archived: false,
        should_track_latest_release: true,
      };
      if (!existingApplication) applicationPayload.slug = slug;
      if (hasApplicationClass) applicationPayload.is_of__class = graph.isHostAppUpdater ? 'block' : 'app';
      const localApplication = await this.write(
        'application',
        existingApplication,
        applicationPayload,
        `uuid eq ${quote(sourceUuid)}`,
        applicationSelect,
        authorization,
      );
      const localApplicationId = relationId(localApplication.id)!;
      if (graph.isHostAppUpdater) localHostAppUpdaterId = localApplicationId;
      if (isHost && supportsHostAppUpdaterRelation(softwareVersion)) {
        if (!localHostAppUpdaterId) throw new Error('The local Host OS updater application was not synchronized.');
        if (!this.dependencies.setHostAppUpdaterRelation) {
          throw new Error('Host OS updater relationship synchronization is not configured.');
        }
        await this.dependencies.setHostAppUpdaterRelation(authorization, localApplicationId, localHostAppUpdaterId);
        this.status.updated += 1;
        this.status.processed += 1;
      }

      const existingServices = await this.getAll(
        this.dependencies.apiUrl(),
        apiVersion,
        'service',
        { $filter: `application eq ${localApplicationId}`, $select: 'id,service_name,application' },
        authorization,
      );
      const serviceMap = new Map<number, number>();
      for (const sourceService of graph.services) {
        const sourceServiceId = relationId(sourceService.id);
        const serviceName = asString(sourceService.service_name);
        if (!sourceServiceId || !serviceName) throw new Error(`Catalog service for ${slug} is invalid.`);
        const existing = existingServices.find((service) => service.service_name === serviceName);
        const local = await this.write(
          'service',
          existing,
          { application: localApplicationId, service_name: serviceName },
          `(application eq ${localApplicationId}) and (service_name eq ${quote(serviceName)})`,
          'id,service_name,application',
          authorization,
        );
        serviceMap.set(sourceServiceId, relationId(local.id)!);
      }

      const existingReleases = await this.getAll(
        this.dependencies.apiUrl(),
        apiVersion,
        'release',
        {
          $filter: `belongs_to__application eq ${localApplicationId}`,
          $select: hasReleaseSemver
            ? 'id,belongs_to__application,commit,composition,status,source,is_invalidated,start_timestamp,end_timestamp,release_version,contract,is_passing_tests,is_finalized_at__date,phase,semver,raw_version,variant,revision,known_issue_list,note,invalidation_reason'
            : 'id,belongs_to__application,commit,composition,status,source,is_invalidated,start_timestamp,end_timestamp,release_version,contract,is_passing_tests,release_type',
        },
        authorization,
      );
      const releaseMap = new Map<number, number>();
      for (const sourceRelease of graph.releases) {
        const sourceReleaseId = relationId(sourceRelease.id);
        const commit = asString(sourceRelease.commit);
        const rawVersion = asString(sourceRelease.raw_version);
        if (!sourceReleaseId || !commit || !rawVersion) throw new Error(`Catalog release for ${slug} is invalid.`);
        const existing = existingReleases.find((release) => release.commit === commit);
        const releasePayload: RecordValue = {
          belongs_to__application: localApplicationId,
          commit,
          composition: structuredField(sourceRelease.composition, 'composition', `release ${commit}`, {}),
          status: 'success',
          source: 'cloud',
          is_invalidated: sourceRelease.is_invalidated === true,
          start_timestamp: sourceRelease.start_timestamp ?? sourceRelease.created_at,
          end_timestamp: sourceRelease.end_timestamp ?? sourceRelease.modified_at,
          release_version: sourceRelease.release_version ?? null,
          contract: structuredField(sourceRelease.contract, 'contract', `release ${commit}`, null),
          is_passing_tests: sourceRelease.is_passing_tests ?? true,
        };
        if (hasReleaseSemver) {
          Object.assign(releasePayload, {
            is_finalized_at__date: sourceRelease.is_finalized_at__date ?? sourceRelease.end_timestamp ?? null,
            phase: sourceRelease.phase ?? null,
            semver: rawVersion,
            variant: sourceRelease.variant ?? '',
            known_issue_list: sourceRelease.known_issue_list ?? null,
            note: sourceRelease.note ?? null,
            invalidation_reason: null,
          });
        } else {
          releasePayload.release_type = 'final';
        }
        const local = await this.write(
          'release',
          existing,
          releasePayload,
          `(belongs_to__application eq ${localApplicationId}) and (commit eq ${quote(commit)})`,
          hasReleaseSemver
            ? 'id,belongs_to__application,commit,composition,status,source,is_invalidated,start_timestamp,end_timestamp,release_version,contract,is_passing_tests,is_finalized_at__date,phase,semver,raw_version,variant,revision,known_issue_list,note,invalidation_reason'
            : 'id,belongs_to__application,commit,composition,status,source,is_invalidated,start_timestamp,end_timestamp,release_version,contract,is_passing_tests,release_type',
          authorization,
        );
        releaseMap.set(sourceReleaseId, relationId(local.id)!);
        synchronizedReleases.set(`${sourceUuid}:${rawVersion}`, relationId(local.id)!);
      }

      if (graph.isHostAppUpdater) {
        const localUpdaterReleaseId = releaseMap.values().next().value;
        if (!localUpdaterReleaseId) throw new Error('The local Host OS updater release was not synchronized.');
        await this.write(
          'application',
          localApplication,
          { should_be_running__release: localUpdaterReleaseId },
          `uuid eq ${quote(sourceUuid)}`,
          applicationSelect,
          authorization,
        );
      }

      if (!hasReleaseSemver && releaseMap.size > 0) {
        const localReleaseIds = [...releaseMap.values()];
        const existingVersionTags: RecordValue[] = [];
        for (const releaseIdChunk of chunks(localReleaseIds)) {
          existingVersionTags.push(
            ...(await this.getAll(
              this.dependencies.apiUrl(),
              apiVersion,
              'release_tag',
              {
                $filter: `(tag_key eq 'version') and (${releaseIdChunk.map((id) => `release eq ${id}`).join(' or ')})`,
                $select: 'id,release,tag_key,value',
              },
              authorization,
            )),
          );
        }
        for (const sourceRelease of graph.releases) {
          const localReleaseId = releaseMap.get(relationId(sourceRelease.id) ?? -1);
          if (!localReleaseId) throw new Error(`Catalog release for ${slug} could not be mapped.`);
          const existing = existingVersionTags.find((tag) => relationId(tag.release) === localReleaseId);
          await this.write(
            'release_tag',
            existing,
            { release: localReleaseId, tag_key: 'version', value: sourceRelease.raw_version },
            `(release eq ${localReleaseId}) and (tag_key eq 'version')`,
            'id,release,tag_key,value',
            authorization,
          );
        }
      }

      const existingImages =
        serviceMap.size === 0
          ? []
          : await this.getAll(
              this.dependencies.apiUrl(),
              apiVersion,
              'image',
              {
                $filter: [...serviceMap.values()].map((id) => `is_a_build_of__service eq ${id}`).join(' or '),
                $select:
                  'id,start_timestamp,end_timestamp,dockerfile,is_a_build_of__service,image_size,is_stored_at__image_location,project_type,error_message,push_timestamp,status,content_hash,contract',
              },
              authorization,
            );
      const imageMap = new Map<number, number>();
      for (const sourceImage of graph.images) {
        const sourceImageId = relationId(sourceImage.id);
        const sourceServiceId = relationId(sourceImage.is_a_build_of__service);
        const localServiceId = sourceServiceId ? serviceMap.get(sourceServiceId) : undefined;
        const sourceLocation = asString(sourceImage.is_stored_at__image_location);
        if (!sourceImageId || !localServiceId || !sourceLocation) {
          throw new Error(`Catalog image for ${slug} has an invalid service or location.`);
        }
        const contentHash = sourceImage.content_hash ?? null;
        const pathStart = sourceLocation.indexOf('/');
        if (pathStart < 0) throw new Error(`Catalog image for ${slug} has an invalid registry location.`);
        const location = `${registryHost}${sourceLocation.slice(pathStart)}`;
        const existing = existingImages.find(
          (image) =>
            relationId(image.is_a_build_of__service) === localServiceId &&
            (contentHash ? image.content_hash === contentHash : image.is_stored_at__image_location === location),
        );
        const local = await this.reconcileImageLocation(
          await this.write(
            'image',
            existing,
            {
              start_timestamp: sourceImage.start_timestamp,
              end_timestamp: sourceImage.end_timestamp ?? null,
              dockerfile: sourceImage.dockerfile ?? null,
              is_a_build_of__service: localServiceId,
              image_size: sourceImage.image_size ?? null,
              is_stored_at__image_location: location,
              project_type: sourceImage.project_type ?? null,
              error_message: sourceImage.error_message ?? null,
              push_timestamp: sourceImage.push_timestamp ?? null,
              status: 'success',
              content_hash: contentHash,
              contract: structuredField(sourceImage.contract, 'contract', `image ${sourceImageId}`, null),
            },
            contentHash
              ? `(is_a_build_of__service eq ${localServiceId}) and (content_hash eq ${quote(String(contentHash))})`
              : `(is_a_build_of__service eq ${localServiceId}) and (is_stored_at__image_location eq ${quote(location)})`,
            'id,is_a_build_of__service,is_stored_at__image_location,content_hash',
            authorization,
          ),
          location,
          authorization,
        );
        imageMap.set(sourceImageId, relationId(local.id)!);
      }

      const existingLinks: RecordValue[] = [];
      for (const releaseIdChunk of chunks([...releaseMap.values()])) {
        existingLinks.push(
          ...(await this.getAll(
            this.dependencies.apiUrl(),
            apiVersion,
            'release_image',
            {
              $filter: releaseIdChunk.map((id) => `is_part_of__release eq ${id}`).join(' or '),
              $select: 'id,image,is_part_of__release',
            },
            authorization,
          )),
        );
      }
      for (const sourceLink of graph.releaseImages) {
        const localReleaseId = releaseMap.get(relationId(sourceLink.is_part_of__release) ?? -1);
        const localImageId = imageMap.get(relationId(sourceLink.image) ?? -1);
        if (!localReleaseId || !localImageId) {
          throw new Error(`Catalog release-image relation for ${slug} could not be mapped.`);
        }
        const existing = existingLinks.find(
          (link) => relationId(link.is_part_of__release) === localReleaseId && relationId(link.image) === localImageId,
        );
        const localLink = await this.write(
          'release_image',
          existing,
          { image: localImageId, is_part_of__release: localReleaseId },
          `(image eq ${localImageId}) and (is_part_of__release eq ${localReleaseId})`,
          'id,image,is_part_of__release',
          authorization,
        );
        const localLinkId = relationId(localLink.id);
        if (!localLinkId) throw new Error(`Catalog release-image relation for ${slug} has no valid ID.`);
        const labels = hostReleaseImageLabels(graph, sourceLink);
        if (labels.length > 0) {
          const existingLabels = await this.getAll(
            this.dependencies.apiUrl(),
            apiVersion,
            'image_label',
            {
              $filter: `release_image eq ${localLinkId}`,
              $select: 'id,release_image,label_name,value',
            },
            authorization,
          );
          for (const [labelName, value] of labels) {
            const existingLabel = existingLabels.find((label) => label.label_name === labelName);
            await this.write(
              'image_label',
              existingLabel,
              { release_image: localLinkId, label_name: labelName, value },
              `(release_image eq ${localLinkId}) and (label_name eq ${quote(labelName)})`,
              'id,release_image,label_name,value',
              authorization,
            );
          }
        }
      }

      this.status.phase = `Synchronized ${slug}`;
    }

    if (synchronizeMetadata) await this.synchronizeDeviceTypeAssets(authorization, deviceTypes);

    this.status = {
      ...this.status,
      state: 'completed',
      phase: 'Complete',
      finishedAt: new Date().toISOString(),
    };
    return synchronizedReleases;
  }
}

export const balenaOsSyncManager = new BalenaOsSyncManager();
