// Credit to https://github.com/raphiniert-com/ra-data-postgrest for the base code / inspiration for this component

import queryString from 'query-string';
import { fetchUtils } from 'ra-core';

function parseFilters(filter, defaultListOp) {
  let result = {};

  Object.keys(filter).forEach(function (key) {
    // key: the name of the object key

    const splitKey = key.split('@');
    const operation = splitKey.length === 2 ? splitKey[1] : defaultListOp;

    let values;
    if (operation.includes('like')) {
      // we split the search term in words
      values = filter[key].trim().split(' ');
    } else {
      values = [filter[key]];
    }

    //console.dir(splitKey);
    //console.dir(values);

    values.forEach((value) => {
      // if operator is intentionally blank, rpc syntax
      let op = operation.includes('like')
        ? `${operation}.*${value}*`
        : operation.length === 0
          ? `${value}`
          : `${operation}.${value}`;

      if (result[splitKey[0]] === undefined) {
        // first operator for the key, we add it to the dict
        result[splitKey[0]] = op;
      } else {
        if (!Array.isArray(result[splitKey[0]])) {
          // second operator, we transform to an array
          result[splitKey[0]] = [result[splitKey[0]], op];
        } else {
          // third and subsequent, we add to array
          result[splitKey[0]].push(op);
        }
      }
    });
  });

  return result;
}

// compound keys capability

const getPrimaryKey = (resource, primaryKeys) => {
  return primaryKeys.get(resource) || ['id'];
};

const decodeId = (id, primaryKey) => {
  if (isCompoundKey(primaryKey)) {
    return JSON.parse(id.toString());
  } else {
    return [id.toString()];
  }
};

const encodeId = (data, primaryKey) => {
  if (isCompoundKey(primaryKey)) {
    return JSON.stringify(primaryKey.map((key) => data[key]));
  } else {
    return data[primaryKey[0]];
  }
};

const dataWithId = (data, primaryKey) => {
  if (Array.isArray(primaryKey) && primaryKey.length === 1 && primaryKey[0] === 'id') {
    return data;
  }

  return Object.assign(data, {
    id: encodeId(data, primaryKey),
  });
};

const isCompoundKey = (primaryKey) => {
  return primaryKey.length > 1;
};

const getQuery = (primaryKey, ids, resource) => {
  if (Array.isArray(ids) && ids.length > 1) {
    // no standardized query with multiple ids possible for rpc endpoints which are api-exposed database functions
    if (resource.startsWith('rpc/')) {
      console.error(
        "PostgREST's rpc endpoints are not intended to be handled as views. Therefore, no query generation for multiple key values implemented!",
      );

      return;
    }

    if (isCompoundKey(primaryKey)) {
      return `or=(
          ${ids.map((id) => {
            const primaryKeyParams = decodeId(id, primaryKey);
            return `and(${primaryKey.map((key, i) => `${key}.eq.${primaryKeyParams[i]}`).join(',')})`;
          })}
        )`;
    } else {
      return queryString.stringify({ [primaryKey[0]]: `in.(${ids.join(',')})` });
    }
  } else {
    // if ids is one Identifier
    const id = ids.toString();
    const primaryKeyParams = decodeId(id, primaryKey);

    if (isCompoundKey(primaryKey)) {
      if (resource.startsWith('rpc/'))
        return `${primaryKey.map((key, i) => `${key}=${primaryKeyParams[i]}`).join('&')}`;
      else return `and=(${primaryKey.map((key, i) => `${key}.eq.${primaryKeyParams[i]}`).join(',')})`;
    } else {
      return queryString.stringify({ [primaryKey[0]]: `eq.${id}` });
    }
  }
};

const getKeyData = (primaryKey, data) => {
  if (isCompoundKey(primaryKey)) {
    return primaryKey.reduce(
      (keyData, key) => ({
        ...keyData,
        [key]: data[key],
      }),
      {},
    );
  } else {
    return { [primaryKey[0]]: data[primaryKey[0]] };
  }
};

