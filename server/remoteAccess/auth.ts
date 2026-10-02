import type { Request } from 'express';
import type { JWTPayload } from 'jose';

export interface RemoteIdentity {
  userId: number;
  username: string;
  token: string;
}

export const bearerToken = (authorization: string | undefined): string => {
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(authorization ?? '');
  if (!match) throw new Error('Invalid bearer authorization.');
  return match[1];
};

export const resolveRemoteIdentity = async (
  req: Request,
  payload: JWTPayload,
  apiUrl: string,
  signal?: AbortSignal,
): Promise<RemoteIdentity> => {
  const claimedId = Number(payload.id ?? payload.sub);
  if (!Number.isSafeInteger(claimedId) || claimedId <= 0) throw new Error('The token has no valid user identity.');
  const token = bearerToken(req.get('Authorization'));
  const response = await fetch(`${apiUrl}/user/v1/whoami`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal,
  });
  if (!response.ok) throw new Error('Unable to resolve authenticated user.');
  const user = (await response.json()) as Record<string, unknown>;
  const userId = Number(user.id);
  const username = typeof user.username === 'string' ? user.username : '';
  if (userId !== claimedId || !username || Buffer.byteLength(username) > 255 || /[\0-\x1f\x7f:]/.test(username)) {
    throw new Error('Authenticated user identity mismatch.');
  }
  return { userId, username, token };
};

export const authorizeDevice = async (
  identity: RemoteIdentity,
  apiUrl: string,
  deviceUuid: string,
  signal?: AbortSignal,
): Promise<void> => {
  const response = await fetch(`${apiUrl}/access/v1/hostos/${encodeURIComponent(deviceUuid)}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${identity.token}` },
    signal,
  });
  if (!response.ok)
    throw new Error(response.status === 404 ? 'Device not found or access denied.' : 'Device access denied.');
};
