import type { JWTPayload } from 'jose';

export const GLOBAL_ADMIN_ROLE = 'global-admin';
export const ORGANIZATION_ADMIN_ROLE = 'organization-admin';

const GLOBAL_ONLY_RESOURCES = new Set([
  'config',
  'migration',
  'migration lock',
  'model',
  'permission',
  'role',
  'role-has-permission',
]);

const ORGANIZATION_SCOPED_RESOURCES = new Set([
  'actor',
  'api key',
  'api key-has-permission',
  'api key-has-role',
  'organization',
  'organization membership',
  'user',
  'user-has-direct access to-application',
  'user-has-permission',
  'user-has-public key',
  'user-has-role',
]);
const DIRECT_DATABASE_RESOURCES = new Set([...GLOBAL_ONLY_RESOURCES, ...ORGANIZATION_SCOPED_RESOURCES]);

const SECRET_FIELDS = new Set(['password', 'jwt_secret', 'jwt secret']);

export interface AccessContext {
  enforcementEnabled: boolean;
  globalAdmin: boolean;
  organizationAdmin: boolean;
  userId: number;
  username?: string;
  ownActorId?: number;
  allowedIds: Record<string, Set<number>>;
  allowedApplicationIds: Set<number>;
  globalRoleIds: Set<number>;
  ownGlobalRoleAssignmentIds: Set<number>;
  protectedRoleIds: Set<number>;
  organizationAssignableRoleIds: Set<number>;
  manageableUserRoleAssignmentIds: Set<number>;
  ownPublicKeyIds: Set<number>;
  manageableApiKeyActorIds: Set<number>;
  manageableApiKeyIds: Set<number>;
  visibleApiKeyIds: Set<number>;
}

export interface DatabaseReader {
  list(resource: string, query?: URLSearchParams): Promise<Array<Record<string, unknown>>>;
}

const numberField = (record: Record<string, unknown>, ...fields: string[]): number | undefined => {
  for (const field of fields) {
    const value = record[field];
    if (typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      return Number(value);
    }
  }
  return undefined;
};

const CREDENTIAL_FIELDS: Record<string, string[]> = {
  'api key': ['key'],
  'user': ['password', 'jwt secret'],
  'user-has-public key': ['public key'],
};

const decodeQueryIdentifier = (value: string): string => {
  let decoded = value.replace(/\+/g, ' ');
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) {
        break;
      }
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
};