const getOrderBy = (field, order, primaryKey) => {
  if (field === 'id') {
    return primaryKey.map((key) => `${key}.${order.toLowerCase()}`).join(',');
  } else {
    return `${field}.${order.toLowerCase()}`;
  }
};

const defaultPrimaryKeys = new Map();

export const postgrestDataProvider = (
  apiUrl,
  httpClient = fetchUtils.fetchJson,
  defaultListOp = 'eq',
  primaryKeys = defaultPrimaryKeys,
) => ({
  getList: async (resource, params) => {
    const primaryKey = getPrimaryKey(resource, primaryKeys);

    const { page, perPage } = params.pagination;
    const { field, order } = params.sort;
    const ftsFilter = {};
    const ftsIdx = Object.keys(params.filter).findIndex((x) => x.includes('#'));
    if (ftsIdx !== -1) {
      let ftsKey = Object.keys(params.filter)[ftsIdx];
      let ftsFields = ftsKey.split('#')[1].split('@')[0].split(',');
      let ftsFilterType = ftsKey.split('#')[1].split('@')[1];
      ftsFields.forEach((field) => {
        ftsFilter[`${field}@${ftsFilterType}`] = params.filter[ftsKey];
      });
      delete params.filter[ftsKey];
    }
    const parsedFilter = parseFilters(params.filter, defaultListOp);
    const query: Record<string, unknown> = {
      order: getOrderBy(field, order, primaryKey),
      offset: (page - 1) * perPage,
      limit: perPage,
      // append filters
      ...parsedFilter,
    };
    if (Object.keys(ftsFilter).length > 0) {
      const parsedFtsFilter = parseFilters(ftsFilter, defaultListOp);
      const orString = Object.keys(parsedFtsFilter)
        .map((field) => `${field}.${parsedFtsFilter[field]}`)
        .toString();
      query.or = `(${orString})`;
    }
    // add header that Content-Range is in returned header
    const options = {
      headers: new Headers({
        Accept: 'application/json',
        Prefer: 'count=exact',
      }),
    };

    const url = `${apiUrl}/${resource}?${queryString.stringify(query)}`;

    return httpClient(url, options).then(({ headers, json }) => {
      if (!headers.has('content-range')) {
        throw new Error(
          `The Content-Range header is missing in the HTTP Response. The postgREST data provider expects 
          responses for lists of resources to contain this header with the total number of results to build 
          the pagination. If you are using CORS, did you declare Content-Range in the Access-Control-Expose-Headers header?`,
        );
      }
      const contentRange = headers.get('content-range');
      if (!contentRange) {
        throw new Error('Missing content-range header in response');
      }

      return {
        data: json.map((obj) => dataWithId(obj, primaryKey)),
        total: parseInt(contentRange.split('/').pop() ?? '0', 10),
      };
    });
  },

  getOne: (resource, params) => {
    const id = params.id;
    const primaryKey = getPrimaryKey(resource, primaryKeys);

    const query = getQuery(primaryKey, id, resource);

    const url = `${apiUrl}/${resource}?${query}`;

    return httpClient(url, {
      headers: new Headers({ accept: 'application/vnd.pgrst.object+json' }),
    }).then(({ json }) => ({
      data: dataWithId(json, primaryKey),
    }));
  },

  getMany: (resource, params) => {
    const ids = params.ids;
    const primaryKey = getPrimaryKey(resource, primaryKeys);

    const query = getQuery(primaryKey, ids, resource);

    const url = `${apiUrl}/${resource}?${query}`;

    return httpClient(url).then(({ json }) => ({ data: json.map((data) => dataWithId(data, primaryKey)) }));
  },

  getManyReference: (resource, params) => {
    const { page, perPage } = params.pagination;
    const { field, order } = params.sort;
    const parsedFilter = parseFilters(params.filter, defaultListOp);
    const primaryKey = getPrimaryKey(resource, primaryKeys);

    const query = params.target
      ? {
          [params.target]: `eq.${params.id}`,
          order: getOrderBy(field, order, primaryKey),
          offset: (page - 1) * perPage,
          limit: perPage,
          ...parsedFilter,
        }
      : {
          order: getOrderBy(field, order, primaryKey),
          offset: (page - 1) * perPage,
          limit: perPage,
          ...parsedFilter,
        };

    // add header that Content-Range is in returned header
    const options = {
      headers: new Headers({
        Accept: 'application/json',
        Prefer: 'count=exact',
      }),
    };

    const url = `${apiUrl}/${resource}?${queryString.stringify(query)}`;

    return httpClient(url, options).then(({ headers, json }) => {
      if (!headers.has('content-range')) {
        throw new Error(
          `The Content-Range header is missing in the HTTP Response. The postgREST data provider expects 
          responses for lists of resources to contain this header with the total number of results to build 
          the pagination. If you are using CORS, did you declare Content-Range in the Access-Control-Expose-Headers header?`,
        );
      }
      const contentRange = headers.get('content-range');
      if (!contentRange) {
        throw new Error('Missing content-range header in response');
      }

      return {
        data: json.map((data) => dataWithId(data, primaryKey)),
        total: parseInt(contentRange.split('/').pop() ?? '0', 10),
      };
    });
  },

  update: (resource, params) => {
    const { id, data } = params;
    const primaryKey = getPrimaryKey(resource, primaryKeys);

    const query = getQuery(primaryKey, id, resource);

    const primaryKeyData = getKeyData(primaryKey, data);

    const url = `${apiUrl}/${resource}?${query}`;

    const body = JSON.stringify({
      ...data,
      ...primaryKeyData,
    });

    return httpClient(url, {
      method: 'PATCH',
      headers: new Headers({
        'Accept': 'application/vnd.pgrst.object+json',
        'Prefer': 'return=representation',
        'Content-Type': 'application/json',
      }),
      body,
    }).then(({ json }) => ({ data: dataWithId(json, primaryKey) }));
  },

  updateMany: (resource, params) => {
    const ids = params.ids;
    const primaryKey = getPrimaryKey(resource, primaryKeys);

    const query = getQuery(primaryKey, ids, resource);

    const body = JSON.stringify(
      params.data.map((obj) => {
        const { id, ...data } = obj;
        const primaryKeyData = getKeyData(primaryKey, data);

        return {
          ...data,
          ...primaryKeyData,
        };
      }),
    );

    const url = `${apiUrl}/${resource}?${query}`;

    return httpClient(url, {
      method: 'PATCH',
      headers: new Headers({
        'Prefer': 'return=representation',
        'Content-Type': 'application/json',
      }),
      body,
    }).then(({ json }) => ({
      data: json.map((data) => encodeId(data, primaryKey)),
    }));
  },

  create: (resource, params) => {
    const primaryKey = getPrimaryKey(resource, primaryKeys);

    const url = `${apiUrl}/${resource}`;

    return httpClient(url, {
      method: 'POST',
      headers: new Headers({
        'Accept': 'application/vnd.pgrst.object+json',
        'Prefer': 'return=representation',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify(params.data),
    }).then(({ json }) => ({
      data: {
        ...params.data,
        id: encodeId(json, primaryKey),
      },
    }));
  },

  delete: (resource, params) => {
    const id = params.id;
    const primaryKey = getPrimaryKey(resource, primaryKeys);

    const query = getQuery(primaryKey, id, resource);

    const url = `${apiUrl}/${resource}?${query}`;

    return httpClient(url, {
      method: 'DELETE',
      headers: new Headers({
        'Accept': 'application/vnd.pgrst.object+json',
        'Prefer': 'return=representation',
        'Content-Type': 'application/json',
      }),
    }).then(({ json }) => ({ data: dataWithId(json, primaryKey) }));
  },

  deleteMany: (resource, params) => {
    const ids = params.ids;
    const primaryKey = getPrimaryKey(resource, primaryKeys);

    const query = getQuery(primaryKey, ids, resource);

    const url = `${apiUrl}/${resource}?${query}`;

    return httpClient(url, {
      method: 'DELETE',
      headers: new Headers({
        'Prefer': 'return=representation',
        'Content-Type': 'application/json',
      }),
    }).then(({ json }) => ({ data: json.map((data) => encodeId(data, primaryKey)) }));
  },
});

export default postgrestDataProvider;
