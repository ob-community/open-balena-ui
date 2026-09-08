import type { DataProvider, Identifier, Options, RaRecord } from 'react-admin';
import { fetchUtils } from 'react-admin';

export type HttpClient = (url: string, options?: Options) => ReturnType<typeof fetchUtils.fetchJson>;

export const ODATA_RESOURCES = {
  'application': 'application',
  'application config variable': 'application_config_variable',
  'application environment variable': 'application_environment_variable',
  'application tag': 'application_tag',
  'application type': 'application_type',
  'cpu architecture': 'cpu_architecture',
  'device': 'device',
  'device config variable': 'device_config_variable',
  'device environment variable': 'device_environment_variable',
  'device family': 'device_family',
  'device manufacturer': 'device_manufacturer',
  'device service environment variable': 'device_service_environment_variable',
  'device tag': 'device_tag',
  'device type': 'device_type',
  'device type alias': 'device_type_alias',
  'image': 'image',
  'image environment variable': 'image_environment_variable',
  'image install': 'image_install',
  'image label': 'image_label',
  'image-is part of-release': 'release_image',
  'release': 'release',
  'release asset': 'release_asset',
  'release image': 'release_image',
  'release tag': 'release_tag',
  'service': 'service',
  'service environment variable': 'service_environment_variable',
  'service install': 'service_install',
  'service instance': 'service_instance',
  'service label': 'service_label',
  'scheduled job run': 'scheduled_job_run',
} as const;

export type ODataResource = keyof typeof ODATA_RESOURCES;

const joinUrl = (base: string, segment: string): string => `${base.replace(/\/+$/, '')}/${segment.replace(/^\/+/, '')}`;

const toApiField = (field: string): string => field.replace(/-/g, '__').replace(/ /g, '_');
const fromApiField = (field: string): string => field.replace(/__/g, '-').replace(/_/g, ' ');
const escapeString = (value: string): string => value.replace(/'/g, "''");

const toODataValue = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (value instanceof Date) {
    return `'${escapeString(value.toISOString())}'`;
  }
  return `'${escapeString(String(value))}'`;
};

const group = (clauses: string[], operator: 'and' | 'or'): string =>
  clauses.length === 1 ? clauses[0] : `(${clauses.join(` ${operator} `)})`;

const comparison = (field: string, operator: string, value: unknown): string => {
  const apiField = toApiField(field);
  switch (operator.toLowerCase()) {
    case 'neq':
    case 'ne':
      return `${apiField} ne ${toODataValue(value)}`;
    case 'lt':
      return `${apiField} lt ${toODataValue(value)}`;
    case 'lte':
    case 'le':
      return `${apiField} le ${toODataValue(value)}`;
    case 'gt':
      return `${apiField} gt ${toODataValue(value)}`;
    case 'gte':
    case 'ge':
      return `${apiField} ge ${toODataValue(value)}`;
    case 'like':
    case 'contains':
      return `contains(${apiField},${toODataValue(value)})`;
    case 'ilike':
      return `contains(tolower(${apiField}),${toODataValue(String(value).toLowerCase())})`;
    default:
      return `${apiField} eq ${toODataValue(value)}`;
  }
};

const arrayComparison = (field: string, operator: string, values: unknown[]): string => {
  const isNot = operator === 'nin' || operator === 'not.in';
  const clauses = values.map((value) => comparison(field, isNot ? 'ne' : 'eq', value));
  return clauses.length ? group(clauses, isNot ? 'and' : 'or') : isNot ? 'true' : 'false';
};

const legacyArrayValue = (value: unknown): unknown[] | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const match = value.match(/^\((.*)\)$/);
  if (!match) {
    return undefined;
  }
  return match[1]
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      if (/^-?\d+(?:\.\d+)?$/.test(entry)) {
        return Number(entry);
      }
      if (entry === 'true' || entry === 'false') {
        return entry === 'true';
      }
      return entry.replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
    });
};

const fullTextFilter = (key: string, value: unknown): string | undefined => {
  if (!key.startsWith('#') || typeof value !== 'string' || !value.trim()) {
    return undefined;
  }
  const [fieldList, operator = 'contains'] = key.slice(1).split('@');
  const fields = fieldList.split(',').filter(Boolean);
  const words = value.trim().split(/\s+/);
  if (!fields.length) {
    return undefined;
  }
  return group(
    words.map((word) =>
      group(
        fields.map((field) => comparison(field, operator, word)),
        'or',
      ),
    ),
    'and',
  );
};

