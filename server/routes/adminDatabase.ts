import { json, Router, type Response } from 'express';
import { randomBytes } from 'node:crypto';
import {
  authorizeAdministratorRoleCreation,
  authorizeCredentialActorProvision,
  authorizeMutationBody,
  authorizePasswordChange,
  authorizePreActivationAssignment,
  authorizeProtectedRoleMutation,
  authorizeResource,
  authorizeSelfLockoutMutation,
  buildAccessContext,
  queryReferencesCredential,
  queryUsesUnsafeEmbedding,
  redactSecrets,
} from '../accessControl';
import authorize, { type AuthorizedLocals } from '../middleware/authorize';
import dosProtect from '../middleware/dosProtect';
import { hashPassword } from '../../src/lib/password';

const router = Router();
router.use(json());

class UpstreamRequestError extends Error {}

const getPostgrestUrl = (): string => {
  const value = process.env.OPEN_BALENA_POSTGREST_URL ?? process.env.REACT_APP_OPEN_BALENA_POSTGREST_URL;
  if (!value) {
    throw new Error('OPEN_BALENA_POSTGREST_URL must be configured.');
  }
  return value.replace(/\/+$/, '');
};

export const requestHeaders = (authorization: string, headers?: HeadersInit): Headers => {
  const result = new Headers(headers);
  result.set('Authorization', authorization);
  if (!result.has('Accept')) {
    result.set('Accept', 'application/json');
  }
  return result;
};

const databaseReader = (authorization: string) => ({
  list: async (resource: string, query = new URLSearchParams()) => {
    const response = await fetch(`${getPostgrestUrl()}/${encodeURIComponent(resource)}?${query}`, {
      headers: requestHeaders(authorization),
    });
    if (!response.ok) {
      throw new Error(`Unable to resolve administrator access (${response.status}).`);
    }
    const jsonBody: unknown = await response.json();
    if (!Array.isArray(jsonBody)) {
      throw new Error('Administrator access lookup returned an invalid response.');
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

router.post('/admin-db/actions/change-password', ...dosProtect, authorize, async (req, res) => {
  try {
    const authorization = req.headers.authorization!;
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    const targetUserId = Number(req.body?.userId);
    const password = req.body?.password;
    if (
      !Number.isInteger(targetUserId) ||
      targetUserId <= 0 ||
      typeof password !== 'string' ||
      password.length < 8 ||
      password.length > 1024 ||
      !/[a-z]/.test(password) ||
      !/[A-Z]/.test(password) ||
      !/\d/.test(password) ||
      !/[^A-Za-z0-9]/.test(password)
    ) {
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

router.post('/admin-db/actions/provision-credential-actor', ...dosProtect, authorize, async (req, res) => {
  try {
    const authorization = req.headers.authorization!;
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    authorizeCredentialActorProvision(context);
    const role = req.body?.role;
    if (!['named-user-api-key', 'device-api-key', 'provisioning-api-key'].includes(role)) {
      throw new Error('A supported credential actor role is required.');
    }
    const roles = await databaseReader(authorization).list(
      'role',
      new URLSearchParams({ name: `eq.${role}` }),
    );
    const roleId = Number(roles[0]?.id);
    if (roles.length !== 1 || !Number.isInteger(roleId) || roleId <= 0) {
      throw new Error(`The required ${role} role does not exist.`);
    }
    let actorId: number | undefined;
    let apiKeyId: number | undefined;
    const createRecord = async (resource: string, body: Record<string, unknown>): Promise<number> => {
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
      const id = Number(((await response.json()) as { id?: unknown }).id);
      if (!Number.isInteger(id) || id <= 0) {
        throw new UpstreamRequestError(`Creating ${resource} returned an invalid ID.`);
      }
      return id;
    };
    try {
      actorId = await createRecord('actor', {});
      apiKeyId = await createRecord('api key', {
        'key': randomBytes(32).toString('base64url'),
        'is of-actor': actorId,
      });
      const assignment = await fetch(`${getPostgrestUrl()}/${encodeURIComponent('api key-has-role')}`, {
        method: 'POST',
        headers: requestHeaders(authorization, {
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        }),
        body: JSON.stringify({ 'api key': apiKeyId, role: roleId }),
      });
      if (!assignment.ok) {
        throw new UpstreamRequestError(`Unable to assign the credential role (${assignment.status}).`);
      }
    } catch (error) {
      if (apiKeyId != null) {
        await fetch(`${getPostgrestUrl()}/${encodeURIComponent('api key')}?id=eq.${apiKeyId}`, {
          method: 'DELETE',
          headers: requestHeaders(authorization),
        });
      }
      if (actorId != null) {
        await fetch(`${getPostgrestUrl()}/${encodeURIComponent('actor')}?id=eq.${actorId}`, {
          method: 'DELETE',
          headers: requestHeaders(authorization),
        });
      }
      throw error;
    }
    res.json({ actorId });
  } catch (error) {
    sendDenied(res, error);
  }
});

router.all('/admin-db/:resource', ...dosProtect, authorize, async (req, res) => {
  try {
    const authorization = req.headers.authorization!;
    const resource = decodeURIComponent(req.params.resource);
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    const allowedIds = authorizeResource(context, resource, req.method);
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
    if (
      ['PATCH', 'PUT'].includes(req.method) &&
      resource === 'user' &&
      req.body &&
      ('password' in req.body || 'jwt secret' in req.body || 'jwt_secret' in req.body)
    ) {
      throw new Error('Use the dedicated password or credential rotation action.');
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

    const body = redactSecrets(resource, JSON.parse(text), context);
    res.json(body);
  } catch (error) {
    sendDenied(res, error);
  }
});

export default router;
