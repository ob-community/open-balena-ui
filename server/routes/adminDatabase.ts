import { json, Router, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import base32Encode from 'base32-encode';
import {
  type AccessContext,
  authorizeAdministratorRoleCreation,
  authorizeCredentialActorProvision,
  authorizeMutationBody,
  authorizePasswordChange,
  authorizePreActivationAssignment,
  authorizeProtectedRoleMutation,
  authorizeResource,
  authorizeScopedMutation,
  authorizeSelfLockoutMutation,
  buildAccessContext,
  queryReferencesCredential,
  queryUsesUnsafeEmbedding,
  redactSecrets,
} from '../accessControl';
import authorize, { type AuthorizedLocals } from '../middleware/authorize';
import dosProtect from '../middleware/dosProtect';
import { hashPassword } from '../../src/lib/password';
import { isValidPassword } from '../../src/lib/passwordPolicy';
import versions from '../../src/versions';

const router = Router();
router.use(json());

class UpstreamRequestError extends Error {}

const getPostgrestUrl = (): string => {
  const value = process.env.OPEN_BALENA_POSTGREST_URL;
  if (!value) {
    throw new Error('OPEN_BALENA_POSTGREST_URL must be configured.');
  }
  return value.replace(/\/+$/, '');
};

const getOpenBalenaApiUrl = (): string => {
  const value = process.env.REACT_APP_OPEN_BALENA_API_URL;
  if (!value) {
    throw new Error('REACT_APP_OPEN_BALENA_API_URL must be configured.');
  }
  return value.replace(/\/+$/, '');
};

const getODataVersion = (): string => {
  const override = process.env.REACT_APP_OPEN_BALENA_ODATA_VERSION;
  if (override) {
    const normalized = override.startsWith('v') ? override : `v${override}`;
    if (!['v6', 'v7'].includes(normalized)) {
      throw new Error('REACT_APP_OPEN_BALENA_ODATA_VERSION must be v6 or v7.');
    }
    return normalized;
  }
  return versions.odataVersion(process.env.REACT_APP_OPEN_BALENA_API_VERSION);
};

const toApiField = (field: string): string => field.replace(/-/g, '__').replace(/ /g, '_');
const fromApiField = (field: string): string => field.replace(/__/g, '-').replace(/_/g, ' ');

const transformToOData = (input: unknown): unknown => {
  if (Array.isArray(input)) {
    return input.map(transformToOData);
  }
  if (!input || typeof input !== 'object') {
    return input;
  }
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>)
      .filter(([key, value]) => value !== undefined && key !== 'id')
      .map(([key, value]) => [toApiField(key), transformToOData(value)]),
  );
};

const transformFromOData = (input: unknown): unknown => {
  if (Array.isArray(input)) {
    return input.map(transformFromOData);
  }
  if (!input || typeof input !== 'object') {
    return input;
  }
  const record = input as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => !key.startsWith('@odata.') && !['__metadata', '__deferred', '__count'].includes(key))
      .map(([key, value]) => {
        const transformedValue =
          value && typeof value === 'object' && !Array.isArray(value) && '__id' in value
            ? Object.keys(value).length === 1
              ? (value as Record<string, unknown>).__id
              : transformFromOData(value)
            : transformFromOData(value);
        return [fromApiField(key), transformedValue];
      }),
  );
};

const extractODataRecord = (body: unknown): Record<string, unknown> | undefined => {
  if (!body || typeof body !== 'object') {
    return undefined;
  }
  if ('id' in body) {
    return body as Record<string, unknown>;
  }
  if ('d' in body) {
    const data = (body as { d: unknown }).d;
    if (Array.isArray(data)) {
      return data[0] as Record<string, unknown> | undefined;
    }
    if (data && typeof data === 'object' && 'results' in data) {
      return (data as { results: Array<Record<string, unknown>> }).results[0];
    }
    return data as Record<string, unknown>;
  }
  if ('value' in body) {
    const value = (body as { value: unknown }).value;
    return (Array.isArray(value) ? value[0] : value) as Record<string, unknown> | undefined;
  }
  return body as Record<string, unknown>;
};