export const buildODataFilter = (filter: Record<string, unknown>): string => {
  const clauses: string[] = [];
  for (const [key, rawValue] of Object.entries(filter)) {
    if (rawValue === undefined) {
      continue;
    }
    const search = fullTextFilter(key, rawValue);
    if (search) {
      clauses.push(search);
      continue;
    }

    const [rawField, keyOperator = 'eq'] = key.split('@');
    const field = rawField === 'ids' ? 'id' : rawField;
    const normalizedArray = Array.isArray(rawValue)
      ? rawValue
      : ['in', 'nin', 'not.in'].includes(keyOperator)
        ? legacyArrayValue(rawValue)
        : undefined;
    if (normalizedArray) {
      clauses.push(arrayComparison(field, keyOperator === 'eq' ? 'in' : keyOperator, normalizedArray));
    } else if (rawValue !== null && typeof rawValue === 'object' && !(rawValue instanceof Date)) {
      for (const [operator, value] of Object.entries(rawValue)) {
        clauses.push(
          Array.isArray(value) ? arrayComparison(field, operator, value) : comparison(field, operator, value),
        );
      }
    } else {
      clauses.push(comparison(field, keyOperator, rawValue));
    }
  }
  return clauses.length ? group(clauses, 'and') : '';
};

export const transformFromApi = (input: unknown): unknown => {
  if (Array.isArray(input)) {
    return input.map(transformFromApi);
  }
  if (input === null || typeof input !== 'object') {
    return input;
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (key.startsWith('@odata.') || key === '__metadata' || key === '__deferred' || key === '__count') {
      continue;
    }
    const outputKey = fromApiField(key);
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && '__id' in value) {
      const relation = value as Record<string, unknown>;
      output[outputKey] = Object.keys(relation).length === 1 ? relation.__id : transformFromApi(relation);
    } else {
      output[outputKey] = transformFromApi(value);
    }
  }
  return output;
};

export const transformToApi = (input: unknown): unknown => {
  if (Array.isArray(input)) {
    return input.map(transformToApi);
  }
  if (input === null || typeof input !== 'object') {
    return input;
  }
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === undefined || key === 'id') {
      continue;
    }
    if (value !== null && typeof value === 'object' && !Array.isArray(value) && '__id' in value) {
      output[toApiField(key)] = (value as { __id: unknown }).__id;
    } else {
      output[toApiField(key)] = transformToApi(value);
    }
  }
  return output;
};

interface Collection {
  items: unknown[];
  count?: number;
}

export const extractCollection = (json: unknown): Collection => {
  if (Array.isArray(json)) {
    return { items: json };
  }
  if (!json || typeof json !== 'object') {
    throw new Error('open-balena-api returned an invalid collection response.');
  }
  const response = json as Record<string, unknown>;
  if (Array.isArray(response.value)) {
    const count = response['@odata.count'] ?? response['odata.count'];
    return { items: response.value, count: count === undefined ? undefined : Number(count) };
  }
  if (Array.isArray(response.d)) {
    const count = response.__count ?? response['@odata.count'] ?? response['odata.count'];
    return { items: response.d, count: count === undefined ? undefined : Number(count) };
  }
  if (response.d && typeof response.d === 'object') {
    const legacy = response.d as Record<string, unknown>;
    if (Array.isArray(legacy.results)) {
      return {
        items: legacy.results,
        count: legacy.__count === undefined ? undefined : Number(legacy.__count),
      };
    }
  }
  throw new Error('open-balena-api collection response did not contain an OData result array.');
};

const extractSingle = (json: unknown): unknown => {
  if (json && typeof json === 'object' && 'd' in json) {
    const data = (json as { d: unknown }).d;
    if (data && typeof data === 'object' && 'results' in data) {
      return (data as { results: unknown[] }).results[0];
    }
    return Array.isArray(data) ? data[0] : data;
  }
  if (json && typeof json === 'object' && 'value' in json) {
    const value = (json as { value: unknown }).value;
    return Array.isArray(value) ? value[0] : value;
  }
  return json;
};

const extractCount = (json: unknown): number => {
  const raw = json && typeof json === 'object' && 'd' in json ? (json as { d: unknown }).d : json;
  const count = Number(raw);
  if (!Number.isFinite(count)) {
    throw new Error('open-balena-api returned an invalid count response.');
  }
  return count;
};

const entityId = (id: Identifier): string => {
  const value = String(id);
  return typeof id === 'number' || /^-?\d+(?:\.\d+)?$/.test(value) ? value : `'${escapeString(value)}'`;
};

const requireRecord = (input: unknown, operation: string): RaRecord => {
  const record = transformFromApi(input);
  if (!record || typeof record !== 'object' || !('id' in record)) {
    throw new Error(`open-balena-api ${operation} response did not contain a record with an id.`);
  }
  return record as RaRecord;
};

