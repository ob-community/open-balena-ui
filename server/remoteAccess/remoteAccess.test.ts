import assert from 'node:assert/strict';
import test from 'node:test';
import { utils as sshUtils } from 'ssh2';
import type { Request as ExpressRequest } from 'express';
import { authorizeDevice, bearerToken, resolveRemoteIdentity } from './auth';
import { loadRemoteAccessConfig, parseBoolean, parseHostKeys, parseTunnelEndpoint } from './config';
import { generateEd25519SshKey, UserSshKeyManager } from './keys';
import { decodeChannelData, encodeChannelData, parseControlMessage } from './protocol';
import { fingerprint as sshFingerprint, hostKeyVerifier, OperationQuota } from './ssh';
import { TicketStore } from './tickets';
import {
  contentDisposition,
  isDeviceUuid,
  originAllowed,
  parseSingleRange,
  validateContainerName,
  validateRemotePath,
} from './validation';

const fingerprint = `SHA256:${'A'.repeat(43)}`;

test('canonical identity and device authorization use bearer headers only', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; authorization: string | null }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), authorization: new Headers(init?.headers).get('Authorization') });
    return String(input).endsWith('/user/v1/whoami')
      ? Response.json({ id: 42, username: 'alice' })
      : Response.json({ allowed: true });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const token = 'header.payload.signature';
  const request = {
    get: (name: string) => (name === 'Authorization' ? `Bearer ${token}` : undefined),
  } as ExpressRequest;
  const identity = await resolveRemoteIdentity(request, { id: 42 }, 'https://api.example.test');
  await authorizeDevice(identity, 'https://api.example.test', 'a'.repeat(32));
  assert.deepEqual(identity, { userId: 42, username: 'alice', token });
  assert.equal(calls[1].url, `https://api.example.test/access/v1/hostos/${'a'.repeat(32)}`);
  assert.equal(
    calls.every(({ url }) => !url.includes(token)),
    true,
  );
  assert.equal(
    calls.every(({ authorization }) => authorization === `Bearer ${token}`),
    true,
  );
  assert.throws(() => bearerToken('Basic credentials'));
});

test('remote access configuration is strict and applies safe defaults', () => {
  assert.deepEqual(parseTunnelEndpoint('tunnel.internal:8443'), {
    protocol: 'https:',
    host: 'tunnel.internal',
    port: 8443,
    servername: 'tunnel.internal',
  });
  assert.deepEqual(parseTunnelEndpoint('http://ob-vpn.openbalena.svc.cluster.local:3128'), {
    protocol: 'http:',
    host: 'ob-vpn.openbalena.svc.cluster.local',
    port: 3128,
    servername: 'ob-vpn.openbalena.svc.cluster.local',
  });
  assert.equal(parseTunnelEndpoint('http://tunnel.internal').port, 80);
  assert.throws(() => parseTunnelEndpoint('ftp://tunnel.internal'));
  assert.throws(() => parseTunnelEndpoint('http://tunnel.internal/path'));
  assert.equal(parseBoolean(undefined), false);
  assert.equal(parseBoolean('true'), true);
  assert.throws(() => parseBoolean('yes'));
  assert.deepEqual([...parseHostKeys(`device.balena=${fingerprint},${fingerprint}`).keys()], ['device.balena', '*']);

  const config = loadRemoteAccessConfig({
    OPEN_BALENA_TUNNEL_URL: 'https://tunnel.internal',
    OPEN_BALENA_POSTGREST_URL: 'http://postgrest:3000/',
    REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test/',
    OPEN_BALENA_SSH_HOST_KEYS: fingerprint,
  });
  assert.equal(config.targetPort, 22222);
  assert.equal(config.keyIdleTtlMs, 600_000);
  assert.equal(config.allowUnverifiedHostKeys, false);
  assert.equal(config.apiUrl, 'https://api.example.test');
});

test('remote identifiers, paths, origins, and download headers are validated', () => {
  assert.equal(isDeviceUuid('a'.repeat(32)), true);
  assert.equal(isDeviceUuid('not-a-uuid'), false);
  assert.equal(validateRemotePath('/var/data/file.txt'), '/var/data/file.txt');
  assert.throws(() => validateRemotePath('/var/../etc/passwd'));
  assert.throws(() => validateRemotePath('relative'));
  assert.equal(validateContainerName('service_1.release-2'), 'service_1.release-2');
  assert.throws(() => validateContainerName('service;rm -rf'));
  assert.equal(originAllowed('https://ui.example.test', 'ui.example.test', new Set()), true);
  assert.equal(
    originAllowed('https://admin.example.test', 'ui.example.test', new Set(['https://admin.example.test'])),
    true,
  );
  assert.equal(originAllowed('https://evil.example.test', 'ui.example.test', new Set()), false);
  assert.match(contentDisposition('/var/data/report "one".txt'), /^attachment;/);
});

