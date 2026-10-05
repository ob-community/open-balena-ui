import type { DataProvider } from 'react-admin';
import postgrestDataProvider from './postgrestDataProvider';
import createODataDataProvider, { ODATA_RESOURCES, type HttpClient } from './odataDataProvider';
import versions from '../versions';
import { withPermissionHints } from './httpClient';
import { DeviceSnapshots } from '../lib/deviceSnapshots';

export type BalenaOsSyncMode = 'all' | 'latest-and-in-use' | 'newer-and-in-use' | 'in-use' | 'single';

export interface AdminAccessContext {
  enforcementEnabled: boolean;
  globalAdmin: boolean;
  organizationAdmin: boolean;
  userId: number;
  username?: string;
  ownActorId?: number;
  manageableApiKeyIds: number[];
}

export type OpenBalenaDataProvider = DataProvider & {
  getBalenaOsCatalog(params?: { signal?: AbortSignal }): Promise<{
    deviceTypes: Array<{
      id: number;
      slug: string;
      availableVersions: number;
      localApplications: number;
      localReleases: number;
      latestAvailable?: string;
      latestLocal?: string;
    }>;
    organizations: Array<{ id: number; name: string }>;
    totals: {
      availableVersions: number;
      localApplications: number;
      localReleases: number;
    };
  }>;
  getBalenaOsSyncStatus(params?: { signal?: AbortSignal }): Promise<{
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
  }>;
  startBalenaOsSync(params: { mode: BalenaOsSyncMode; version?: string }): Promise<void>;
  getDeviceUpdateOptions(params: {
    deviceTypeId: number;
    currentOsVersion: string;
    currentSupervisorVersion: string;
    signal?: AbortSignal;
  }): Promise<{
    operatingSystems: Array<{ id: number; version: string; knownIssues?: string[] }>;
    supervisors: Array<{
      id: number | string;
      version: string;
      knownIssues?: string[];
      target?: 'release' | 'version';
    }>;
  }>;
  setDeviceSupervisorTarget(params: { deviceId: number; version: string }): Promise<{
    releaseId: number;
    version: string;
  }>;
  getAdminAccessContext(params?: { signal?: AbortSignal }): Promise<AdminAccessContext>;
  authorizeResourceActorDeletions(params: {
    records: Array<{
      resource: 'application' | 'device' | 'user';
      id: number | string;
      actorId: number | string;
    }>;
    signal?: AbortSignal;
  }): Promise<void>;
  authorizeResourceActorDeletion(params: {
    resource: 'application' | 'device' | 'user';
    id: number | string;
    actorId: number | string;
    signal?: AbortSignal;
  }): Promise<void>;
  changePassword(params: { userId: number | string; password: string; signal?: AbortSignal }): Promise<void>;
  deleteResourceActor(params: {
    resource: 'application' | 'device' | 'user';
    id: number | string;
    actorId: number | string;
    signal?: AbortSignal;
  }): Promise<void>;
};

export const DIRECT_DB_RESOURCES = new Set([
  'actor',
  'api key',
  'api key-has-permission',
  'api key-has-role',
  'config',
  'migration',
  'migration lock',
  'model',
  'organization',
  'organization membership',
  'permission',
  'role',
  'role-has-permission',
  'user',
  'user-has-direct access to-application',
  'user-has-permission',
  'user-has-public key',
  'user-has-role',
]);

export const resolveODataVersion = (serverVersion?: string, override?: string): string => {
  if (override) {
    const normalizedOverride = override.startsWith('v') ? override : `v${override}`;
    if (!['v6', 'v7'].includes(normalizedOverride)) {
      throw new Error('REACT_APP_OPEN_BALENA_ODATA_VERSION must be v6 or v7.');
    }
    return normalizedOverride;
  }
  return versions.odataVersion(serverVersion);
};

