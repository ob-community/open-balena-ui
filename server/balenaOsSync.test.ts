import assert from 'node:assert/strict';
import test from 'node:test';
import { BalenaOsSyncManager, expandBalenaOsRevisionChain, selectBalenaOsReleases } from './balenaOsSync';
import { PERMISSION_HINT } from '../src/lib/httpErrorMessage';

const response = (body: unknown, status = 200): Response =>
  new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const localRelationId = (value: unknown): number =>
  Number(value && typeof value === 'object' && '__id' in value ? value.__id : value);

test('synchronization 401 errors retain sign-in advice and include permission guidance', async () => {
  const manager = new BalenaOsSyncManager({
    fetch: async () => response({ message: 'Unauthorized' }, 401),
    apiUrl: () => 'https://api.example.test',
    apiVersion: () => 'v7',
    apiSoftwareVersion: () => 'v49.6.5',
    catalogApiUrl: () => 'https://catalog.example.test',
    registryHost: () => undefined,
  });
  await assert.rejects(manager.getBalenaOsOrganizationId('Bearer test'), {
    message: `Synchronization authorization expired or was rejected; sign in again and re-run to resume. ${PERMISSION_HINT}`,
  });
});

test('selects full, latest, threshold, in-use, and single-version synchronization scopes', () => {
  const releases = ['2.107.0-1234567890', '5.0.0', '6.4.0+rev1', '6.5.0', '6.5.0+rev1', '6.5.0+rev2', '6.6.0'].map(
    (raw_version) => ({ raw_version, is_invalidated: false }),
  );
  releases.push({ raw_version: '2026.1.0', is_invalidated: true });
  const selected = (mode: Parameters<typeof selectBalenaOsReleases>[1], inUse: string[] = []) =>
    selectBalenaOsReleases(releases, mode, inUse).map(({ raw_version }) => raw_version);

  assert.deepEqual(
    selected({ mode: 'all' }),
    releases.slice(0, -1).map(({ raw_version }) => raw_version),
  );
  assert.deepEqual(
    selected({ mode: 'all' }, ['balenaOS 2026.1.0']),
    releases.map(({ raw_version }) => raw_version),
  );
  assert.deepEqual(selected({ mode: 'latest-and-in-use' }, ['balenaOS 5.0.0', 'balenaOS 2026.1.0']), [
    '5.0.0',
    '6.6.0',
    '2026.1.0',
  ]);
  assert.deepEqual(selected({ mode: 'single', version: '2026.1.0' }), []);
  assert.deepEqual(selected({ mode: 'single', version: '2026.1.0' }, ['balenaOS 2026.1.0']), ['2026.1.0']);
  assert.deepEqual(selected({ mode: 'in-use' }, ['balenaOS 2026.1.0']), ['2026.1.0']);
  assert.deepEqual(selected({ mode: 'in-use' }, ['balenaOS 2.107.0-1234567890']), ['2.107.0-1234567890']);
  assert.deepEqual(selected({ mode: 'in-use' }, ['balenaOS 6.4.0']), ['6.4.0+rev1']);
  assert.deepEqual(selected({ mode: 'single', version: '6.5.0' }), ['6.5.0', '6.5.0+rev1', '6.5.0+rev2']);
  assert.deepEqual(selected({ mode: 'single', version: '6.5.0+rev1' }), ['6.5.0+rev1']);
  assert.deepEqual(selected({ mode: 'newer-and-in-use', version: '6.5.0' }, ['balenaOS 5.0.0']), [
    '5.0.0',
    '6.5.0+rev1',
    '6.5.0+rev2',
    '6.6.0',
  ]);
  assert.deepEqual(selected({ mode: 'newer-and-in-use', version: '6.5.0+rev1' }), ['6.5.0+rev2', '6.6.0']);
});

test('includes prior release revisions required by open-balena-api', () => {
  const releases = [
    { id: 1, raw_version: '8.0.9', revision: 0, variant: '', is_invalidated: false },
    { id: 2, raw_version: '8.0.9+rev1', revision: 1, variant: '', is_invalidated: false },
    { id: 3, raw_version: '8.0.9+rev2', revision: 2, variant: '', is_invalidated: false },
    { id: 4, raw_version: '8.0.8', revision: 0, variant: '', is_invalidated: false },
  ];
  assert.deepEqual(
    expandBalenaOsRevisionChain(releases, new Set([3])).map(({ id }) => id),
    [1, 2, 3],
  );
  assert.throws(
    () => expandBalenaOsRevisionChain([{ ...releases[2], id: 5 }], new Set([5])),
    /requires unavailable non-invalidated revision 0/,
  );
});

