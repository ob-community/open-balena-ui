export interface DeviceConnectionTarget {
  id: string;
  label: string;
  url: string;
}

const allowedProtocols = new Set(['http:', 'https:']);

export const parseRemoteBaseUrl = (value: unknown): URL | undefined => {
  if (typeof value !== 'string' || value.trim() !== value || value === '') {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (!allowedProtocols.has(url.protocol) || url.username || url.password) {
      return undefined;
    }
    url.search = '';
    url.hash = '';
    return url;
  } catch {
    return undefined;
  }
};

export const buildDeviceConnectionUrl = (
  baseUrl: URL,
  path: unknown,
  parameters: Record<string, string>,
): string | undefined => {
  try {
    if (typeof path === 'string' && path.startsWith('//')) {
      return undefined;
    }

    const url = typeof path === 'string' && path !== '' ? new URL(path, baseUrl) : new URL(baseUrl.toString());

    if (!allowedProtocols.has(url.protocol) || url.origin !== baseUrl.origin) {
      return undefined;
    }

    url.search = '';
    url.hash = '';
    Object.entries(parameters).forEach(([name, value]) => url.searchParams.set(name, value));
    return url.toString();
  } catch {
    return undefined;
  }
};

export const addDeviceConnectionCredentials = (
  targets: DeviceConnectionTarget[],
  targetId: unknown,
  expectedOrigin: string,
  username: string,
  privateKey: string,
): string | undefined => {
  if (typeof targetId !== 'string') {
    return undefined;
  }

  const target = targets.find(({ id }) => id === targetId);
  if (!target) {
    return undefined;
  }

  try {
    const url = new URL(target.url);
    if (!allowedProtocols.has(url.protocol) || url.origin !== expectedOrigin) {
      return undefined;
    }

    url.searchParams.set('username', username);
    url.searchParams.set('privateKey', privateKey);
    return url.toString();
  } catch {
    return undefined;
  }
};