export const openBalenaDataProvider = (
  apiUrl: string | undefined,
  httpClient: HttpClient,
  serverVersion?: string,
  odataVersion?: string,
): OpenBalenaDataProvider => {
  if (!apiUrl) {
    throw new Error('REACT_APP_OPEN_BALENA_API_URL must be defined.');
  }
  httpClient = withPermissionHints(httpClient);
  const apiProvider = createODataDataProvider(apiUrl, httpClient, resolveODataVersion(serverVersion, odataVersion));
  const databaseProvider = postgrestDataProvider('/admin-db', httpClient);
  const deviceSnapshots = new DeviceSnapshots();
  const pinnedReleaseField = versions.resource('isPinnedOnRelease', serverVersion);
  const route = (resource: string): DataProvider => {
    if (DIRECT_DB_RESOURCES.has(resource)) {
      return databaseProvider;
    }
    if (resource in ODATA_RESOURCES) {
      return apiProvider;
    }
    throw new Error(
      `Resource "${resource}" has no data-provider route. Add it explicitly to the OData or direct database allowlist.`,
    );
  };
  const sanitizeUpdateData = (resource: string, data: Record<string, unknown>): Record<string, unknown> => {
    const sanitized = { ...data };
    if (resource === 'user') {
      delete sanitized.actor;
      delete sanitized.password;
      delete sanitized.jwt_secret;
      delete sanitized['jwt secret'];
    }
    if (resource === 'api key') {
      delete sanitized['is of-actor'];
      delete sanitized.key;
    }
    if (resource === 'application') {
      delete sanitized.actor;
    }
    if (resource === 'device') {
      const writableFields = new Set([
        'device name',
        'note',
        'is of-device type',
        'is managed by-device',
        'belongs to-application',
        pinnedReleaseField,
        'should be operated by-release',
        'should be managed by-release',
      ]);
      return Object.fromEntries(Object.entries(sanitized).filter(([field]) => writableFields.has(field)));
    }
    return sanitized;
  };

  return {
    supportAbortSignal: true,
    getBalenaOsCatalog: async ({ signal } = {}) => {
      const { json } = await httpClient('/balena-os/catalog', { signal });
      return json as Awaited<ReturnType<OpenBalenaDataProvider['getBalenaOsCatalog']>>;
    },
    getBalenaOsSyncStatus: async ({ signal } = {}) => {
      const { json } = await httpClient('/balena-os/status', { signal });
      return json as Awaited<ReturnType<OpenBalenaDataProvider['getBalenaOsSyncStatus']>>;
    },
    startBalenaOsSync: async ({ mode, version }) => {
      await httpClient('/balena-os/sync', {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ mode, ...(version ? { version } : {}) }),
      });
    },
    getDeviceUpdateOptions: async ({ deviceTypeId, currentOsVersion, currentSupervisorVersion, signal }) => {
      const query = new URLSearchParams({
        deviceTypeId: String(deviceTypeId),
        currentOsVersion,
        currentSupervisorVersion,
      });
      const { json } = await httpClient(`/device-update-options?${query}`, { signal });
      return json as {
        operatingSystems: Array<{ id: number; version: string; knownIssues?: string[] }>;
        supervisors: Array<{
          id: number | string;
          version: string;
          knownIssues?: string[];
          target?: 'release' | 'version';
        }>;
      };
    },
    setDeviceSupervisorTarget: async ({ deviceId, version }) => {
      const { json } = await httpClient('/device-supervisor-target', {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ deviceId, version }),
      });
      return json as { releaseId: number; version: string };
    },
    getAdminAccessContext: async ({ signal } = {}) => {
      const { json } = await httpClient('/admin-db/actions/access-context', { signal });
      return json as AdminAccessContext;
    },
    getList: async (resource, params) => {
      // Projected lists are not authoritative device snapshots.
      const request = resource === 'device' && !params.filter?.['select@'] ? deviceSnapshots.begin() : undefined;
      const result = await route(resource).getList(resource, params);
      return request && !params.signal?.aborted
        ? { ...result, data: deviceSnapshots.reconcile(result.data, request) }
        : result;
    },
    getOne: async (resource, params) => route(resource).getOne(resource, params),
    getMany: async (resource, params) => {
      const request = resource === 'device' ? deviceSnapshots.begin() : undefined;
      const result = await route(resource).getMany(resource, params);
      return request && !params.signal?.aborted
        ? { ...result, data: deviceSnapshots.reconcile(result.data, request) }
        : result;
    },
    getManyReference: async (resource, params) => route(resource).getManyReference(resource, params),
    create: async (resource, params) => {
      if (resource === 'user') {
        const { json } = await httpClient('/admin-db/actions/create-user', {
          method: 'POST',
          headers: new Headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(params.data),
        });
        return { data: json };
      }
      if (resource === 'api key') {
        const { json } = await httpClient('/admin-db/actions/create-api-key', {
          method: 'POST',
          headers: new Headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify(params.data),
        });
        return { data: json };
      }
      if (resource === 'application' || resource === 'device') {
        const { json } = await httpClient('/admin-db/actions/create-operational-resource', {
          method: 'POST',
          headers: new Headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ resource, data: params.data }),
        });
        return { data: json };
      }
      return route(resource).create(resource, params);
    },
    update: async (resource, params) =>
      route(resource).update(resource, {
        ...params,
        data: sanitizeUpdateData(resource, params.data),
      }),
    updateMany: async (resource, params) =>
      route(resource).updateMany(resource, {
        ...params,
        data: sanitizeUpdateData(resource, params.data),
      }),
    delete: async (resource, params) => {
      if (resource === 'api key') {
        const { json } = await httpClient('/admin-db/actions/delete-api-key', {
          method: 'POST',
          headers: new Headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ id: params.id }),
        });
        return { data: json };
      }
      return route(resource).delete(resource, params);
    },
    deleteMany: async (resource, params) => {
      if (resource === 'api key') {
        await httpClient('/admin-db/actions/delete-api-keys', {
          method: 'POST',
          headers: new Headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ ids: params.ids }),
        });
        return { data: params.ids };
      }
      return route(resource).deleteMany(resource, params);
    },
    authorizeResourceActorDeletions: async ({ records, signal }) => {
      await httpClient('/admin-db/actions/authorize-resource-actor-deletions', {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ records }),
        signal,
      });
    },
    authorizeResourceActorDeletion: async ({ resource, id, actorId, signal }) => {
      await httpClient('/admin-db/actions/authorize-resource-actor-deletion', {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ resource, id, actorId }),
        signal,
      });
    },
    changePassword: async ({ userId, password, signal }) => {
      await httpClient('/admin-db/actions/change-password', {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ userId, password }),
        signal,
      });
    },
    deleteResourceActor: async ({ resource, id, actorId, signal }) => {
      await httpClient('/admin-db/actions/delete-resource-actor', {
        method: 'POST',
        headers: new Headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ resource, id, actorId }),
        signal,
      });
    },
  };
};

export default openBalenaDataProvider;