export const createODataDataProvider = (
  apiUrl: string,
  httpClient: HttpClient = fetchUtils.fetchJson,
  odataVersion = 'v6',
): DataProvider => {
  if (!apiUrl) {
    throw new Error('createODataDataProvider requires an open-balena-api URL.');
  }
  const baseUrl = joinUrl(apiUrl, odataVersion);
  const resourcePath = (resource: string): string => {
    const path = ODATA_RESOURCES[resource as ODataResource];
    if (!path) {
      throw new Error(`Resource "${resource}" is not configured for open-balena-api access.`);
    }
    return joinUrl(baseUrl, path);
  };
  const collectionUrl = (resource: string, query: Record<string, string | number> = {}): string => {
    const url = new URL(resourcePath(resource));
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, String(value)));
    return url.toString();
  };
  const entityUrl = (resource: string, id: Identifier): string => `${resourcePath(resource)}(${entityId(id)})`;
  const writeOptions = (method: string, data?: unknown, signal?: AbortSignal): Options => ({
    method,
    signal,
    headers: new Headers({
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    }),
    ...(data === undefined ? {} : { body: JSON.stringify(transformToApi(data)) }),
  });

  const list = async (resource: string, params: any) => {
    const { page = 1, perPage = 25 } = params.pagination ?? {};
    const { field = 'id', order = 'ASC' } = params.sort ?? {};
    const filterValues = { ...(params.filter ?? {}) };
    const select = filterValues['select@'];
    delete filterValues['select@'];
    const filter = buildODataFilter(filterValues);
    const query: Record<string, string | number> = {
      $top: perPage,
      $skip: (page - 1) * perPage,
      $orderby: `${toApiField(field)} ${String(order).toLowerCase()}`,
    };
    if (filter) {
      query.$filter = filter;
    }
    if (typeof select === 'string' && select) {
      query.$select = select
        .split(',')
        .map((field) => toApiField(field.trim()))
        .join(',');
    }
    const options: Options = { signal: params.signal };
    const [{ json }, countResponse] = await Promise.all([
      httpClient(collectionUrl(resource, query), options),
      httpClient(
        `${resourcePath(resource)}/$count${filter ? `?${new URLSearchParams({ $filter: filter })}` : ''}`,
        options,
      ),
    ]);
    const { items, count: inlineCount } = extractCollection(json);
    const count = inlineCount ?? extractCount(countResponse.json);
    const data = items.map(transformFromApi) as RaRecord[];
    return { data, total: count };
  };

  const provider = {
    getList: list,
    getOne: async (resource, params) => {
      const { json } = await httpClient(entityUrl(resource, params.id), { signal: params.signal });
      return { data: requireRecord(extractSingle(json), 'getOne') };
    },
    getMany: async (resource, params) => {
      if (!params.ids.length) {
        return { data: [] };
      }
      const { json } = await httpClient(
        collectionUrl(resource, {
          $filter: arrayComparison('id', 'in', params.ids),
        }),
        { signal: params.signal },
      );
      return { data: extractCollection(json).items.map(transformFromApi) as RaRecord[] };
    },
    getManyReference: (resource, params) =>
      list(resource, { ...params, filter: { ...params.filter, [params.target]: params.id } }),
    create: async (resource, params) => {
      const { json } = await httpClient(resourcePath(resource), writeOptions('POST', params.data, params.signal));
      const response = extractSingle(json);
      return { data: requireRecord(response, 'create') };
    },
    update: async (resource, params) => {
      const { json } = await httpClient(
        entityUrl(resource, params.id),
        writeOptions('PATCH', params.data, params.signal),
      );
      const response = extractSingle(json);
      return {
        data: (response
          ? transformFromApi(response)
          : { ...(params.previousData ?? {}), ...params.data, id: params.id }) as RaRecord,
      };
    },
    updateMany: async (resource, params) => {
      await Promise.all(
        params.ids.map((id) => httpClient(entityUrl(resource, id), writeOptions('PATCH', params.data, params.signal))),
      );
      return { data: params.ids };
    },
    delete: async (resource, params) => {
      const { json } = await httpClient(
        entityUrl(resource, params.id),
        writeOptions('DELETE', undefined, params.signal),
      );
      const response = extractSingle(json);
      return { data: (response ? transformFromApi(response) : (params.previousData ?? { id: params.id })) as RaRecord };
    },
    deleteMany: async (resource, params) => {
      await Promise.all(
        params.ids.map((id) => httpClient(entityUrl(resource, id), writeOptions('DELETE', undefined, params.signal))),
      );
      return { data: params.ids };
    },
  };

  return provider as DataProvider;
};

export default createODataDataProvider;
