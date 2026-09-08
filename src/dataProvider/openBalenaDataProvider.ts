import type { DataProvider } from 'react-admin';
import semver from 'semver';
import postgrestDataProvider from './postgrestDataProvider';
import createODataDataProvider, { ODATA_RESOURCES, type HttpClient } from './odataDataProvider';

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
    return override.startsWith('v') ? override : `v${override}`;
  }
  const normalized = serverVersion ? semver.coerce(serverVersion) : null;
  return normalized && semver.gte(normalized, '25.2.8') ? 'v7' : 'v6';
};

export const openBalenaDataProvider = (
  apiUrl: string | undefined,
  httpClient: HttpClient,
  serverVersion?: string,
  odataVersion?: string,
): DataProvider => {
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

  return {
    getList: async (resource, params) => route(resource).getList(resource, params),
    getOne: async (resource, params) => route(resource).getOne(resource, params),
    getMany: async (resource, params) => route(resource).getMany(resource, params),
    getManyReference: async (resource, params) => route(resource).getManyReference(resource, params),
    create: async (resource, params) => route(resource).create(resource, params),
    update: async (resource, params) => route(resource).update(resource, params),
    updateMany: async (resource, params) => route(resource).updateMany(resource, params),
    delete: async (resource, params) => route(resource).delete(resource, params),
    deleteMany: async (resource, params) => route(resource).deleteMany(resource, params),
  };
};

export default openBalenaDataProvider;
