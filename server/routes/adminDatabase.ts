import { json, Router } from 'express';
import {
  authorizeGlobalAdminBootstrap,
  authorizeMutationBody,
  authorizePreActivationAssignment,
  authorizeResource,
  buildAccessContext,
  queryReferencesCredential,
  queryUsesUnsafeEmbedding,
  redactSecrets,
} from '../accessControl';
import authorize, { type AuthorizedLocals } from '../middleware/authorize';
import dosProtect from '../middleware/dosProtect';

const router = Router();
router.use(json());

const getPostgrestUrl = (): string => {
  const value = process.env.OPEN_BALENA_POSTGREST_URL ?? process.env.REACT_APP_OPEN_BALENA_POSTGREST_URL;
  if (!value) {
    throw new Error('OPEN_BALENA_POSTGREST_URL must be configured.');
  }
  return value.replace(/\/+$/, '');
};

const requestHeaders = (authorization: string, headers?: HeadersInit): Headers => {
  const result = new Headers(headers);
  result.set('Authorization', authorization);
  result.set('Accept', 'application/json');
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

router.all('/admin-db/:resource', ...dosProtect, authorize, async (req, res) => {
  try {
    const authorization = req.headers.authorization!;
    const resource = decodeURIComponent(req.params.resource);
    const context = await buildAccessContext((res.locals as AuthorizedLocals).auth, databaseReader(authorization));
    const allowedIds = authorizeResource(context, resource, req.method);
    authorizeMutationBody(context, resource, req.method, req.body);
    authorizePreActivationAssignment(context, resource, req.method, req.body);
    if (!['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'].includes(req.method)) {
      throw new Error('Unsupported direct database method.');
    }
    if (queryUsesUnsafeEmbedding(req.query)) {
      throw new Error('Client-controlled projections and relationship embedding are not allowed.');
    }
    if (queryReferencesCredential(resource, req.query)) {
      throw new Error('Credential fields cannot be queried through administrator access.');
    }
    const creatingGlobalAdmin = authorizeGlobalAdminBootstrap(
      context,
      resource,
      req.method,
      req.body,
      process.env.OPEN_BALENA_BOOTSTRAP_USER_ID,
    );
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

    const body = redactSecrets(JSON.parse(text), context);
    if (creatingGlobalAdmin && body && typeof body === 'object' && 'id' in body) {
      const assignment = await fetch(`${getPostgrestUrl()}/${encodeURIComponent('user-has-role')}`, {
        method: 'POST',
        headers: requestHeaders(authorization, {
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        }),
        body: JSON.stringify({ user: context.userId, role: (body as { id: unknown }).id }),
      });
      if (!assignment.ok) {
        await fetch(`${getPostgrestUrl()}/${encodeURIComponent('role')}?id=eq.${(body as { id: unknown }).id}`, {
          method: 'DELETE',
          headers: requestHeaders(authorization),
        });
        throw new Error('Unable to assign the initial global administrator; role creation was rolled back.');
      }
    }
    res.json(body);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Direct database request denied.';
    res.status(message.includes('configured') ? 500 : 403).json({ message });
  }
});

export default router;
