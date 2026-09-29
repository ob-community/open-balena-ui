export interface TunnelEndpoint {
  host: string;
  port: number;
  servername: string;
}

export interface RemoteAccessConfig {
  apiUrl: string;
  postgrestUrl: string;
  tunnel: TunnelEndpoint;
  targetPort: number;
  connectTimeoutMs: number;
  keyIdleTtlMs: number;
  ticketTtlMs: number;
  maxOperationsPerUser: number;
  maxWebSocketsPerIp: number;
  maxChannelsPerSocket: number;
  maxMessageBytes: number;
  maxUploadBytes: number;
  maxPathBytes: number;
  allowedOrigins: Set<string>;
  hostKeys: Map<string, Set<string>>;
  allowUnverifiedHostKeys: boolean;
}

const integer = (value: string | undefined, fallback: number, minimum: number): number => {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum)
    throw new Error(`Invalid remote-access numeric configuration.`);
  return parsed;
};

export const parseBoolean = (value: string | undefined, fallback = false): boolean => {
  if (value == null || value === '') return fallback;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error('Invalid remote-access boolean configuration.');
};

export const parseTunnelEndpoint = (value: string): TunnelEndpoint => {
  const candidate = value.includes('://') ? value : `https://${value}`;
  const url = new URL(candidate);
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('OPEN_BALENA_TUNNEL_URL must be an HTTPS host with an optional port.');
  }
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 443,
    servername: url.hostname,
  };
};

export const parseHostKeys = (value: string | undefined): Map<string, Set<string>> => {
  const result = new Map<string, Set<string>>();
  for (const rawEntry of value?.split(',') ?? []) {
    const entry = rawEntry.trim();
    if (!entry) continue;
    const separator = entry.indexOf('=');
    const host = separator === -1 ? '*' : entry.slice(0, separator).trim().toLowerCase();
    const fingerprint = (separator === -1 ? entry : entry.slice(separator + 1)).trim();
    if (!host || (host !== '*' && !/^[a-z0-9.-]+$/.test(host)) || !/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(fingerprint)) {
      throw new Error('OPEN_BALENA_SSH_HOST_KEYS contains an invalid host or SHA256 fingerprint.');
    }
    const fingerprints = result.get(host) ?? new Set<string>();
    fingerprints.add(fingerprint.replace(/=$/, ''));
    result.set(host, fingerprints);
  }
  return result;
};

const requiredUrl = (name: string, value: string | undefined): string => {
  if (!value) throw new Error(`${name} must be configured.`);
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`${name} must be an HTTP(S) URL.`);
  return value.replace(/\/+$/, '');
};

export const loadRemoteAccessConfig = (environment: NodeJS.ProcessEnv = process.env): RemoteAccessConfig => {
  const tunnelUrl = environment.OPEN_BALENA_TUNNEL_URL;
  if (!tunnelUrl) throw new Error('OPEN_BALENA_TUNNEL_URL must be configured.');
  const allowedOrigins = new Set(
    (environment.OPEN_BALENA_REMOTE_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map((origin) => new URL(origin).origin),
  );
  return {
    apiUrl: requiredUrl('REACT_APP_OPEN_BALENA_API_URL', environment.REACT_APP_OPEN_BALENA_API_URL),
    postgrestUrl: requiredUrl('OPEN_BALENA_POSTGREST_URL', environment.OPEN_BALENA_POSTGREST_URL),
    tunnel: parseTunnelEndpoint(tunnelUrl),
    targetPort: integer(environment.OPEN_BALENA_SSH_TARGET_PORT, 22222, 1),
    connectTimeoutMs: integer(environment.OPEN_BALENA_REMOTE_CONNECT_TIMEOUT_MS, 15_000, 100),
    keyIdleTtlMs: integer(environment.OPEN_BALENA_SSH_KEY_IDLE_TTL_MS, 600_000, 0),
    ticketTtlMs: integer(environment.OPEN_BALENA_REMOTE_TICKET_TTL_MS, 30_000, 1_000),
    maxOperationsPerUser: integer(environment.OPEN_BALENA_REMOTE_MAX_OPERATIONS_PER_USER, 8, 1),
    maxWebSocketsPerIp: integer(environment.OPEN_BALENA_REMOTE_MAX_WEBSOCKETS_PER_IP, 8, 1),
    maxChannelsPerSocket: integer(environment.OPEN_BALENA_REMOTE_MAX_CHANNELS_PER_SOCKET, 4, 1),
    maxMessageBytes: integer(environment.OPEN_BALENA_REMOTE_MAX_MESSAGE_BYTES, 1024 * 1024, 1024),
    maxUploadBytes: integer(environment.OPEN_BALENA_REMOTE_MAX_UPLOAD_BYTES, 1024 * 1024 * 1024, 1),
    maxPathBytes: integer(environment.OPEN_BALENA_REMOTE_MAX_PATH_BYTES, 4096, 1),
    allowedOrigins,
    hostKeys: parseHostKeys(environment.OPEN_BALENA_SSH_HOST_KEYS),
    allowUnverifiedHostKeys: parseBoolean(environment.OPEN_BALENA_SSH_ALLOW_UNVERIFIED_HOST_KEYS, false),
  };
};
