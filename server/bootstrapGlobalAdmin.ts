import { SignJWT } from 'jose';

type Fetch = typeof fetch;

interface BootstrapOptions {
  postgrestUrl: string;
  jwtSecret: string;
  userId: number;
  fetchImpl?: Fetch;
}

const readRows = async (
  fetchImpl: Fetch,
  url: string,
  authorization: string,
): Promise<Array<Record<string, unknown>>> => {
  const response = await fetchImpl(url, {
    headers: { Authorization: authorization, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`Bootstrap lookup failed (${response.status}).`);
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new Error('Bootstrap lookup returned an invalid response.');
  }
  return body as Array<Record<string, unknown>>;
};

const recordId = (record: Record<string, unknown> | undefined): number | undefined => {
  const id = Number(record?.id);
  return Number.isInteger(id) && id > 0 ? id : undefined;
};

export const bootstrapGlobalAdmin = async ({
  postgrestUrl,
  jwtSecret,
  userId,
  fetchImpl = fetch,
}: BootstrapOptions): Promise<void> => {
  const baseUrl = postgrestUrl.replace(/\/+$/, '');
  const token = await new SignJWT({ id: userId })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(jwtSecret));
  const authorization = `Bearer ${token}`;
  const bootstrapUsers = await readRows(
    fetchImpl,
    `${baseUrl}/${encodeURIComponent('user')}?id=eq.${userId}`,
    authorization,
  );
  if (bootstrapUsers.length !== 1) {
    throw new Error(`OPEN_BALENA_BOOTSTRAP_USER_ID ${userId} does not identify exactly one user.`);
  }

  let roles = await readRows(fetchImpl, `${baseUrl}/${encodeURIComponent('role')}?name=eq.global-admin`, authorization);
  if (!roles.length) {
    const response = await fetchImpl(`${baseUrl}/${encodeURIComponent('role')}`, {
      method: 'POST',
      headers: {
        'Authorization': authorization,
        'Accept': 'application/vnd.pgrst.object+json',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify({ name: 'global-admin' }),
    });
    if (!response.ok && response.status !== 409) {
      throw new Error(`Unable to create the global-admin role (${response.status}).`);
    }
    roles = response.ok
      ? [(await response.json()) as Record<string, unknown>]
      : await readRows(fetchImpl, `${baseUrl}/${encodeURIComponent('role')}?name=eq.global-admin`, authorization);
  }

  const roleId = recordId(roles[0]);
  if (roles.length !== 1 || roleId == null) {
    throw new Error('The global-admin role lookup returned an invalid result.');
  }
  const assignments = await readRows(
    fetchImpl,
    `${baseUrl}/${encodeURIComponent('user-has-role')}?user=eq.${userId}&role=eq.${roleId}`,
    authorization,
  );
  if (assignments.length) {
    return;
  }
  const assignment = await fetchImpl(`${baseUrl}/${encodeURIComponent('user-has-role')}`, {
    method: 'POST',
    headers: {
      'Authorization': authorization,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ user: userId, role: roleId }),
  });
  if (!assignment.ok && assignment.status !== 409) {
    throw new Error(`Unable to assign global-admin to bootstrap user ${userId} (${assignment.status}).`);
  }
  if (assignment.status === 409) {
    const concurrentAssignments = await readRows(
      fetchImpl,
      `${baseUrl}/${encodeURIComponent('user-has-role')}?user=eq.${userId}&role=eq.${roleId}`,
      authorization,
    );
    if (!concurrentAssignments.length) {
      throw new Error(`Unable to confirm global-admin assignment for bootstrap user ${userId}.`);
    }
  }
};

export const bootstrapGlobalAdminFromEnvironment = async (): Promise<void> => {
  const configuredUserId = process.env.OPEN_BALENA_BOOTSTRAP_USER_ID?.trim();
  if (!configuredUserId) {
    return;
  }
  const userId = Number(configuredUserId);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('OPEN_BALENA_BOOTSTRAP_USER_ID must be a positive numeric user ID.');
  }
  const postgrestUrl = process.env.OPEN_BALENA_POSTGREST_URL ?? process.env.REACT_APP_OPEN_BALENA_POSTGREST_URL;
  const jwtSecret = process.env.OPEN_BALENA_JWT_SECRET;
  if (!postgrestUrl || !jwtSecret) {
    throw new Error(
      'OPEN_BALENA_POSTGREST_URL and OPEN_BALENA_JWT_SECRET are required when OPEN_BALENA_BOOTSTRAP_USER_ID is set.',
    );
  }
  await bootstrapGlobalAdmin({ postgrestUrl, jwtSecret, userId });
};