export const requestHeaders = (authorization: string, headers?: HeadersInit): Headers => {
  const result = new Headers(headers);
  result.set('Authorization', authorization);
  if (!result.has('Accept')) {
    result.set('Accept', 'application/json');
  }
  return result;
};

export const preferUsesUpsert = (prefer: string | undefined): boolean => /\bresolution\s*=/i.test(prefer ?? '');

export const bodyContainsUserCredentials = (body: unknown): boolean =>
  (Array.isArray(body) ? body : [body]).some(
    (record) =>
      record != null &&
      typeof record === 'object' &&
      ('password' in record || 'jwt secret' in record || 'jwt_secret' in record),
  );

export const databaseReader = (authorization: string) => ({
  list: async (resource: string, query = new URLSearchParams()) => {
    const response = await fetch(`${getPostgrestUrl()}/${encodeURIComponent(resource)}?${query}`, {
      headers: requestHeaders(authorization),
    });
    if (!response.ok) {
      throw new UpstreamRequestError(`Unable to resolve administrator access (${response.status}).`);
    }
    const text = await response.text();
    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(text);
    } catch {
      throw new UpstreamRequestError(
        'PostgREST returned a non-JSON response. Verify OPEN_BALENA_POSTGREST_URL points directly to PostgREST.',
      );
    }
    if (!Array.isArray(jsonBody)) {
      throw new UpstreamRequestError('Administrator access lookup returned an invalid response.');
    }
    return jsonBody as Array<Record<string, unknown>>;
  },
});

const appendScope = (url: URL, allowedIds: Set<number>): void => {
  const scope = `in.(${[...allowedIds].join(',')})`;
  const existing = url.searchParams.get('id');
  if (existing && existing !== scope) {
    url.searchParams.append('id', scope);
  } else {
    url.searchParams.set('id', scope);
  }
};

const sendDenied = (res: Response, error: unknown): void => {
  const message = error instanceof Error ? error.message : 'Direct database request denied.';
  const upstreamFailure = error instanceof UpstreamRequestError;
  res.status(message.includes('configured') ? 500 : upstreamFailure ? 502 : 403).json({
    code: upstreamFailure ? 'ADMIN_DB_UPSTREAM_ERROR' : 'ADMIN_DB_FORBIDDEN',
    message,
  });
};

const requireObjectBody = (body: unknown, operation: string): Record<string, unknown> => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error(`${operation} requires an object body.`);
  }
  return body as Record<string, unknown>;
};

const requirePositiveId = (value: unknown, field: string): number => {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`${field} must be a positive numeric ID.`);
  }
  return id;
};