const metadataSyncFixture = (
  options: {
    allowlist?: string;
    existingAsset?: Record<string, unknown>;
    duplicateAssets?: boolean;
    storageError?: string;
    missingHost?: boolean;
    missingRelease?: boolean;
    apiSoftwareVersion?: string;
    previouslySynced?: boolean;
    invalidUpdaterClass?: boolean;
    assetAuthorizationError?: boolean;
    emptyAuthorization?: boolean;
    postgrestError?: boolean;
    postgrestEmptyResponse?: boolean;
    corruptReadback?: boolean;
    cacheNotificationError?: boolean;
    staleMetadata?: boolean;
    metadataError?: boolean;
    metadataRateLimited?: boolean;
    missingPostgrest?: boolean;
    concurrentAsset?: boolean;
    deviceTypes?: string[];
  } = {},
) => {
  const requests: URL[] = [];
  const writes: Array<{ resource: string; method: string; body: Record<string, unknown> }> = [];
  const downloads: Array<{ slug: string; version: string }> = [];
  const asset = {
    filename: 'device-type.json',
    href: `https://ui.openbalena.test/balena-os/device-types/generic-amd64/9.0.0/${'a'.repeat(64)}/device-type.json`,
    content_type: 'application/json',
    size: 42,
    checksum: 'a'.repeat(64),
  };
  const sourceRelease = (id: number, version: string) => ({
    id,
    commit: `commit-${id}`,
    raw_version: version,
    semver: version,
    status: 'success',
    is_final: true,
    is_invalidated: false,
    revision: 0,
    variant: '',
    composition: {},
  });
  const localRecords = new Map<string, Array<Record<string, unknown>>>();
  const assets = options.existingAsset ? [{ ...options.existingAsset }] : [];
  if (options.duplicateAssets) assets.push({ ...options.existingAsset, id: 301 });
  localRecords.set('release_asset', assets);
  if (options.previouslySynced) {
    localRecords.set(
      'application',
      [
        { id: 30, uuid: 'host', app_name: 'generic-amd64', slug: 'balena_os/generic-amd64', is_host: true },
        { id: 40, uuid: 'updater', app_name: 'balenahup', slug: 'balena_os/balenahup', is_host: false },
      ].map((application) => ({
        ...application,
        organization: 9,
        application_type: 1,
        is_for__device_type: 1,
        is_public: true,
        is_archived: false,
        should_track_latest_release: true,
        is_of__class: application.is_host || options.invalidUpdaterClass ? 'app' : 'block',
        ...(application.is_host ? {} : { should_be_running__release: 400 }),
      })),
    );
    localRecords.set(
      'release',
      [
        { source: sourceRelease(100, '7.0.0'), id: 301, application: 30 },
        { source: sourceRelease(101, '8.0.0'), id: 302, application: 30 },
        { source: sourceRelease(900, '9.0.0'), id: 300, application: 30 },
        { source: sourceRelease(200, '4.0.0'), id: 400, application: 40 },
      ].map(({ source, id, application }) => ({
        ...source,
        id,
        belongs_to__application: application,
        source: 'cloud',
        release_version: null,
        contract: null,
        is_passing_tests: true,
        is_finalized_at__date: null,
        phase: null,
        known_issue_list: null,
        note: null,
        invalidation_reason: null,
      })),
    );
  }
  let nextId = 1000;
  let apiAuthorization: string | null = null;
  const manager = new BalenaOsSyncManager({
    fetch: async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      const resource = decodeURIComponent(url.pathname.split('/').pop()!);
      const method = init?.method ?? 'GET';
      if (url.origin === 'https://api.openbalena.test') {
        apiAuthorization = new Headers(init?.headers).get('Authorization');
      }
      if (url.pathname === '/device-types/v1') {
        if (options.metadataRateLimited) {
          const limited = response({ message: 'Rate limited' }, 429);
          limited.headers.set('Retry-After', '999');
          return limited;
        }
        if (options.metadataError) return response({ message: 'Metadata fetch blocked' }, 503);
        return response(
          downloads.map(({ slug, version }) => ({ slug, buildId: options.staleMetadata ? '1.0.0' : version })),
        );
      }
      if (resource === 'canAccess') {
        assert.equal(method, 'POST');
        assert.deepEqual(JSON.parse(String(init?.body)), { method: 'PATCH' });
        if (options.assetAuthorizationError && url.pathname.includes('/release_asset(')) {
          return response({ message: 'Asset write denied' }, 403);
        }
        const id = Number(/\((\d+)\)\/canAccess$/.exec(url.pathname)?.[1]);
        return response({ d: options.emptyAuthorization ? [] : [{ id }] });
      }
      if (method !== 'GET') {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        writes.push({ resource, method, body });
        if (url.origin === 'https://postgrest.openbalena.test') {
          assert.equal(resource, 'release asset');
          assert.equal(method, 'PATCH');
          assert.deepEqual(Object.keys(body), ['asset']);
          assert.equal(new Headers(init?.headers).get('Prefer'), 'return=representation');
          assert.ok(apiAuthorization);
          assert.equal(new Headers(init?.headers).get('Authorization'), apiAuthorization);
          if (options.postgrestError) return response({ message: 'PostgREST denied write' }, 403);
          const id = Number(url.searchParams.get('id')?.slice(3));
          const release = Number(url.searchParams.get('release')?.slice(3));
          assert.equal(url.searchParams.get('asset key'), 'eq.device-type.json');
          const row = assets.find((record) => record.id === id && localRelationId(record.release) === release);
          if (!row || options.postgrestEmptyResponse) return response([]);
          row.asset = body.asset;
          return response([{ ...row, 'asset key': row.asset_key }]);
        }
        if (resource.startsWith('release_asset')) {
          if ('asset' in body) return response({ message: 'Use multipart requests to upload a file.' }, 400);
          if (options.assetAuthorizationError) return response({ message: 'Asset write denied' }, 403);
          if (method === 'POST') {
            const row = { ...body, id: nextId++ };
            assets.push(row);
            if (options.concurrentAsset) return response({ message: 'Concurrent asset creation' }, 409);
            return response({ d: [row] }, 201);
          }
          return response(undefined, 204);
        }
        if (resource.startsWith('application(') && Object.keys(body).length === 1 && body.is_host === true) {
          if (options.cacheNotificationError) return response({ message: 'Cache notification denied' }, 403);
          return response(undefined, 204);
        }
        if (options.previouslySynced) {
          const name = resource.split('(')[0];
          const records = localRecords.get(name) ?? [];
          const id = method === 'POST' ? nextId++ : Number(/\((\d+)\)/.exec(resource)?.[1]);
          const existing = records.find((record) => record.id === id);
          if (existing) Object.assign(existing, body);
          else records.push({ ...body, id });
          localRecords.set(name, records);
          return response({ d: [{ ...body, id }] }, method === 'POST' ? 201 : 200);
        }
        return response({ d: [{ ...body, id: nextId++ }] }, 201);
      }
      const filter = url.searchParams.get('$filter') ?? '';
      if (url.origin === 'https://catalog.test') {
        if (resource === 'application') {
          const updater = filter.includes('balenahup');
          return response({
            d: [
              {
                id: updater ? 20 : 10,
                uuid: updater ? 'updater' : 'host',
                slug: updater ? 'balena_os/balenahup' : 'balena_os/generic-amd64',
                app_name: updater ? 'balenahup' : 'generic-amd64',
                is_host: !updater,
              },
            ],
          });
        }
        if (resource === 'release') {
          return response({
            d: filter.includes('20')
              ? [sourceRelease(200, '4.0.0')]
              : [sourceRelease(100, '7.0.0'), sourceRelease(101, '8.0.0')],
          });
        }
        return response({ d: [] });
      }
      if (resource === 'organization') return response({ d: [{ id: 9, name: 'balena_os' }] });
      if (resource === 'application_type') return response({ d: [{ id: 1, slug: 'default' }] });
      if (resource === 'device_type') {
        return response({
          d: (options.deviceTypes ?? ['generic-amd64', 'excluded-board']).map((slug, index) => ({
            id: index + 1,
            slug,
          })),
        });
      }
      if (resource === 'application' && filter.includes('application_tag')) {
        const id = 29 + Number(/device_type eq (\d+)/.exec(filter)?.[1]);
        return response({ d: options.missingHost ? [] : [{ id, slug: 'balena_os/generic-amd64' }] });
      }
      if (resource === 'release' && url.searchParams.get('$orderby')?.startsWith('semver_major desc')) {
        const id = 300 + (Number(/application eq (\d+)/.exec(filter)?.[1]) - 30) * 10;
        return response({ d: options.missingRelease ? [] : [{ id, raw_version: '9.0.0' }] });
      }
      if (resource === 'release_asset') {
        const release = Number(/release eq (\d+)/.exec(filter)?.[1]);
        const records = options.duplicateAssets
          ? assets
          : assets.filter((row) => localRelationId(row.release) === release);
        return response({
          d: records.map((row) =>
            options.corruptReadback && row.asset ? { ...row, asset: { href: 'https://wrong.test' } } : row,
          ),
        });
      }
      if (options.previouslySynced && localRecords.has(resource)) {
        const conditions = [...filter.matchAll(/(\w+) eq (?:'([^']*)'|(\d+))/g)];
        return response({
          d: localRecords
            .get(resource)!
            .filter((record) =>
              conditions.every(([, field, text, number]) => record[field] === (text ?? Number(number))),
            ),
        });
      }
      return response({ d: [] });
    },
    apiUrl: () => 'https://api.openbalena.test',
    apiVersion: () => 'v7',
    apiSoftwareVersion: () => options.apiSoftwareVersion ?? 'v49.6.0',
    catalogApiUrl: () => 'https://catalog.test',
    registryHost: () => 'registry.openbalena.test',
    postgrestUrl: () => (options.missingPostgrest ? undefined : 'https://postgrest.openbalena.test'),
    contractAllowlist: () => options.allowlist ?? 'arch.sw/amd64;hw.device-type/generic-amd64',
    metadataVerificationTimeoutMs: 30,
    metadataVerificationPollIntervalMs: 1,
    setHostAppUpdaterRelation: async () => {},
    storeDeviceTypeMetadata: async (slug, version) => {
      downloads.push({ slug, version });
      if (options.storageError) throw new Error(options.storageError);
      return { ...asset, href: asset.href.replace('generic-amd64', slug) };
    },
  });
  const run = async () => {
    manager.start('Bearer local-only', 9, { mode: 'single', version: '7.0.0' });
    for (let attempt = 0; attempt < 100 && manager.getStatus().state === 'running'; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    return manager.getStatus();
  };
  return { manager, requests, writes, downloads, asset, assets, run };
};

test('syncs local config metadata for the API-selected release and filters CONTRACT_ALLOWLIST', async () => {
  const fixture = metadataSyncFixture();
  assert.equal((await fixture.run()).state, 'completed');
  assert.deepEqual(fixture.downloads, [{ slug: 'generic-amd64', version: '9.0.0' }]);
  assert.deepEqual(fixture.writes.find(({ resource }) => resource === 'release_asset')?.body, {
    release: 300,
    asset_key: 'device-type.json',
  });
  assert.deepEqual(fixture.writes.find(({ resource }) => resource === 'release asset')?.body, {
    asset: fixture.asset,
  });
  assert.equal(
    fixture.writes.find(({ resource, body }) => resource === 'application' && body.uuid === 'updater')?.body
      .is_of__class,
    'block',
  );
  assert.equal(
    fixture.requests.some((url) => String(url).includes('excluded-board')),
    false,
  );
  const releaseVersions = fixture.writes
    .filter(({ resource, body }) => resource === 'release' && body.belongs_to__application !== undefined)
    .map(({ body }) => body.semver);
  assert.ok(releaseVersions.includes('7.0.0'));
  assert.ok(releaseVersions.includes('8.0.0'), 'narrow sync also bootstraps latest config metadata release');
  const query = fixture.requests.find((url) => url.searchParams.get('$orderby')?.startsWith('semver_major desc'));
  assert.match(query?.searchParams.get('$filter') ?? '', /is_final eq true.*is_invalidated eq false/);
  assert.match(query?.searchParams.get('$filter') ?? '', /semver_major gt 0.*semver_major lt 2000/);
  assert.equal(fixture.manager.getStatus().processed, fixture.manager.getStatus().total);
});

test('keeps an identical release asset unchanged and repairs an upstream asset reference', async () => {
  const unchanged = metadataSyncFixture();
  const existingAsset = { id: 400, release: { __id: 300 }, asset_key: 'device-type.json', asset: unchanged.asset };
  const identical = metadataSyncFixture({ existingAsset });
  assert.equal((await identical.run()).state, 'completed');
  assert.equal(
    identical.writes.some(({ resource }) => resource.startsWith('release_asset')),
    false,
  );
  const repaired = metadataSyncFixture({
    existingAsset: { ...existingAsset, asset: { ...unchanged.asset, href: 'https://upstream.test/device-type.json' } },
  });
  assert.equal((await repaired.run()).state, 'completed');
  assert.equal(
    repaired.requests.some((url) => url.pathname === '/v7/release_asset(400)/canAccess'),
    true,
  );
  assert.deepEqual(repaired.writes.find(({ resource }) => resource === 'release asset')?.body, {
    asset: unchanged.asset,
  });
});

test('resync backfills assets on previously synced releases without recreating their graph', async () => {
  const fixture = metadataSyncFixture({ previouslySynced: true });
  const first = await fixture.run();
  assert.equal(first.state, 'completed');
  assert.equal(first.created, 1);
  assert.ok(first.unchanged > 0, 'existing applications and releases pass through the unchanged path');
  assert.equal(fixture.writes.filter(({ resource }) => resource === 'release_asset').length, 1);
  assert.equal(fixture.writes.filter(({ resource }) => resource === 'release asset').length, 1);
  assert.equal(
    fixture.writes.some(({ resource }) => resource === 'release' || resource === 'application'),
    false,
  );
  assert.equal(fixture.writes[0].body.release, 300, 'backfills the already-local newest release');
  assert.deepEqual(fixture.downloads, [{ slug: 'generic-amd64', version: '9.0.0' }]);
  const writesBeforeResync = fixture.writes.length;
  const second = await fixture.run();
  assert.equal(second.state, 'completed');
  assert.equal(second.created, 0);
  assert.deepEqual(
    fixture.writes.slice(writesBeforeResync),
    [{ resource: 'application(30)', method: 'PATCH', body: { is_host: true } }],
    'repeated sync only refreshes the API cache and does not duplicate the asset or graph',
  );
  assert.equal(second.processed, second.total);
});

test('repairs a previously imported updater class before refreshing Host OS metadata', async () => {
  const fixture = metadataSyncFixture({ previouslySynced: true, invalidUpdaterClass: true });
  assert.equal((await fixture.run()).state, 'completed');
  assert.deepEqual(fixture.writes.find(({ resource }) => resource === 'application(40)')?.body, {
    is_of__class: 'block',
  });
});

test('maintains metadata for every allowlisted device type, not just one gateway type', async () => {
  const fixture = metadataSyncFixture({ allowlist: 'hw.device-type/generic-amd64;hw.device-type/excluded-board' });
  assert.equal((await fixture.run()).state, 'completed');
  assert.deepEqual(
    fixture.downloads.map(({ slug }) => slug),
    ['generic-amd64', 'excluded-board'],
  );
  assert.equal(fixture.writes.filter(({ resource }) => resource === 'release_asset').length, 2);
});

test('persists and verifies all five deployment device types before notifying API metadata caches', async () => {
  const deviceTypes = [
    'generic-aarch64',
    'generic-amd64',
    'iot-gate-imx8',
    'iot-gate-imx8plus',
    'iot-gate-imx8plus-d1d8',
  ];
  const fixture = metadataSyncFixture({
    deviceTypes,
    allowlist: deviceTypes.map((slug) => `hw.device-type/${slug}`).join(';'),
  });
  assert.equal((await fixture.run()).state, 'completed');
  assert.deepEqual(
    fixture.downloads.map(({ slug }) => slug),
    deviceTypes,
  );
  assert.equal(fixture.assets.length, 5);
  assert.equal(
    fixture.assets.every((row) => row.asset_key === 'device-type.json' && row.asset),
    true,
  );
  const lastDatabaseWrite = fixture.writes.reduce(
    (last, { resource }, index) => (resource === 'release asset' ? index : last),
    -1,
  );
  const notifications = fixture.writes.flatMap(({ resource, body }, index) =>
    resource.startsWith('application(') && body.is_host === true && Object.keys(body).length === 1 ? [index] : [],
  );
  assert.equal(notifications.length, 5);
  assert.equal(
    notifications.every((index) => index > lastDatabaseWrite),
    true,
  );
  assert.equal(
    fixture.requests.some((url) => url.pathname === '/device-types/v1'),
    true,
  );
});

test('never uses PostgREST after an OData asset authorization denial', async () => {
  for (const existingAsset of [
    undefined,
    { id: 400, release: 300, asset_key: 'device-type.json', asset: { href: 'https://upstream.test' } },
  ]) {
    const fixture = metadataSyncFixture({ assetAuthorizationError: true, existingAsset });
    const status = await fixture.run();
    assert.equal(status.state, 'failed');
    assert.match(status.error ?? '', /403.*Asset write denied/);
    assert.equal(
      fixture.requests.some((url) => url.origin === 'https://postgrest.openbalena.test'),
      false,
    );
  }
});

test('an empty successful canAccess response does not authorize a PostgREST write', async () => {
  const fixture = metadataSyncFixture({ emptyAuthorization: true });
  const status = await fixture.run();
  assert.equal(status.state, 'failed');
  assert.match(status.error ?? '', /did not confirm write access/);
  assert.equal(
    fixture.requests.some((url) => url.origin === 'https://postgrest.openbalena.test'),
    false,
  );
});

test('fails closed on missing PostgREST, denied or empty writes, and corrupt OData read-back', async () => {
  for (const options of [
    { missingPostgrest: true },
    { postgrestError: true },
    { postgrestEmptyResponse: true },
    { corruptReadback: true },
    { allowlist: 'hw.device-type/generic-amd64;hw.device-type/missing-board' },
  ]) {
    const fixture = metadataSyncFixture(options);
    const status = await fixture.run();
    assert.equal(status.state, 'failed');
    assert.match(status.error ?? '', /POSTGREST_URL|403.*PostgREST denied|did not persist|read-back|missing-board/);
    assert.equal(
      fixture.requests.some((url) => url.pathname === '/device-types/v1'),
      false,
    );
  }
});

test('resumes an OData placeholder after failed reference persistence without creating a duplicate', async () => {
  const options = { postgrestError: true, previouslySynced: true };
  const fixture = metadataSyncFixture(options);
  assert.equal((await fixture.run()).state, 'failed');
  assert.equal(fixture.assets.length, 1);
  options.postgrestError = false;
  assert.equal((await fixture.run()).state, 'completed');
  assert.equal(fixture.assets.length, 1);
  assert.equal(
    fixture.writes.filter(({ resource, method }) => resource === 'release_asset' && method === 'POST').length,
    1,
  );
});

test('reconciles a concurrently created unique release asset through API authorization', async () => {
  const fixture = metadataSyncFixture({ concurrentAsset: true });
  assert.equal((await fixture.run()).state, 'completed');
  assert.equal(fixture.assets.length, 1);
  assert.equal(
    fixture.requests.some((url) => url.pathname.includes('/release_asset(') && url.pathname.endsWith('/canAccess')),
    true,
  );
});

test('retries cache notification after failure even when metadata references are already identical', async () => {
  const options = { cacheNotificationError: true, previouslySynced: true };
  const fixture = metadataSyncFixture(options);
  assert.equal((await fixture.run()).state, 'failed');
  const databaseWrites = fixture.writes.filter(({ resource }) => resource === 'release asset').length;
  options.cacheNotificationError = false;
  assert.equal((await fixture.run()).state, 'completed');
  assert.equal(fixture.writes.filter(({ resource }) => resource === 'release asset').length, databaseWrites);
});

test('does not report completed sync when API metadata remains stale or an upstream fill is blocked', async () => {
  for (const options of [{ staleMetadata: true }, { metadataError: true }, { metadataRateLimited: true }]) {
    const fixture = metadataSyncFixture(options);
    const status = await fixture.run();
    assert.equal(status.state, 'failed');
    assert.match(status.error ?? '', /ob-api metadata refresh did not complete.*restart the affected ob-api/);
    assert.equal(fixture.assets.length, 1);
  }
});

test('enables release-asset coverage at v46.1 without broadening older synchronization scopes', async () => {
  for (const version of ['v46.0.24', 'v46.1.0']) {
    const fixture = metadataSyncFixture({ apiSoftwareVersion: version });
    assert.equal((await fixture.run()).state, 'completed');
    const hasMetadata = version === 'v46.1.0';
    assert.equal(fixture.downloads.length, hasMetadata ? 1 : 0);
    assert.equal(
      fixture.writes.some(({ resource, body }) => resource === 'release' && body.semver === '8.0.0'),
      hasMetadata,
    );
  }
});

test('fails metadata sync explicitly when local coverage or durable storage is unavailable', async () => {
  for (const options of [
    { missingHost: true },
    { missingRelease: true },
    { storageError: 'MinIO write failed' },
    { existingAsset: { id: 400 }, duplicateAssets: true },
  ]) {
    const fixture = metadataSyncFixture(options);
    const status = await fixture.run();
    assert.equal(status.state, 'failed');
    assert.match(status.error ?? '', /Host OS application|Host OS release|MinIO write failed|duplicate/);
    assert.equal(
      fixture.writes.some(({ resource }) => resource.startsWith('release_asset')),
      false,
    );
  }
});

test('synchronizes a complete Host OS release graph through open-balena-api', async () => {
  const writes: Array<{ resource: string; method: string; body: Record<string, unknown> }> = [];
  const updaterRelations: Array<{ hostApplicationId: number; updaterApplicationId: number }> = [];
  const requests: URL[] = [];
  const ids: Record<string, number> = {
    application: 10,
    service: 20,
    release: 30,
    image: 40,
    release_image: 50,
    image_label: 60,
  };

  const fetchMock: typeof fetch = async (input, init) => {
    assert.doesNotMatch(String(input), /%2C/i);
    const url = new URL(String(input));
    requests.push(url);
    const method = init?.method ?? 'GET';
    const isCatalog = url.origin === 'https://api.balena-cloud.test';

    if (url.pathname === '/device-types/v1/generic-amd64/images') {
      return response({ versions: ['6.0.0'] });
    }
    if (isCatalog && url.pathname === '/v6/application') {
      if (url.searchParams.get('$filter')?.includes('balena_os/balenahup')) {
        return response({
          d: [
            {
              id: 101,
              uuid: 'cloud-updater-uuid',
              app_name: 'balenahup',
              slug: 'balena_os/balenahup',
              is_host: false,
              is_public: true,
              is_of__class: 'app',
            },
          ],
        });
      }
      return response({
        d: [
          {
            id: 100,
            uuid: 'cloud-host-uuid',
            app_name: 'generic-amd64',
            slug: 'balena_os/generic-amd64',
            is_host: true,
            is_public: true,
            is_of__class: 'app',
          },
        ],
      });
    }
    if (isCatalog && url.pathname === '/v6/service') {
      if (url.searchParams.get('$filter')?.includes('101')) {
        return response({ d: [{ id: 201, service_name: 'main', application: { __id: 101 } }] });
      }
      return response({ d: [{ id: 200, service_name: 'hostapp', application: { __id: 100 } }] });
    }
    if (isCatalog && url.pathname === '/v6/release') {
      if (url.searchParams.get('$filter')?.includes('101')) {
        return response({
          d: [
            {
              id: 302,
              commit: 'updater-release-commit',
              composition: '{"services":{"main":{"image":"balenahup:latest"}}}',
              status: 'success',
              source: 'cloud',
              is_invalidated: false,
              raw_version: '4.1.19',
              semver: '4.1.19',
              variant: '',
              revision: 0,
            },
          ],
        });
      }
      return response({
        d: [
          {
            id: 300,
            commit: 'host-release-commit',
            composition:
              '{"services":{"hostapp":{"image":"hostapp:latest","labels":{"io.balena.image.class":"hostapp","io.balena.image.store":"root","io.balena.update.requires-reboot":"1","io.balena.private.hostapp.board-rev":"test-board"}}}}',
            contract: '{"type":"sw.block","requires":[]}',
            status: 'success',
            source: 'cloud',
            is_invalidated: false,
            start_timestamp: '2026-01-01T00:00:00.000Z',
            end_timestamp: '2026-01-01T00:01:00.000Z',
            is_passing_tests: true,
            is_finalized_at__date: '2026-01-01T00:01:00.000Z',
            raw_version: '6.0.0',
            semver: '6.0.0',
            variant: '',
            revision: 0,
          },
          {
            id: 301,
            commit: 'invalid-esr-looking-release',
            status: 'success',
            is_final: true,
            is_invalidated: true,
            raw_version: '2026.1.0',
            semver: '2026.1.0',
            variant: '',
            revision: 0,
          },
        ],
      });
    }
    if (isCatalog && url.pathname === '/v6/image') {
      if (url.searchParams.get('$filter')?.includes('401')) {
        return response({
          d: [
            {
              id: 401,
              is_a_build_of__service: { __id: 201 },
              image_size: 456,
              is_stored_at__image_location: 'registry2.balena-cloud.com/v2/updater-image',
              status: 'success',
              content_hash: 'sha256:updater',
            },
          ],
        });
      }
      return response({
        d: [
          {
            id: 400,
            start_timestamp: '2026-01-01T00:00:00.000Z',
            end_timestamp: '2026-01-01T00:01:00.000Z',
            is_a_build_of__service: { __id: 200 },
            image_size: 123,
            is_stored_at__image_location: 'registry2.balena-cloud.com/v2/cloud-image',
            push_timestamp: '2026-01-01T00:01:00.000Z',
            status: 'success',
            content_hash: 'sha256:abc',
            contract: '{"type":"sw.container"}',
          },
        ],
      });
    }
    if (isCatalog && url.pathname === '/v6/release_image') {
      if (url.searchParams.get('$filter')?.includes('302')) {
        return response({ d: [{ id: 501, image: { __id: 401 }, is_part_of__release: { __id: 302 } }] });
      }
      return response({ d: [{ id: 500, image: { __id: 400 }, is_part_of__release: { __id: 300 } }] });
    }

    if (method === 'GET' && url.pathname === '/v7/device_type') {
      return response({ d: [{ id: 1, slug: 'generic-amd64' }] });
    }
    if (method === 'GET' && url.pathname === '/v7/device') {
      return response({ d: [] });
    }
    if (method === 'GET' && url.pathname === '/v7/organization') {
      return response({ d: [{ id: 9, name: 'System' }] });
    }
    if (method === 'GET' && url.pathname === '/v7/application_type') {
      return response({ d: [{ id: 1, slug: 'default' }] });
    }
    if (method === 'GET' && url.pathname === '/v7/image' && url.searchParams.get('$top') === '1') {
      return response({ d: [{ id: 1, is_stored_at__image_location: 'registry.openbalena.test/v2/existing' }] });
    }
    if (method === 'GET' && url.pathname === '/v7/image') {
      return response({
        d: [
          {
            id: 41,
            start_timestamp: '2026-01-01T00:00:00.000Z',
            end_timestamp: '2026-01-01T00:01:00.000Z',
            dockerfile: null,
            is_a_build_of__service: { __id: 21 },
            image_size: '123',
            is_stored_at__image_location: 'registry.previous.test/v2/cloud-image',
            project_type: null,
            error_message: null,
            push_timestamp: '2026-01-01T00:01:00.000Z',
            status: 'success',
            content_hash: 'sha256:abc',
            contract: { type: 'sw.container' },
          },
        ],
      });
    }
    if (
      method === 'GET' &&
      ['/v7/application', '/v7/service', '/v7/release', '/v7/image', '/v7/release_image', '/v7/image_label'].includes(
        url.pathname,
      )
    ) {
      return response({ d: [] });
    }

    if (method === 'POST') {
      const resource = url.pathname.split('/').pop()!;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push({ resource, method, body });
      const id = ids[resource];
      ids[resource] += 1;
      return response({ d: [{ ...body, id }] }, 201);
    }
    if (method === 'PATCH' && /^\/v7\/(?:application|image)\(\d+\)$/.test(url.pathname)) {
      const resource = url.pathname.split('/').pop()!.split('(')[0];
      writes.push({
        resource,
        method,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response('OK', { status: 200 });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };

  const manager = new BalenaOsSyncManager({
    fetch: fetchMock,
    apiUrl: () => 'https://api.openbalena.test',
    apiVersion: () => 'v7',
    apiSoftwareVersion: () => 'v43.5.4',
    catalogApiUrl: () => 'https://api.balena-cloud.test',
    registryHost: () => 'registry.openbalena.test',
    setHostAppUpdaterRelation: async (_authorization, hostApplicationId, updaterApplicationId) => {
      updaterRelations.push({ hostApplicationId, updaterApplicationId });
    },
  });

  manager.start('Bearer token', 9);
  for (let attempt = 0; attempt < 50 && manager.getStatus().state === 'running'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.deepEqual(manager.getStatus(), {
    state: 'completed',
    phase: 'Complete',
    processed: 16,
    total: 16,
    created: 13,
    updated: 3,
    unchanged: 0,
    mode: 'all',
    version: undefined,
    startedAt: manager.getStatus().startedAt,
    finishedAt: manager.getStatus().finishedAt,
  });
  assert.deepEqual(
    writes.filter(({ method }) => method === 'POST').map(({ resource }) => resource),
    [
      'application',
      'service',
      'release',
      'image',
      'release_image',
      'application',
      'service',
      'release',
      'release_image',
      'image_label',
      'image_label',
      'image_label',
      'image_label',
    ],
  );
  const hostReleaseWrite = writes.find(
    ({ resource, body }) => resource === 'release' && body.commit === 'host-release-commit',
  )!;
  assert.equal('belongs_to__user' in hostReleaseWrite.body, false);
  assert.deepEqual(hostReleaseWrite.body.contract, {
    type: 'sw.block',
    requires: [],
  });
  assert.deepEqual(hostReleaseWrite.body.composition, {
    services: {
      hostapp: {
        image: 'hostapp:latest',
        labels: {
          'io.balena.image.class': 'hostapp',
          'io.balena.image.store': 'root',
          'io.balena.update.requires-reboot': '1',
          'io.balena.private.hostapp.board-rev': 'test-board',
        },
      },
    },
  });
  assert.deepEqual(
    writes.find(({ resource, method }) => resource === 'image' && method === 'PATCH'),
    {
      resource: 'image',
      method: 'PATCH',
      body: {
        is_stored_at__image_location: 'registry.openbalena.test/v2/cloud-image',
      },
    },
  );
  assert.deepEqual(writes.find(({ resource, method }) => resource === 'application' && method === 'PATCH')?.body, {
    should_be_running__release: 30,
  });
  assert.deepEqual(updaterRelations, [{ hostApplicationId: 11, updaterApplicationId: 10 }]);
  assert.deepEqual(
    writes.filter(({ resource }) => resource === 'image_label').map(({ body }) => [body.label_name, body.value]),
    [
      ['io.balena.image.class', 'hostapp'],
      ['io.balena.image.store', 'root'],
      ['io.balena.update.requires-reboot', '1'],
      ['io.balena.private.hostapp.board-rev', 'test-board'],
    ],
  );
  const catalog = await manager.getCatalog('******');
  assert.equal(catalog.deviceTypes[0]?.latestAvailable, '6.0.0');
  assert.equal(
    requests.some(({ pathname }) => pathname === '/device-types/v1/generic-amd64/images'),
    true,
  );

  const modernRequestStart = requests.length;
  const modernManager = new BalenaOsSyncManager({
    fetch: fetchMock,
    apiUrl: () => 'https://api.openbalena.test',
    apiVersion: () => 'v7',
    apiSoftwareVersion: () => 'v49.6.0',
    catalogApiUrl: () => 'https://api.balena-cloud.test',
    registryHost: () => 'registry.openbalena.test',
  });
  const modernCatalog = await modernManager.getCatalog('******');
  assert.deepEqual(modernCatalog.deviceTypes[0], {
    id: 1,
    slug: 'generic-amd64',
    availableVersions: 1,
    localApplications: 0,
    localReleases: 0,
    latestAvailable: '6.0.0',
    latestLocal: undefined,
  });
  const modernRequests = requests.slice(modernRequestStart);
  assert.equal(
    modernRequests.some(({ pathname }) => pathname.startsWith('/device-types/v1/')),
    false,
  );
  assert.equal(
    modernRequests
      .filter(({ origin, pathname }) => origin === 'https://api.balena-cloud.test' && pathname === '/v6/application')
      .every((url) => !url.searchParams.get('$filter')?.includes('-esr')),
    true,
  );

  const fallbackManager = new BalenaOsSyncManager({
    fetch: async (input, init) =>
      new URL(String(input)).pathname.startsWith('/device-types/v1/')
        ? response(undefined, 404)
        : fetchMock(input, init),
    apiUrl: () => 'https://api.openbalena.test',
    apiVersion: () => 'v7',
    apiSoftwareVersion: () => 'v43.5.4',
    catalogApiUrl: () => 'https://api.balena-cloud.test',
    registryHost: () => 'registry.openbalena.test',
  });
  const fallbackCatalog = await fallbackManager.getCatalog('******');
  assert.equal(fallbackCatalog.deviceTypes[0]?.latestAvailable, '6.0.0');
  assert.equal(fallbackCatalog.deviceTypes[0]?.availableVersions, 1);
  assert.throws(() => manager.start('******', 9, { mode: 'single' }), /valid semantic version/);
});

test('synchronizes and assigns a Supervisor release without changing reported state', async () => {
  const writes: Array<{ resource: string; method: string; body: Record<string, unknown> }> = [];
  const ids: Record<string, number> = {
    application: 110,
    service: 120,
    release: 130,
    image: 140,
    release_image: 150,
  };
  const fetchMock: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const isCatalog = url.origin === 'https://api.balena-cloud.test';
    if (isCatalog && url.pathname === '/v7/application') {
      return response({
        d: [
          {
            id: 1000,
            uuid: 'cloud-supervisor-uuid',
            app_name: 'amd64-supervisor',
            slug: 'balena_os/amd64-supervisor',
            is_host: false,
            is_public: true,
            is_of__class: 'app',
          },
        ],
      });
    }
    if (isCatalog && url.pathname === '/v6/release') {
      return response({
        d: [
          {
            id: 1300,
            commit: 'supervisor-release-commit',
            composition: {},
            contract: null,
            status: 'success',
            source: 'cloud',
            is_invalidated: false,
            start_timestamp: '2026-01-01T00:00:00.000Z',
            end_timestamp: '2026-01-01T00:01:00.000Z',
            is_passing_tests: true,
            is_finalized_at__date: '2026-01-01T00:01:00.000Z',
            raw_version: '19.2.1',
            semver: '19.2.1',
            variant: '',
            revision: 0,
          },
        ],
      });
    }
    if (isCatalog && url.pathname === '/v6/service') {
      return response({ d: [{ id: 1200, service_name: 'supervisor', application: { __id: 1000 } }] });
    }
    if (isCatalog && url.pathname === '/v6/release_image') {
      return response({ d: [{ id: 1500, image: { __id: 1400 }, is_part_of__release: { __id: 1300 } }] });
    }
    if (isCatalog && url.pathname === '/v6/image') {
      return response({
        d: [
          {
            id: 1400,
            is_a_build_of__service: { __id: 1200 },
            is_stored_at__image_location: 'registry2.balena-cloud.com/v2/supervisor',
            status: 'success',
            content_hash: 'sha256:supervisor',
          },
        ],
      });
    }
    if (method === 'GET' && url.pathname === '/v7/device') {
      const filter = url.searchParams.get('$filter');
      return response({
        d: filter === 'id eq 25' ? [{ id: 25, is_of__device_type: { __id: 1 } }] : [],
      });
    }
    if (method === 'GET' && url.pathname === '/v7/application') {
      const filter = url.searchParams.get('$filter') ?? '';
      return response({ d: [] });
    }
    if (method === 'GET' && url.pathname === '/v7/organization') {
      return response({ d: [{ id: 9, name: 'balena_os' }] });
    }
    if (method === 'GET' && url.pathname === '/v7/application_type') {
      return response({ d: [{ id: 1, slug: 'default' }] });
    }
    if (method === 'GET' && url.pathname === '/v7/device_type') {
      const select = url.searchParams.get('$select') ?? '';
      return response({
        d: [
          select.includes('is_of__cpu_architecture')
            ? { id: 1, is_of__cpu_architecture: { __id: 3 } }
            : { id: 1, slug: 'generic-amd64' },
        ],
      });
    }
    if (method === 'GET' && url.pathname === '/v7/cpu_architecture') {
      return response({ d: [{ id: 3, slug: 'amd64' }] });
    }
    if (method === 'GET' && ['/v7/service', '/v7/release', '/v7/image', '/v7/release_image'].includes(url.pathname)) {
      return response({ d: [] });
    }
    if (method === 'POST') {
      const resource = url.pathname.split('/').pop()!;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push({ resource, method, body });
      return response(
        {
          d: [
            {
              ...body,
              id: ids[resource],
              ...(resource === 'image'
                ? { is_stored_at__image_location: 'registry.openbalena.test/v2/generated-image' }
                : {}),
            },
          ],
        },
        201,
      );
    }
    if (method === 'PATCH' && url.pathname === '/v7/image(140)') {
      writes.push({
        resource: 'image',
        method,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(undefined, { status: 200 });
    }
    if (method === 'PATCH' && url.pathname === '/v7/device(25)') {
      writes.push({
        resource: 'device',
        method,
        body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      });
      return new Response(undefined, { status: 200 });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
  const manager = new BalenaOsSyncManager({
    fetch: fetchMock,
    apiUrl: () => 'https://api.openbalena.test',
    apiVersion: () => 'v7',
    apiSoftwareVersion: () => 'v43.5.4',
    catalogApiUrl: () => 'https://api.balena-cloud.test',
    registryHost: () => 'registry.openbalena.test',
  });

  assert.deepEqual(await manager.setSupervisorTarget('******', 25, '19.2.1'), {
    releaseId: 130,
    version: '19.2.1',
  });
  assert.deepEqual(writes[writes.length - 1], {
    resource: 'device',
    method: 'PATCH',
    body: { should_be_managed_by__release: 130 },
  });
  assert.equal(
    writes.some(({ body }) => 'supervisor_version' in body),
    false,
  );
  assert.equal(writes.find(({ resource }) => resource === 'application')?.body.is_host, false);
  assert.deepEqual(
    writes.find(({ resource, method }) => resource === 'image' && method === 'PATCH'),
    {
      resource: 'image',
      method: 'PATCH',
      body: {
        is_stored_at__image_location: 'registry.openbalena.test/v2/supervisor',
      },
    },
  );
  assert.deepEqual(
    writes
      .filter(({ resource }) => resource === 'image' || resource === 'release_image')
      .map(({ resource, method }) => `${method} ${resource}`),
    ['POST image', 'PATCH image', 'POST release_image'],
  );
});