const normalizeQueryIdentifier = (value: string): string =>
  decodeQueryIdentifier(value).toLowerCase().replace(/"/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

const queryValues = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter((entry): entry is string => typeof entry === 'string');

const compoundExpressionFields = (expression: string): string[] => {
  const fields: string[] = [];
  const fieldExpression =
    /(?:^|[,(])\s*([^(),.]+?)\s*\.(?:not\.)?(?:eq|neq|gt|gte|lt|lte|like|ilike|match|imatch|in|is|isdistinct|fts|plfts|phfts|wfts|cs|cd|ov|sl|sr|nxr|nxl|adj)\./gi;
  for (const match of normalizeQueryIdentifier(expression).matchAll(fieldExpression)) {
    fields.push(match[1].trim());
  }
  return fields;
};

const expressionReferencesField = (queryKey: string, expression: string, field: string): boolean => {
  const normalizedExpression = normalizeQueryIdentifier(expression);
  if (queryKey === 'select' || queryKey === 'columns') {
    return normalizedExpression
      .split(',')
      .map((entry) => entry.split('::')[0].split(':').pop()?.trim())
      .some((entry) => entry === field);
  }
  if (queryKey === 'order') {
    return normalizedExpression
      .split(',')
      .map((entry) => entry.trim().split('.')[0])
      .some((entry) => entry === field);
  }
  if (['or', 'and', 'not'].includes(queryKey)) {
    return compoundExpressionFields(normalizedExpression).includes(field);
  }
  return false;
};

export const queryReferencesCredential = (resource: string, query: unknown): boolean => {
  const credentialFields = CREDENTIAL_FIELDS[resource];
  if (!credentialFields || !query || typeof query !== 'object' || Array.isArray(query)) {
    return false;
  }
  return Object.entries(query).some(([rawKey, value]) => {
    const queryKey = normalizeQueryIdentifier(rawKey);
    const filterField = queryKey.split('@')[0];
    const fieldSegments = filterField.split('.').map((segment) => segment.trim());
    if (credentialFields.some((field) => fieldSegments.includes(field))) {
      return true;
    }
    return (
      ['select', 'columns', 'order', 'or', 'and', 'not'].includes(queryKey) &&
      queryValues(value).some((expression) =>
        credentialFields.some((field) => expressionReferencesField(queryKey, expression, field)),
      )
    );
  });
};

export const queryUsesUnsafeEmbedding = (query: Record<string, unknown>): boolean =>
  Object.entries(query).some(([key, value]) => {
    if (['select', 'columns', 'or', 'and', 'not'].includes(key) || key.includes('.')) {
      return true;
    }
    return key === 'order' && String(value).includes('(');
  });

export const authorizeAdministratorRoleCreation = (
  context: AccessContext,
  resource: string,
  method: string,
  body: unknown,
): void => {
  const requestedRoleNames =
    resource === 'role'
      ? (Array.isArray(body) ? body : [body])
          .filter((record): record is Record<string, unknown> => record != null && typeof record === 'object')
          .map((record) => record.name)
      : [];
  if (!context.enforcementEnabled && requestedRoleNames.includes(ORGANIZATION_ADMIN_ROLE)) {
    throw new Error('Create organization-admin only after global administrator enforcement is active.');
  }
  if (!requestedRoleNames.includes(GLOBAL_ADMIN_ROLE)) {
    return;
  }
  if (['POST', 'PATCH', 'PUT'].includes(method)) {
    throw new Error('The global-admin role is managed at server startup through OPEN_BALENA_BOOTSTRAP_USER_ID.');
  }
};

export const authorizePreActivationAssignment = (
  context: AccessContext,
  resource: string,
  method: string,
  body: unknown,
): void => {
  if (
    context.enforcementEnabled ||
    resource !== 'user-has-role' ||
    !['POST', 'PATCH', 'PUT'].includes(method) ||
    !body ||
    typeof body !== 'object'
  ) {
    return;
  }
  if (Array.isArray(body)) {
    throw new Error('Bulk role assignments are not allowed before global administrator activation.');
  }
  if (['PATCH', 'PUT'].includes(method)) {
    throw new Error('Role assignments cannot be updated before global administrator activation.');
  }
  const roleId = numberField(body as Record<string, unknown>, 'role');
  if (roleId != null && context.protectedRoleIds.has(roleId)) {
    throw new Error('Protected administrator roles cannot be assigned before global administrator activation.');
  }
};

const ids = (records: Array<Record<string, unknown>>, ...fields: string[]): Set<number> =>
  new Set(records.map((record) => numberField(record, ...fields)).filter((value): value is number => value != null));

export const organizationAssignableRoleNames = (): Set<string> =>
  new Set(
    (process.env.OPEN_BALENA_ORGANIZATION_ADMIN_ASSIGNABLE_ROLES ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0 && name !== GLOBAL_ADMIN_ROLE && name !== ORGANIZATION_ADMIN_ROLE),
  );

const listByIds = async (
  database: DatabaseReader,
  resource: string,
  field: string,
  values: Set<number>,
): Promise<Array<Record<string, unknown>>> => {
  if (!values.size) {
    return [];
  }
  return database.list(resource, new URLSearchParams({ [field]: `in.(${[...values].join(',')})` }));
};

const getManagedCredentialActors = async (
  database: DatabaseReader,
  applications?: Array<Record<string, unknown>>,
): Promise<Set<number>> => {
  const managedApplications = applications ?? (await database.list('application'));
  const applicationIds = ids(managedApplications, 'id');
  const devices = await listByIds(database, 'device', 'belongs to-application', applicationIds);
  return new Set([...ids(managedApplications, 'actor'), ...ids(devices, 'actor')]);
};

const getVisibleApiKeyIds = async (
  database: DatabaseReader,
  ownActorId: number | undefined,
  manageableApiKeyActorIds: Set<number>,
): Promise<Set<number>> => {
  const visibleActorIds = new Set(manageableApiKeyActorIds);
  if (ownActorId != null) {
    visibleActorIds.add(ownActorId);
  }
  return ids(await listByIds(database, 'api key', 'is of-actor', visibleActorIds), 'id');
};

export const getAuthenticatedUserId = (payload: JWTPayload): number => {
  const id = payload.id ?? payload.sub;
  const numericId = typeof id === 'number' ? id : Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error('Authenticated token does not identify a user.');
  }
  return numericId;
};

export const buildAccessContext = async (payload: JWTPayload, database: DatabaseReader): Promise<AccessContext> => {
  const userId = getAuthenticatedUserId(payload);
  const roles = await database.list('role');
  const globalRoleIds = ids(
    roles.filter((role) => role.name === GLOBAL_ADMIN_ROLE),
    'id',
  );
  const organizationRoleIds = ids(
    roles.filter((role) => role.name === ORGANIZATION_ADMIN_ROLE),
    'id',
  );
  const protectedRoleIds = new Set([...globalRoleIds, ...organizationRoleIds]);
  const assignableRoleNames = organizationAssignableRoleNames();
  const organizationAssignableRoleIds = ids(
    roles.filter((role) => typeof role.name === 'string' && assignableRoleNames.has(role.name)),
    'id',
  );
  const ownUser = await database.list('user', new URLSearchParams({ id: `eq.${userId}` }));
  const username = typeof ownUser[0]?.username === 'string' ? ownUser[0].username : undefined;
  const ownActorId = ownUser[0] ? numberField(ownUser[0], 'actor') : undefined;
  const ownPublicKeyIds = ids(
    await database.list('user-has-public key', new URLSearchParams({ user: `eq.${userId}` })),
    'id',
  );

  if (!globalRoleIds.size) {
    // Deliberate compatibility mode: without global-admin, every authenticated user retains legacy super-admin access.
    const manageableApiKeyActorIds = await getManagedCredentialActors(database);
    const manageableApiKeyIds = await getVisibleApiKeyIds(database, ownActorId, manageableApiKeyActorIds);
    return {
      enforcementEnabled: false,
      globalAdmin: true,
      organizationAdmin: true,
      userId,
      username,
      ownActorId,
      allowedIds: {},
      allowedApplicationIds: new Set(),
      globalRoleIds,
      ownGlobalRoleAssignmentIds: new Set(),
      protectedRoleIds,
      organizationAssignableRoleIds,
      manageableUserRoleAssignmentIds: new Set(),
      ownPublicKeyIds,
      manageableApiKeyActorIds,
      manageableApiKeyIds,
      visibleApiKeyIds: manageableApiKeyIds,
    };
  }

  const assignments = await database.list('user-has-role', new URLSearchParams({ user: `eq.${userId}` }));
  const assignedRoleIds = ids(assignments, 'role');
  const ownGlobalRoleAssignmentIds = ids(
    assignments.filter((assignment) => globalRoleIds.has(numberField(assignment, 'role') ?? -1)),
    'id',
  );
  const globalAdmin = [...globalRoleIds].some((id) => assignedRoleIds.has(id));
  const organizationAdmin = [...organizationRoleIds].some((id) => assignedRoleIds.has(id));

  if (globalAdmin || !organizationAdmin) {
    const manageableApiKeyActorIds = globalAdmin ? await getManagedCredentialActors(database) : new Set<number>();
    const manageableApiKeyIds = await getVisibleApiKeyIds(database, ownActorId, manageableApiKeyActorIds);
    return {
      enforcementEnabled: true,
      globalAdmin,
      organizationAdmin,
      userId,
      username,
      ownActorId,
      allowedIds: {},
      allowedApplicationIds: new Set(),
      globalRoleIds,
      ownGlobalRoleAssignmentIds,
      protectedRoleIds,
      organizationAssignableRoleIds,
      manageableUserRoleAssignmentIds: new Set(),
      ownPublicKeyIds,
      manageableApiKeyActorIds,
      manageableApiKeyIds,
      visibleApiKeyIds: manageableApiKeyIds,
    };
  }

  const ownMemberships = await database.list('organization membership', new URLSearchParams({ user: `eq.${userId}` }));
  const organizationIds = ids(ownMemberships, 'is member of-organization');
  const organizationMemberships = await listByIds(
    database,
    'organization membership',
    'is member of-organization',
    organizationIds,
  );
  const globalAssignments = await listByIds(database, 'user-has-role', 'role', globalRoleIds);
  const globalAdminUserIds = ids(globalAssignments, 'user');
  const memberships = organizationMemberships.filter(
    (membership) => !globalAdminUserIds.has(numberField(membership, 'user') ?? -1),
  );
  const userIds = ids(memberships, 'user');
  const users = await listByIds(database, 'user', 'id', userIds);
  const userActorIds = ids(users, 'actor');
  const applications = await listByIds(database, 'application', 'organization', organizationIds);
  const applicationIds = ids(applications, 'id');
  const applicationActorIds = ids(applications, 'actor');
  const devices = await listByIds(database, 'device', 'belongs to-application', applicationIds);
  const deviceActorIds = ids(devices, 'actor');
  const manageableApiKeyActorIds = new Set([...applicationActorIds, ...deviceActorIds]);
  const actorIds = new Set([...userActorIds, ...applicationActorIds, ...deviceActorIds]);
  const apiKeys = await listByIds(database, 'api key', 'is of-actor', actorIds);
  const apiKeyIds = ids(apiKeys, 'id');
  const manageableApiKeyIds = ids(
    apiKeys.filter((apiKey) => {
      const actorId = numberField(apiKey, 'is of-actor');
      return actorId != null && (actorId === ownActorId || manageableApiKeyActorIds.has(actorId));
    }),
    'id',
  );

  const [userRoles, userPermissions, userPublicKeys, directApplicationAccess, apiKeyRoles, apiKeyPermissions] =
    await Promise.all([
      listByIds(database, 'user-has-role', 'user', userIds),
      listByIds(database, 'user-has-permission', 'user', userIds),
      listByIds(database, 'user-has-public key', 'user', userIds),
      listByIds(database, 'user-has-direct access to-application', 'user', userIds),
      listByIds(database, 'api key-has-role', 'api key', apiKeyIds),
      listByIds(database, 'api key-has-permission', 'api key', apiKeyIds),
    ]);

  const assignableUserRoles = userRoles.filter((assignment) =>
    organizationAssignableRoleIds.has(numberField(assignment, 'role') ?? -1),
  );
  const manageableUserRoleAssignmentIds = ids(assignableUserRoles, 'id');

  return {
    enforcementEnabled: true,
    globalAdmin: false,
    organizationAdmin: true,
    userId,
    ownActorId,
    allowedApplicationIds: applicationIds,
    globalRoleIds,
    ownGlobalRoleAssignmentIds,
    protectedRoleIds,
    organizationAssignableRoleIds,
    manageableUserRoleAssignmentIds,
    ownPublicKeyIds,
    manageableApiKeyActorIds,
    manageableApiKeyIds,
    visibleApiKeyIds: manageableApiKeyIds,
    allowedIds: {
      'actor': actorIds,
      'api key': apiKeyIds,
      'api key-has-permission': ids(apiKeyPermissions, 'id'),
      'api key-has-role': ids(apiKeyRoles, 'id'),
      'organization': organizationIds,
      'organization membership': ids(memberships, 'id'),
      'user': userIds,
      'user-has-direct access to-application': ids(directApplicationAccess, 'id'),
      'user-has-permission': ids(userPermissions, 'id'),
      'user-has-public key': ids(userPublicKeys, 'id'),
      'user-has-role': ids(assignableUserRoles, 'id'),
    },
  };
};

export const authorizeResource = (
  context: AccessContext,
  resource: string,
  method: string,
): Set<number> | undefined => {
  if (!DIRECT_DATABASE_RESOURCES.has(resource)) {
    throw new Error('This resource is not available through direct database access.');
  }
  if (!context.enforcementEnabled || context.globalAdmin) {
    return undefined;
  }
  if (resource === 'role' && method === 'GET' && context.organizationAdmin) {
    return context.organizationAssignableRoleIds;
  }
  if (GLOBAL_ONLY_RESOURCES.has(resource) || !ORGANIZATION_SCOPED_RESOURCES.has(resource)) {
    throw new Error('Global administrator access is required.');
  }
  if (!context.organizationAdmin) {
    throw new Error('Administrator access is required.');
  }
  if (resource === 'user-has-public key' && ['PATCH', 'DELETE'].includes(method)) {
    return context.ownPublicKeyIds;
  }
  if (method === 'POST' && ['actor', 'organization', 'user'].includes(resource)) {
    throw new Error('Organization administrators cannot create this resource through direct database access.');
  }
  if (method === 'DELETE' && resource === 'user') {
    throw new Error('Only global administrators can delete users.');
  }
  if (method === 'DELETE' && ['api key-has-permission', 'api key-has-role', 'user-has-permission'].includes(resource)) {
    throw new Error('Only global administrators can delete direct permission and API key privilege assignments.');
  }
  if (resource === 'api key' && ['PATCH', 'DELETE'].includes(method)) {
    return context.manageableApiKeyIds;
  }
  if (resource === 'user-has-role' && ['PATCH', 'DELETE'].includes(method)) {
    return context.manageableUserRoleAssignmentIds;
  }
  return context.allowedIds[resource] ?? new Set();
};

const requireAllowedReference = (body: Record<string, unknown>, field: string, allowedIds: Set<number>): void => {
  if (!(field in body)) {
    return;
  }
  const value = numberField(body, field);
  if (value == null || !allowedIds.has(value)) {
    throw new Error(`The ${field} reference is outside the administrator's organization scope.`);
  }
};

export const authorizeMutationBody = (
  context: AccessContext,
  resource: string,
  method: string,
  body: unknown,
): void => {
  if (!['POST', 'PATCH', 'PUT'].includes(method)) {
    return;
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('Administrator mutations require an object body.');
  }
  const record = body as Record<string, unknown>;
  if ('id' in record) {
    throw new Error('Primary keys cannot be supplied or changed through direct database access.');
  }
  if (resource === 'user' && ['PATCH', 'PUT'].includes(method) && 'actor' in record) {
    throw new Error('User actor ownership cannot be changed through direct database access.');
  }
  if (resource === 'api key') {
    if (method === 'POST' && !('is of-actor' in record)) {
      throw new Error('New API keys require an in-scope actor.');
    }
    if (['PATCH', 'PUT'].includes(method) && 'is of-actor' in record) {
      throw new Error('API key actor ownership cannot be changed through direct database access.');
    }
    const credentialActorIds = new Set(context.manageableApiKeyActorIds);
    if (context.ownActorId != null) {
      credentialActorIds.add(context.ownActorId);
    }
    requireAllowedReference(record, 'is of-actor', credentialActorIds);
  }
  if (resource === 'user-has-public key' && context.enforcementEnabled && !context.globalAdmin) {
    if (method === 'POST' && numberField(record, 'user') == null) {
      throw new Error('New public keys require the authenticated user.');
    }
    requireAllowedReference(record, 'user', new Set([context.userId]));
  }
  if (!context.enforcementEnabled || context.globalAdmin) {
    return;
  }
  const userIds = context.allowedIds.user ?? new Set();
  const organizationIds = context.allowedIds.organization ?? new Set();
  const apiKeyIds = context.allowedIds['api key'] ?? new Set();

  switch (resource) {
    case 'api key':
      break;
    case 'organization membership':
      requireAllowedReference(record, 'user', userIds);
      requireAllowedReference(record, 'is member of-organization', organizationIds);
      break;
    case 'user-has-role':
      requireAllowedReference(record, 'user', userIds);
      if (method === 'POST' && numberField(record, 'role') == null) {
        throw new Error('New user role assignments require an organization-safe role.');
      }
      requireAllowedReference(record, 'role', context.organizationAssignableRoleIds);
      break;
    case 'user-has-permission':
      throw new Error('Only global administrators can assign direct user permissions.');
    case 'user-has-public key':
      break;
    case 'user-has-direct access to-application':
      requireAllowedReference(record, 'user', userIds);
      requireAllowedReference(record, 'has direct access to-application', context.allowedApplicationIds);
      break;
    case 'api key-has-role':
    case 'api key-has-permission':
      throw new Error('Only global administrators can change API key privileges.');
  }
};

const queryIds = (query: Record<string, unknown>): Set<number> | undefined => {
  const values = Array.isArray(query.id) ? query.id : [query.id];
  const result = new Set<number>();
  for (const value of values) {
    if (typeof value !== 'string') {
      continue;
    }
    const match = value.match(/^(?:eq\.(\d+)|in\.\(([\d,]+)\))$/);
    if (!match) {
      return undefined;
    }
    for (const id of (match[1] ?? match[2]).split(',')) {
      result.add(Number(id));
    }
  }
  return result.size ? result : undefined;
};

export const authorizeScopedMutation = (
  allowedIds: Set<number> | undefined,
  resource: string,
  method: string,
  query: Record<string, unknown>,
): void => {
  if (!allowedIds || !['PATCH', 'DELETE'].includes(method)) {
    return;
  }
  const targetIds = queryIds(query);
  if (!targetIds) {
    throw new Error(`${resource} updates and deletions require an explicit ID.`);
  }
  if ([...targetIds].some((id) => !allowedIds.has(id))) {
    throw new Error(`The ${resource} is outside the administrator scope.`);
  }
};

export const authorizeProtectedRoleMutation = (
  context: AccessContext,
  resource: string,
  method: string,
  body: unknown,
  query: Record<string, unknown>,
): void => {
  if (!context.enforcementEnabled || resource !== 'role' || !['PATCH', 'DELETE'].includes(method)) {
    return;
  }
  const targetIds = queryIds(query);
  if (!targetIds) {
    throw new Error('Role updates and deletions require an explicit role ID.');
  }
  if ([...targetIds].some((id) => context.globalRoleIds.has(id))) {
    throw new Error('The global-admin enforcement role cannot be renamed or deleted after activation.');
  }
  if (
    method === 'PATCH' &&
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    (body as Record<string, unknown>).name === GLOBAL_ADMIN_ROLE
  ) {
    throw new Error('Another role cannot be renamed to global-admin after activation.');
  }
};

export const authorizeSelfLockoutMutation = (
  context: AccessContext,
  resource: string,
  method: string,
  query: Record<string, unknown>,
): void => {
  if (!context.enforcementEnabled || !context.globalAdmin || !['PATCH', 'DELETE'].includes(method)) {
    return;
  }
  if (resource !== 'user' && resource !== 'user-has-role') {
    return;
  }
  if (resource === 'user' && method !== 'DELETE') {
    return;
  }
  const targetIds = queryIds(query);
  if (!targetIds) {
    throw new Error(`${resource} updates and deletions require an explicit ID.`);
  }
  if (resource === 'user' && targetIds.has(context.userId)) {
    throw new Error('Global administrators cannot delete their own user record.');
  }
  if (resource === 'user-has-role' && [...targetIds].some((id) => context.ownGlobalRoleAssignmentIds.has(id))) {
    throw new Error('Global administrators cannot remove or rebind their own global-admin assignment.');
  }
};

export const authorizePasswordChange = (context: AccessContext, targetUserId: number): void => {
  if (context.enforcementEnabled && !context.globalAdmin && !context.organizationAdmin) {
    throw new Error('Administrator access is required.');
  }
  if (targetUserId !== context.userId && !context.globalAdmin) {
    throw new Error('Organization administrators can change only their own password.');
  }
};

export const authorizeCredentialActorProvision = (context: AccessContext): void => {
  if (context.enforcementEnabled && !context.globalAdmin) {
    throw new Error('Global administrator access is required to provision credential actors.');
  }
};

const redactRecord = (
  resource: string,
  record: Record<string, unknown>,
  context: AccessContext,
): Record<string, unknown> => {
  const output: Record<string, unknown> = {};
  const recordId = numberField(record, 'id');
  const actorId = numberField(record, 'is of-actor');
  for (const [key, value] of Object.entries(record)) {
    if (SECRET_FIELDS.has(key)) {
      continue;
    }
    if (
      resource === 'api key' &&
      key === 'key' &&
      !(
        (recordId != null && context.visibleApiKeyIds.has(recordId)) ||
        (actorId != null && (actorId === context.ownActorId || context.manageableApiKeyActorIds.has(actorId)))
      )
    ) {
      continue;
    }
    if (
      key === 'public key' &&
      context.enforcementEnabled &&
      !context.globalAdmin &&
      numberField(record, 'user') !== context.userId
    ) {
      continue;
    }
    output[key] = redactSecrets(resource, value, context);
  }
  return output;
};

export const redactSecrets = (resource: string, input: unknown, context: AccessContext): unknown => {
  if (Array.isArray(input)) {
    return input.map((value) => redactSecrets(resource, value, context));
  }
  if (input === null || typeof input !== 'object') {
    return input;
  }
  return redactRecord(resource, input as Record<string, unknown>, context);
};
