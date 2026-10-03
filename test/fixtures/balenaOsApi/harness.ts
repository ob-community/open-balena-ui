import { execFile, execFileSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { Server } from 'node:http';
import { promisify } from 'node:util';
import { createFixtureTransport } from './transport';

export const slugs = [
  'generic-aarch64',
  'generic-amd64',
  'iot-gate-imx8',
  'iot-gate-imx8plus',
  'iot-gate-imx8plus-d1d8',
];
const image = 'balena/open-balena-api:v49.6.5@sha256:44655e08c75967fd087d8ba547ccc99d34e82a7ab47febb219b5ff8674e788ba';
export const metadataCacheLocalTtlMs = 10 * 60 * 1000;
const password = 'SyntheticFixturePassword01';
const email = 'integration@example.invalid';

export class ApiFixture {
  readonly prefix = `balena-os-integration-${randomUUID().slice(0, 8)}`;
  readonly network = `${this.prefix}-internal`;
  private containers: string[] = [];
  private proxy?: Server;
  apiUrl = '';
  postgrestUrl = '';
  sourceUrl = '';
  authorization = '';
  docker(...args: string[]): string {
    return execFileSync('docker', args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    }).trim();
  }
  private run(name: string, args: string[]): void {
    const container = `${this.prefix}-${name}`;
    this.containers.push(container);
    this.docker('run', '-d', '--name', container, '--network', this.network, '--network-alias', name, ...args);
  }
  async start(): Promise<void> {
    this.docker('network', 'create', '--internal', this.network);
    this.run('db', ['-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=fixture', 'postgres:16-alpine']);
    this.run('redis', ['redis:7-alpine']);
    this.run('source', [
      '--mount',
      `type=bind,source=${fileURLToPath(new URL('./source.cjs', import.meta.url))},target=/fixture/source.cjs,readonly`,
      '--entrypoint',
      'node',
      image,
      '/fixture/source.cjs',
    ]);
    // Internal Docker networks intentionally do not publish ports. This
    // loopback-only transport executes HTTP inside the owned source container;
    // it neither emulates API responses nor adds an externally routed network.
    this.proxy = createFixtureTransport(async (payload) => {
      const script =
        "const p=JSON.parse(process.argv[1]);const r=await fetch(p.url,{method:p.method,headers:p.headers,...(p.body?{body:Buffer.from(p.body,'base64')}:{})});console.log(JSON.stringify({status:r.status,headers:Object.fromEntries(r.headers),body:Buffer.from(await r.arrayBuffer()).toString('base64')}));";
      const result = await promisify(execFile)(
        'docker',
        ['exec', `${this.prefix}-source`, 'node', '--input-type=module', '-e', script, JSON.stringify(payload)],
        { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
      );
      return JSON.parse(result.stdout);
    });
    await new Promise<void>((resolve) => this.proxy!.listen(0, '127.0.0.1', resolve));
    const address = this.proxy.address() as { port: number };
    const origin = `http://127.0.0.1:${address.port}`;
    this.sourceUrl = `${origin}/source`;
    this.apiUrl = `${origin}/api`;
    this.postgrestUrl = `${origin}/postgrest`;
    const { privateKey, publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
      privateKeyEncoding: { type: 'sec1', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const env: Record<string, string> = {
      S6_KEEP_ENV: '1',
      PRODUCTION_MODE: 'true',
      NUM_WORKERS: '1',
      PORT: '80',
      TRUST_PROXY: 'true',
      DATABASE_URL: `postgres://postgres:${password}@db:5432/fixture`,
      API_HOST: 'api.fixture.invalid',
      API_VPN_SERVICE_API_KEY: 'fixture-api-vpn',
      COOKIE_SESSION_SECRET: 'fixture-cookie-secret',
      JSON_WEB_TOKEN_SECRET: 'fixture-jwt-secret',
      JSON_WEB_TOKEN_EXPIRY_MINUTES: '60',
      SUPERUSER_EMAIL: email,
      SUPERUSER_PASSWORD: password,
      DELTA_HOST: 'delta.fixture.invalid',
      DEVICE_CONFIG_OPENVPN_CA: Buffer.from('synthetic-unused-ca').toString('base64'),
      VPN_HOST: 'vpn.fixture.invalid',
      VPN_PORT: '443',
      VPN_SERVICE_API_KEY: 'fixture-vpn',
      IMAGE_STORAGE_BUCKET: 'fixture',
      IMAGE_STORAGE_ENDPOINT: 'http://source:8080',
      IMAGE_STORAGE_PREFIX: 'images',
      IMAGE_STORAGE_FORCE_PATH_STYLE: 'true',
      IMAGE_STORAGE_ACCESS_KEY: 'synthetic',
      IMAGE_STORAGE_SECRET_KEY: 'synthetic',
      MIXPANEL_TOKEN: 'synthetic',
      REGISTRY2_HOST: 'registry.fixture.invalid',
      TOKEN_AUTH_BUILDER_TOKEN: 'synthetic',
      TOKEN_AUTH_CERT_ISSUER: 'fixture',
      TOKEN_AUTH_CERT_KEY: Buffer.from(privateKey).toString('base64'),
      TOKEN_AUTH_CERT_PUB: Buffer.from(publicKey).toString('base64'),
      TOKEN_AUTH_CERT_KID: 'synthetic',
      TOKEN_AUTH_JWT_ALGO: 'ES256',
      REDIS_HOST: 'redis:6379',
      REDIS_IS_CLUSTER: 'false',
      CONTRACT_ALLOWLIST: slugs.map((slug) => `hw.device-type/${slug}`).join(','),
      DEVICE_TYPES_CACHE_LOCAL_TIMEOUT: String(metadataCacheLocalTtlMs),
      DEVICE_TYPES_CACHE_TIMEOUT: String(60 * 60 * 1000),
      LOGS_PRIMARY_BACKEND: 'redis',
    };
    // External reference assets use ob-api's unconfigured WebResource handler.
    // Its optional S3 handler would rewrite href to a signed bucket URL.
    this.run('api', [...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]), image]);
    await this.wait(async () => {
      const response = await fetch(`${this.apiUrl}/login_`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: email, password }),
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) throw new Error(`Login ${response.status}: ${await response.text()}`);
      this.authorization = `Bearer ${await response.text()}`;
    }, 120_000);
    // Offline bootstrap only: contracts normally populate these catalog rows.
    // Releases, assets, graph synchronization and cache hooks still use the API.
    this.docker(
      'exec',
      `${this.prefix}-db`,
      'psql',
      '-U',
      'postgres',
      '-d',
      'fixture',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `UPDATE organization SET name='balena_os',handle='balena_os' WHERE handle='admin';
       INSERT INTO "cpu architecture" (slug) VALUES ('amd64'),('aarch64');
       INSERT INTO "device type" (slug,name,"is of-cpu architecture")
       SELECT d.slug,d.slug,a.id FROM (VALUES ${slugs.map((slug) => `('${slug}','${slug === 'generic-amd64' ? 'amd64' : 'aarch64'}')`).join(',')}) AS d(slug,arch)
       JOIN "cpu architecture" a ON a.slug=d.arch;
       INSERT INTO "device type alias" ("device type","is referenced by-alias")
       SELECT id,slug FROM "device type";`,
    );
    this.run('postgrest', [
      '-e',
      `PGRST_DB_URI=postgres://postgres:${password}@db:5432/fixture`,
      '-e',
      'PGRST_DB_SCHEMAS=public',
      '-e',
      'PGRST_DB_ANON_ROLE=postgres',
      'postgrest/postgrest:v12.2.12',
    ]);
    await this.wait(async () => {
      const response = await fetch(`${this.postgrestUrl}/`, { signal: AbortSignal.timeout(2000) });
      if (!response.ok) throw new Error(`PostgREST ${response.status}`);
    }, 30_000);
  }
  async wait(action: () => Promise<void>, timeout: number): Promise<void> {
    const deadline = Date.now() + timeout;
    let error: unknown;
    while (Date.now() < deadline) {
      try {
        await action();
        return;
      } catch (value) {
        error = value;
      }
      if (
        this.containers.includes(`${this.prefix}-api`) &&
        this.docker('inspect', '-f', '{{.State.Running}}', `${this.prefix}-api`) === 'false'
      ) {
        throw new Error(`Fixture API exited during readiness:\n${this.logs()}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Fixture readiness timed out: ${String(error)}\n${this.logs()}`);
  }
  logs(): string {
    try {
      return this.docker('logs', '--tail', '60', `${this.prefix}-api`);
    } catch {
      return 'API logs unavailable';
    }
  }
  async request(resource: string, method = 'GET', body?: unknown, authorization = this.authorization): Promise<any> {
    const response = await fetch(`${this.apiUrl}/v7/${resource}`, {
      method,
      headers: { 'Authorization': authorization, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${resource}: ${response.status} ${text}`);
    return text ? JSON.parse(text) : undefined;
  }
  async records(resource: string): Promise<any[]> {
    const value = await this.request(resource);
    return value.d ?? value.value;
  }
  async assetReadOnlyAuthorization(): Promise<string> {
    const response = await fetch(`${this.apiUrl}/api-key/user/full`, {
      method: 'POST',
      headers: { 'Authorization': this.authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'synthetic-asset-read-only' }),
    });
    if (!response.ok) throw new Error(`Fixture API key creation failed: ${response.status} ${await response.text()}`);
    const key = await response.json();
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(key)) throw new Error('Unexpected fixture API key format.');
    // Credential bootstrap only: restrict a normally issued synthetic API key.
    // Its UPDATE permission deliberately matches no row, exercising canAccess's
    // explicit empty-result PermissionError rather than invalid-token middleware.
    this.docker(
      'exec',
      `${this.prefix}-db`,
      'psql',
      '-U',
      'postgres',
      '-d',
      'fixture',
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      `INSERT INTO role (name) VALUES ('fixture-asset-read-only');
       INSERT INTO permission (name) VALUES
         ('resin.release_asset.read'),
         ('resin.release_asset.update?id eq 0') ON CONFLICT (name) DO NOTHING;
       INSERT INTO "role-has-permission" (role,permission)
       SELECT r.id,p.id FROM role r CROSS JOIN permission p
       WHERE r.name='fixture-asset-read-only'
         AND p.name IN ('resin.release_asset.read','resin.release_asset.update?id eq 0');
       UPDATE "api key-has-role" SET role=(SELECT id FROM role WHERE name='fixture-asset-read-only')
       WHERE "api key"=(SELECT id FROM "api key" WHERE key='${key}');`,
    );
    return `Bearer ${key}`;
  }
  cleanup(): void {
    this.proxy?.closeAllConnections();
    this.proxy?.close();
    for (const container of this.containers.reverse()) {
      try {
        this.docker('rm', '-f', '-v', container);
      } catch {
        /* Already removed. */
      }
    }
    try {
      this.docker('network', 'rm', this.network);
    } catch {
      /* Startup may not have created it. */
    }
  }
}
