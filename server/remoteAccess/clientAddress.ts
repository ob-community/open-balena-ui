import type { IncomingMessage } from 'node:http';
import { isIP } from 'node:net';
import proxyAddress from 'proxy-addr';

export type TrustedProxyPolicy = (address: string, hop: number) => boolean;

export const createTrustedProxyPolicy = (value: string | undefined): TrustedProxyPolicy => {
  const proxies = (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (proxies.some((entry) => /\/0+$/.test(entry))) {
    throw new Error('OPEN_BALENA_REMOTE_TRUSTED_PROXIES must not trust every IPv4 or IPv6 address.');
  }
  try {
    return proxyAddress.compile(proxies);
  } catch {
    throw new Error('OPEN_BALENA_REMOTE_TRUSTED_PROXIES must contain trusted proxy IP addresses or CIDRs.');
  }
};

export const resolveClientAddress = (request: IncomingMessage, trust: TrustedProxyPolicy): string => {
  const address = proxyAddress(request, trust);
  if (!isIP(address)) throw new Error('A valid client IP address is required.');
  return address;
};
