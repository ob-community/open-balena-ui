import path from 'node:path';

export const isDeviceUuid = (value: unknown): value is string =>
  typeof value === 'string' &&
  (/^[a-f0-9]{32}$/i.test(value) ||
    /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value));

export const validateRemotePath = (value: unknown, maxBytes = 4096): string => {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    Buffer.byteLength(value) > maxBytes ||
    /[\0-\x1f\x7f]/.test(value)
  ) {
    throw new Error('A valid absolute remote path is required.');
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || value.split('/').includes('..')) throw new Error('The remote path must be normalized.');
  return value;
};

export const validateContainerName = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(value)) {
    throw new Error('Invalid container name.');
  }
  return value;
};

export interface ByteRange {
  start: number;
  end: number;
}

export const parseSingleRange = (header: string | undefined, size: number): ByteRange | undefined => {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (!match[1] && !match[2]) || size < 0) throw new Error('Invalid range.');
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0 || size === 0) throw new Error('Unsatisfiable range.');
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) {
      throw new Error('Unsatisfiable range.');
    }
    end = Math.min(end, size - 1);
  }
  return { start, end };
};

export const originAllowed = (origin: string | undefined, host: string | undefined, allowed: Set<string>): boolean => {
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return allowed.has(parsed.origin) || parsed.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
};

export const contentDisposition = (remotePath: string): string => {
  const name = path.posix.basename(remotePath).replace(/["\\\r\n]/g, '_') || 'download';
  return `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`;
};