const requirePositiveIds = (value: unknown, field: string): number[] => {
  if (!Array.isArray(value) || value.length === 0 || value.length > 1000) {
    throw new Error(`${field} must contain between 1 and 1000 IDs.`);
  }
  const ids = value.map((item) => requirePositiveId(item, field));
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${field} must not contain duplicate IDs.`);
  }
  return ids;
};

router.get('/admin-db/actions/access-context', ...dosProtect, authorize, async (req, res) => {
  try {
    const authorization = req.headers.authorization!;
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    res.json({
      enforcementEnabled: context.enforcementEnabled,
      globalAdmin: context.globalAdmin,
      organizationAdmin: context.organizationAdmin,
      userId: context.userId,
      username: context.username,
    });
  } catch (error) {
    sendDenied(res, error);
  }
});

router.post('/admin-db/actions/change-password', ...dosProtect, authorize, async (req, res) => {
  try {
    const authorization = req.headers.authorization!;
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    const targetUserId = Number(req.body?.userId);
    const password = req.body?.password;
    if (!Number.isInteger(targetUserId) || targetUserId <= 0 || !isValidPassword(password)) {
      throw new Error('A valid target user and password meeting the password policy are required.');
    }
    authorizePasswordChange(context, targetUserId);
    const targetUsers = await databaseReader(authorization).list(
      'user',
      new URLSearchParams({ id: `eq.${targetUserId}` }),
    );
    if (targetUsers.length !== 1) {
      throw new Error('The target user does not exist.');
    }
    const upstream = await fetch(`${getPostgrestUrl()}/${encodeURIComponent('user')}?id=eq.${targetUserId}`, {
      method: 'PATCH',
      headers: requestHeaders(authorization, {
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      }),
      body: JSON.stringify({ password: hashPassword(password) }),
    });
    if (!upstream.ok) {
      throw new UpstreamRequestError(`Unable to change the password (${upstream.status}).`);
    }
    res.status(204).end();
  } catch (error) {
    sendDenied(res, error);
  }
});

const createRecord = async (
  authorization: string,
  resource: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const response = await fetch(`${getPostgrestUrl()}/${encodeURIComponent(resource)}`, {
    method: 'POST',
    headers: requestHeaders(authorization, {
      'Accept': 'application/vnd.pgrst.object+json',
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    }),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new UpstreamRequestError(`Unable to create ${resource} (${response.status}).`);
  }
  const record = (await response.json()) as Record<string, unknown>;
  const id = Number(record.id);
  if (!Number.isInteger(id) || id <= 0) {
    throw new UpstreamRequestError(`Creating ${resource} returned an invalid ID.`);
  }
  return record;
};

const deleteApiKeyRecord = async (authorization: string, apiKeyId: number): Promise<void> => {
  const mappingQuery = new URLSearchParams({ 'api key': `eq.${apiKeyId}` });
  for (const resource of ['api key-has-permission', 'api key-has-role']) {
    const mappingResponse = await fetch(`${getPostgrestUrl()}/${encodeURIComponent(resource)}?${mappingQuery}`, {
      method: 'DELETE',
      headers: requestHeaders(authorization),
    });
    if (!mappingResponse.ok) {
      throw new UpstreamRequestError(`Unable to clean up ${resource} records (${mappingResponse.status}).`);
    }
  }
  const apiKeyResponse = await fetch(`${getPostgrestUrl()}/${encodeURIComponent('api key')}?id=eq.${apiKeyId}`, {
    method: 'DELETE',
    headers: requestHeaders(authorization),
  });
  if (!apiKeyResponse.ok) {
    throw new UpstreamRequestError(`Unable to delete the API key (${apiKeyResponse.status}).`);
  }
};

const deleteApiKeyRecords = async (authorization: string, apiKeyIds: number[]): Promise<void> => {
  const ids = `in.(${apiKeyIds.join(',')})`;
  const mappingQuery = new URLSearchParams({ 'api key': ids });
  for (const resource of ['api key-has-permission', 'api key-has-role']) {
    const mappingResponse = await fetch(`${getPostgrestUrl()}/${encodeURIComponent(resource)}?${mappingQuery}`, {
      method: 'DELETE',
      headers: requestHeaders(authorization),
    });
    if (!mappingResponse.ok) {
      throw new UpstreamRequestError(`Unable to clean up ${resource} records (${mappingResponse.status}).`);
    }
  }
  const apiKeyResponse = await fetch(
    `${getPostgrestUrl()}/${encodeURIComponent('api key')}?${new URLSearchParams({ id: ids })}`,
    {
      method: 'DELETE',
      headers: requestHeaders(authorization),
    },
  );
  if (!apiKeyResponse.ok) {
    throw new UpstreamRequestError(`Unable to delete the API keys (${apiKeyResponse.status}).`);
  }
};

const deleteCredentialActor = async (
  authorization: string,
  actorId: number | undefined,
  apiKeyId: number | undefined,
): Promise<void> => {
  if (apiKeyId != null) {
    await deleteApiKeyRecord(authorization, apiKeyId);
  }
  if (actorId != null) {
    const actorResponse = await fetch(`${getPostgrestUrl()}/${encodeURIComponent('actor')}?id=eq.${actorId}`, {
      method: 'DELETE',
      headers: requestHeaders(authorization),
    });
    if (!actorResponse.ok) {
      throw new UpstreamRequestError(`Unable to clean up the credential actor (${actorResponse.status}).`);
    }
  }
};

const provisionCredentialActor = async (
  authorization: string,
  role: string,
): Promise<{ actorId: number; apiKeyId: number }> => {
  const roles = await databaseReader(authorization).list('role', new URLSearchParams({ name: `eq.${role}` }));
  const roleId = Number(roles[0]?.id);
  if (roles.length !== 1 || !Number.isInteger(roleId) || roleId <= 0) {
    throw new Error(`The required ${role} role does not exist.`);
  }
  let actorId: number | undefined;
  let apiKeyId: number | undefined;
  try {
    actorId = Number((await createRecord(authorization, 'actor', {})).id);
    apiKeyId = Number(
      (
        await createRecord(authorization, 'api key', {
          'key': randomBytes(32).toString('base64url'),
          'is of-actor': actorId,
        })
      ).id,
    );
    const assignment = await fetch(`${getPostgrestUrl()}/${encodeURIComponent('api key-has-role')}`, {
      method: 'POST',
      headers: requestHeaders(authorization, {
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      }),
      body: JSON.stringify({ 'api key': apiKeyId, 'role': roleId }),
    });
    if (!assignment.ok) {
      throw new UpstreamRequestError(`Unable to assign the credential role (${assignment.status}).`);
    }
    return { actorId, apiKeyId };
  } catch (error) {
    await deleteCredentialActor(authorization, actorId, apiKeyId);
    throw error;
  }
};

router.post('/admin-db/actions/create-user', ...dosProtect, authorize, async (req, res) => {
  let actorId: number | undefined;
  let apiKeyId: number | undefined;
  try {
    const authorization = req.headers.authorization!;
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    authorizeCredentialActorProvision(context);
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      throw new Error('User creation requires an object body.');
    }
    const { username, email, password, ...unexpected } = req.body as Record<string, unknown>;
    if (
      typeof username !== 'string' ||
      !username.trim() ||
      typeof email !== 'string' ||
      !email.trim() ||
      !isValidPassword(password) ||
      Object.keys(unexpected).length
    ) {
      throw new Error('A username, email, and password meeting the password policy are required.');
    }
    ({ actorId, apiKeyId } = await provisionCredentialActor(authorization, 'named-user-api-key'));
    const user = await createRecord(authorization, 'user', {
      'actor': actorId,
      'email': email.trim(),
      'username': username.trim(),
      'password': hashPassword(password),
      'jwt secret': base32Encode(randomBytes(20), 'RFC3548').toString(),
    });
    res.status(201).json(redactSecrets('user', user, context));
  } catch (error) {
    if (actorId != null || apiKeyId != null) {
      await deleteCredentialActor(req.headers.authorization!, actorId, apiKeyId);
    }
    sendDenied(res, error);
  }
});

router.post('/admin-db/actions/create-api-key', ...dosProtect, authorize, async (req, res) => {
  try {
    const authorization = req.headers.authorization!;
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    const body = requireObjectBody(req.body, 'API key creation');
    const { 'is of-actor': actor, name, description, ...unexpected } = body;
    if (
      !Number.isInteger(Number(actor)) ||
      Number(actor) <= 0 ||
      typeof name !== 'string' ||
      !name.trim() ||
      (description != null && typeof description !== 'string') ||
      Object.keys(unexpected).length
    ) {
      throw new Error('API key creation requires an actor and name.');
    }
    authorizeResource(context, 'api key', 'POST');
    authorizeMutationBody(context, 'api key', 'POST', { 'is of-actor': Number(actor) });
    const record = await createRecord(authorization, 'api key', {
      'is of-actor': Number(actor),
      'key': randomBytes(32).toString('base64url'),
      'name': name.trim(),
      ...(description ? { description } : {}),
    });
    res.status(201).json(redactSecrets('api key', record, context));
  } catch (error) {
    sendDenied(res, error);
  }
});

router.post('/admin-db/actions/delete-api-key', ...dosProtect, authorize, async (req, res) => {
  try {
    const authorization = req.headers.authorization!;
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    const apiKeyId = Number(req.body?.id);
    if (!Number.isInteger(apiKeyId) || apiKeyId <= 0) {
      throw new Error('API key deletion requires a valid ID.');
    }
    const allowedIds = authorizeResource(context, 'api key', 'DELETE');
    if (allowedIds && !allowedIds.has(apiKeyId)) {
      throw new Error('The API key is outside the administrator scope.');
    }
    await deleteApiKeyRecord(authorization, apiKeyId);
    res.json({ id: apiKeyId });
  } catch (error) {
    sendDenied(res, error);
  }
});

router.post('/admin-db/actions/delete-api-keys', ...dosProtect, authorize, async (req, res) => {
  try {
    const authorization = req.headers.authorization!;
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    const apiKeyIds = requirePositiveIds(req.body?.ids, 'API key deletion');
    const allowedIds = authorizeResource(context, 'api key', 'DELETE');
    const existingKeys = await databaseReader(authorization).list(
      'api key',
      new URLSearchParams({ id: `in.(${apiKeyIds.join(',')})` }),
    );
    if (existingKeys.length === 0) {
      res.json({ ids: apiKeyIds });
      return;
    }
    if (
      existingKeys.length !== apiKeyIds.length ||
      (allowedIds && existingKeys.some((record) => !allowedIds.has(Number(record.id))))
    ) {
      throw new Error('At least one API key does not exist or is outside the administrator scope.');
    }
    await deleteApiKeyRecords(authorization, apiKeyIds);
    res.json({ ids: apiKeyIds });
  } catch (error) {
    sendDenied(res, error);
  }
});

type ActorResource = 'application' | 'device' | 'user';

const parseResourceActorDeletion = (body: unknown): { resource: ActorResource; id: number; actorId: number } => {
  const request = requireObjectBody(body, 'Resource deletion');
  const resource = String(request.resource);
  if (!['application', 'device', 'user'].includes(resource)) {
    throw new Error('Only application, device, and user actor cleanup is supported.');
  }
  return {
    resource: resource as ActorResource,
    id: requirePositiveId(request.id, 'Resource ID'),
    actorId: requirePositiveId(request.actorId, 'Actor ID'),
  };
};

const authorizeExistingResourceActorDeletion = (
  context: AccessContext,
  resource: ActorResource,
  id: number,
  actorId: number,
  records: Array<Record<string, unknown>>,
): Record<string, unknown> => {
  const record = records[0];
  if (records.length !== 1 || Number(record?.actor) !== actorId) {
    throw new Error('The resource does not exist or does not belong to the supplied actor.');
  }
  if (resource === 'user') {
    const allowedIds = authorizeResource(context, 'user', 'DELETE');
    if (allowedIds && !allowedIds.has(id)) {
      throw new Error('The user is outside the administrator scope.');
    }
    authorizeSelfLockoutMutation(context, 'user', 'DELETE', { id: `eq.${id}` });
  } else if (
    context.enforcementEnabled &&
    !context.globalAdmin &&
    (!context.organizationAdmin ||
      (resource === 'application'
        ? !context.allowedApplicationIds.has(id)
        : !context.allowedApplicationIds.has(Number(record['belongs to-application']))))
  ) {
    throw new Error(`The ${resource} is outside the administrator scope.`);
  }
  return record;
};

const deleteActorApiKeys = async (authorization: string, actorId: number): Promise<void> => {
  const actorKeys = await databaseReader(authorization).list(
    'api key',
    new URLSearchParams({ 'is of-actor': `eq.${actorId}` }),
  );
  const actorKeyIds = actorKeys.map((actorKey) => requirePositiveId(actorKey.id, 'API key ID'));
  if (actorKeyIds.length > 0) {
    await deleteApiKeyRecords(authorization, actorKeyIds);
  }
};

const USER_RELATION_RESOURCES = [
  'user-has-direct access to-application',
  'user-has-permission',
  'user-has-public key',
  'user-has-role',
  'organization membership',
] as const;

type DeletedUserRelations = Array<{
  resource: (typeof USER_RELATION_RESOURCES)[number];
  records: Array<Record<string, unknown>>;
}>;

const restoreUserRelations = async (authorization: string, deletedRelations: DeletedUserRelations): Promise<void> => {
  for (const { resource, records } of [...deletedRelations].reverse()) {
    if (records.length === 0) {
      continue;
    }
    const response = await fetch(`${getPostgrestUrl()}/${encodeURIComponent(resource)}`, {
      method: 'POST',
      headers: requestHeaders(authorization, {
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      }),
      body: JSON.stringify(records),
    });
    if (!response.ok) {
      throw new UpstreamRequestError(`Unable to restore ${resource} records (${response.status}).`);
    }
  }
};

const deleteUserRelations = async (authorization: string, userId: number): Promise<DeletedUserRelations> => {
  const deletedRelations: DeletedUserRelations = [];
  const userQuery = new URLSearchParams({ user: `eq.${userId}` });
  try {
    for (const resource of USER_RELATION_RESOURCES) {
      const records = await databaseReader(authorization).list(resource, userQuery);
      if (records.length === 0) {
        continue;
      }
      const response = await fetch(`${getPostgrestUrl()}/${encodeURIComponent(resource)}?${userQuery}`, {
        method: 'DELETE',
        headers: requestHeaders(authorization),
      });
      if (!response.ok) {
        throw new UpstreamRequestError(`Unable to clean up ${resource} records (${response.status}).`);
      }
      deletedRelations.push({ resource, records });
    }
    return deletedRelations;
  } catch (error) {
    await restoreUserRelations(authorization, deletedRelations);
    throw error;
  }
};

router.post('/admin-db/actions/authorize-resource-actor-deletion', ...dosProtect, authorize, async (req, res) => {
  try {
    const authorization = req.headers.authorization!;
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    const { resource, id, actorId } = parseResourceActorDeletion(req.body);
    const records = await databaseReader(authorization).list(resource, new URLSearchParams({ id: `eq.${id}` }));
    authorizeExistingResourceActorDeletion(context, resource, id, actorId, records);
    res.status(204).end();
  } catch (error) {
    sendDenied(res, error);
  }
});

router.post('/admin-db/actions/authorize-resource-actor-deletions', ...dosProtect, authorize, async (req, res) => {
  try {
    const authorization = req.headers.authorization!;
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    const body = requireObjectBody(req.body, 'Bulk resource deletion');
    if (!Array.isArray(body.records) || body.records.length === 0 || body.records.length > 1000) {
      throw new Error('Bulk resource deletion requires between 1 and 1000 records.');
    }
    const requests = body.records.map(parseResourceActorDeletion);
    for (const { resource, id, actorId } of requests) {
      const records = await databaseReader(authorization).list(resource, new URLSearchParams({ id: `eq.${id}` }));
      authorizeExistingResourceActorDeletion(context, resource, id, actorId, records);
    }
    res.status(204).end();
  } catch (error) {
    sendDenied(res, error);
  }
});

router.post('/admin-db/actions/delete-resource-actor', ...dosProtect, authorize, async (req, res) => {
  try {
    const authorization = req.headers.authorization!;
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    const { resource, id, actorId } = parseResourceActorDeletion(req.body);

    const records = await databaseReader(authorization).list(resource, new URLSearchParams({ id: `eq.${id}` }));
    if (records.length === 0) {
      if (context.enforcementEnabled && !context.globalAdmin) {
        throw new Error('Global administrator access is required to retry orphaned actor cleanup.');
      }
      for (const referencingResource of ['application', 'device', 'user']) {
        const references = await databaseReader(authorization).list(
          referencingResource,
          new URLSearchParams({ actor: `eq.${actorId}` }),
        );
        if (references.length > 0) {
          throw new Error('The actor is still referenced and cannot be cleaned up as an orphan.');
        }
      }
      await deleteActorApiKeys(authorization, actorId);
      const actorResponse = await fetch(`${getPostgrestUrl()}/${encodeURIComponent('actor')}?id=eq.${actorId}`, {
        method: 'DELETE',
        headers: requestHeaders(authorization),
      });
      if (!actorResponse.ok) {
        throw new UpstreamRequestError(`Unable to delete the orphaned ${resource} actor (${actorResponse.status}).`);
      }
      res.json({ id });
      return;
    }
    authorizeExistingResourceActorDeletion(context, resource, id, actorId, records);

    const deletedUserRelations = resource === 'user' ? await deleteUserRelations(authorization, id) : [];

    const parentUrl =
      resource === 'user'
        ? `${getPostgrestUrl()}/${encodeURIComponent(resource)}?id=eq.${id}`
        : `${getOpenBalenaApiUrl()}/${getODataVersion()}/${resource}(${id})`;
    let parentResponse: globalThis.Response;
    try {
      parentResponse = await fetch(parentUrl, {
        method: 'DELETE',
        headers: requestHeaders(authorization, { Accept: 'application/json' }),
      });
    } catch {
      await restoreUserRelations(authorization, deletedUserRelations);
      throw new UpstreamRequestError(`Unable to delete ${resource}.`);
    }
    if (!parentResponse.ok) {
      await restoreUserRelations(authorization, deletedUserRelations);
      throw new UpstreamRequestError(`Unable to delete ${resource} (${parentResponse.status}).`);
    }

    await deleteActorApiKeys(authorization, actorId);
    const actorResponse = await fetch(`${getPostgrestUrl()}/${encodeURIComponent('actor')}?id=eq.${actorId}`, {
      method: 'DELETE',
      headers: requestHeaders(authorization),
    });
    if (!actorResponse.ok) {
      throw new UpstreamRequestError(`Unable to delete the ${resource} actor (${actorResponse.status}).`);
    }
    res.json({ id });
  } catch (error) {
    sendDenied(res, error);
  }
});

router.post('/admin-db/actions/create-operational-resource', ...dosProtect, authorize, async (req, res) => {
  let actorId: number | undefined;
  let apiKeyId: number | undefined;
  let operationalRecordCreated = false;
  try {
    const authorization = req.headers.authorization!;
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    authorizeCredentialActorProvision(context);
    const body = requireObjectBody(req.body, 'Operational resource creation');
    const resource = body.resource;
    const data = requireObjectBody(body.data, 'Operational resource creation data');
    if (!['application', 'device'].includes(String(resource)) || 'actor' in data) {
      throw new Error('Only application and device creation without a caller-supplied actor is supported.');
    }
    const role = resource === 'device' ? 'device-api-key' : 'provisioning-api-key';
    ({ actorId, apiKeyId } = await provisionCredentialActor(authorization, role));
    const upstream = await fetch(`${getOpenBalenaApiUrl()}/${getODataVersion()}/${resource}`, {
      method: 'POST',
      headers: requestHeaders(authorization, {
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      }),
      body: JSON.stringify(transformToOData({ ...data, actor: actorId })),
    });
    if (!upstream.ok) {
      throw new UpstreamRequestError(`Unable to create ${resource} (${upstream.status}).`);
    }
    operationalRecordCreated = true;
    const record = transformFromOData(extractODataRecord((await upstream.json()) as unknown) ?? {}) as Record<
      string,
      unknown
    >;
    if (!Number.isInteger(Number(record.id)) || Number(record.id) <= 0) {
      throw new UpstreamRequestError(`Creating ${resource} returned an invalid record.`);
    }
    res.status(201).json(record);
  } catch (error) {
    if (!operationalRecordCreated && (actorId != null || apiKeyId != null)) {
      await deleteCredentialActor(req.headers.authorization!, actorId, apiKeyId);
    }
    sendDenied(res, error);
  }
});

router.all('/admin-db/:resource', ...dosProtect, authorize, async (req, res) => {
  try {
    const authorization = req.headers.authorization!;
    const resource = decodeURIComponent(req.params.resource);
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    const allowedIds = authorizeResource(context, resource, req.method);
    authorizeScopedMutation(allowedIds, resource, req.method, req.query);
    authorizeMutationBody(context, resource, req.method, req.body);
    authorizePreActivationAssignment(context, resource, req.method, req.body);
    authorizeProtectedRoleMutation(context, resource, req.method, req.body, req.query);
    authorizeSelfLockoutMutation(context, resource, req.method, req.query);
    authorizeAdministratorRoleCreation(context, resource, req.method, req.body);
    if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
      throw new Error('Unsupported direct database method.');
    }
    if (queryUsesUnsafeEmbedding(req.query)) {
      throw new Error('Client-controlled projections and relationship embedding are not allowed.');
    }
    if (queryReferencesCredential(resource, req.query)) {
      throw new Error('Credential fields cannot be queried through administrator access.');
    }
    if (preferUsesUpsert(req.get('Prefer'))) {
      throw new Error('PostgREST upsert preferences are not allowed through administrator access.');
    }
    if (['POST', 'PATCH', 'PUT'].includes(req.method) && resource === 'user' && bodyContainsUserCredentials(req.body)) {
      throw new Error('Use the dedicated password or credential rotation action.');
    }
    if (req.method === 'POST' && resource === 'api key') {
      throw new Error('Use the dedicated API key creation action.');
    }
    if (req.method === 'DELETE' && resource === 'api key') {
      throw new Error('Use the dedicated API key deletion action.');
    }
    if (['PATCH', 'PUT'].includes(req.method) && resource === 'api key' && req.body && 'key' in req.body) {
      throw new Error('API key material cannot be changed through direct database access.');
    }
    const upstreamUrl = new URL(`${getPostgrestUrl()}/${encodeURIComponent(resource)}`);
    for (const [key, value] of Object.entries(req.query)) {
      const values = Array.isArray(value) ? value : [value];
      for (const entry of values) {
        if (typeof entry === 'string') {
          upstreamUrl.searchParams.append(key, entry);
        }
      }
    }
    if (allowedIds && req.method !== 'POST') {
      appendScope(upstreamUrl, allowedIds);
    }

    const headers = requestHeaders(authorization, {
      'Content-Type': req.get('Content-Type') ?? 'application/json',
      'Prefer': req.get('Prefer') ?? '',
      'Accept': req.get('Accept') ?? 'application/json',
    });
    const upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body),
    });
    const text = await upstream.text();
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) {
      res.set('Content-Range', contentRange);
    }
    res.status(upstream.status);
    if (!text) {
      res.end();
      return;
    }

    let jsonBody: unknown;
    try {
      jsonBody = JSON.parse(text);
    } catch {
      throw new UpstreamRequestError(
        'PostgREST returned a non-JSON response. Verify OPEN_BALENA_POSTGREST_URL points directly to PostgREST.',
      );
    }
    const body = redactSecrets(resource, jsonBody, context);
    res.json(body);
  } catch (error) {
    sendDenied(res, error);
  }
});

export default router;
