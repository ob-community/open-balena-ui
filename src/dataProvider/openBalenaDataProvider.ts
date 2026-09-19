import type { DataProvider } from 'react-admin';
import semver from 'semver';
import postgrestDataProvider from './postgrestDataProvider';
import createODataDataProvider, { ODATA_RESOURCES, type HttpClient } from './odataDataProvider';

export type OpenBalenaDataProvider = DataProvider & {
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
  const normalized = serverVersion ? semver.coerce(serverVersion) : null;
  return normalized && semver.gte(normalized, '25.2.8') ? 'v7' : 'v6';
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
  const apiProvider = createODataDataProvider(apiUrl, httpClient, resolveODataVersion(serverVersion, odataVersion));
  const databaseProvider = postgrestDataProvider('/admin-db', httpClient);
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
    return sanitized;
  };

  return {
    supportAbortSignal: true,
    getList: async (resource, params) => route(resource).getList(resource, params),
    getOne: async (resource, params) => route(resource).getOne(resource, params),
    getMany: async (resource, params) => route(resource).getMany(resource, params),
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