test('single HTTP ranges support bounded, open, and suffix forms', () => {
  assert.deepEqual(parseSingleRange(undefined, 100), undefined);
  assert.deepEqual(parseSingleRange('bytes=10-19', 100), { start: 10, end: 19 });
  assert.deepEqual(parseSingleRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseSingleRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.throws(() => parseSingleRange('bytes=100-101', 100));
  assert.throws(() => parseSingleRange('bytes=0-1,3-4', 100));
});

test('terminal protocol parses typed controls and frames binary channel data', () => {
  assert.deepEqual(parseControlMessage('{"v":1,"type":"resize","channel":7,"cols":80,"rows":24}'), {
    v: 1,
    type: 'resize',
    channel: 7,
    cols: 80,
    rows: 24,
  });
  assert.throws(() =>
    parseControlMessage(
      '{"v":1,"type":"open","channel":1,"target":"container","container":"x;id","cols":80,"rows":24}',
    ),
  );
  const framed = encodeChannelData(42, Buffer.from('hello'));
  assert.deepEqual(decodeChannelData(framed), { channel: 42, payload: Buffer.from('hello') });
  assert.throws(() => decodeChannelData(Buffer.alloc(4)));
});

test('tickets are origin-bound, short lived, and single use', () => {
  const tickets = new TicketStore(10_000);
  const identity = { userId: 1, username: 'alice', token: 'token' };
  const issued = tickets.issue(identity, 'a'.repeat(32), 'https://ui.example.test');
  assert.equal(tickets.consume(issued.ticket, 'https://other.example.test'), undefined);
  const second = tickets.issue(identity, 'a'.repeat(32), 'https://ui.example.test');
  assert.equal(tickets.consume(second.ticket, 'https://ui.example.test')?.identity.username, 'alice');
  assert.equal(tickets.consume(second.ticket, 'https://ui.example.test'), undefined);
});

test('operation quotas release idempotently', () => {
  const quota = new OperationQuota(1);
  const release = quota.acquire(7);
  assert.throws(() => quota.acquire(7));
  release();
  release();
  quota.acquire(7)();
});

test('configured host-key pins still reject mismatches in compatibility mode', () => {
  const key = Buffer.from('host-key');
  const matchingFingerprint = sshFingerprint(key);
  const config = loadRemoteAccessConfig({
    OPEN_BALENA_TUNNEL_URL: 'https://tunnel.internal',
    OPEN_BALENA_POSTGREST_URL: 'http://postgrest:3000/',
    REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test/',
    OPEN_BALENA_SSH_HOST_KEYS: `device=${matchingFingerprint}`,
    OPEN_BALENA_SSH_ALLOW_UNVERIFIED_HOST_KEYS: 'true',
  });
  assert.equal(hostKeyVerifier(config, 'device')(key), true);
  assert.equal(hostKeyVerifier(config, 'device')(Buffer.from('other-key')), false);
  config.hostKeys.clear();
  assert.equal(hostKeyVerifier(config, 'device')(Buffer.from('other-key')), true);
});

test('Ed25519 key manager reuses, refcounts, and removes registered keys', async (t) => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ method: string; url: string; body?: string }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url: String(input), body: init?.body as string | undefined });
    if (init?.method === 'POST') {
      return new Response(JSON.stringify([{ id: 99 }]), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (!init?.method || init.method === 'GET') {
      return Response.json([]);
    }
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const generated = generateEd25519SshKey();
  assert.match(generated.publicKey, /^ssh-ed25519 /);
  assert.match(generated.privateKey, /BEGIN OPENSSH PRIVATE KEY/);
  const parsed = sshUtils.parseKey(generated.privateKey);
  assert.ok(!(parsed instanceof Error) && !Array.isArray(parsed));
  if (parsed instanceof Error || Array.isArray(parsed)) throw new Error('Expected one supported SSH key.');
  assert.equal(parsed.type, 'ssh-ed25519');
  assert.equal(parsed.getPublicSSH().toString('base64'), generated.publicKey.split(' ')[1]);
  const authenticationPayload = Buffer.from('SSH public-key authentication regression test');
  const signature = parsed.sign(authenticationPayload);
  assert.ok(Buffer.isBuffer(signature));
  if (!Buffer.isBuffer(signature)) throw new Error('Expected an SSH authentication signature.');
  assert.equal(parsed.verify(authenticationPayload, signature), true);

  const manager = new UserSshKeyManager('https://db.example.test', 10);
  const identity = { userId: 7, username: 'alice', token: 'secret-token' };
  const first = await manager.acquire(identity);
  const second = await manager.acquire(identity);
  assert.equal(first.privateKey, second.privateKey);
  assert.equal(calls.filter(({ method }) => method === 'POST').length, 1);
  assert.equal(calls[0].url.includes('secret-token'), false);
  first.release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 0);
  second.release();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 1);
  await manager.shutdown();
});
