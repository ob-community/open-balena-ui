import assert from 'node:assert/strict';
import test from 'node:test';
import { BalenaOsSyncManager, expandBalenaOsRevisionChain, selectBalenaOsReleases } from './balenaOsSync';

const response = (body: unknown, status = 200): Response =>
  new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
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

test('synchronizes a complete Host OS release graph through open-balena-api', async () => {
  const writes: Array<{ resource: string; method: string; body: Record<string, unknown> }> = [];
  const ids: Record<string, number> = {
    application: 10,
    service: 20,
    release: 30,
    image: 40,
    release_image: 50,
  };

  const fetchMock: typeof fetch = async (input, init) => {
    assert.doesNotMatch(String(input), /%2C/i);
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const isCatalog = url.origin === 'https://api.balena-cloud.test';

    if (url.pathname === '/device-types/v1/generic-amd64/images') {
      return response({ versions: ['6.0.0'] });
    }
    if (isCatalog && url.pathname === '/v6/application') {
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
      return response({ d: [{ id: 200, service_name: 'hostapp', application: { __id: 100 } }] });
    }
    if (isCatalog && url.pathname === '/v6/release') {
      return response({
        d: [
          {
            id: 300,
            commit: 'host-release-commit',
            composition: '{"services":{"hostapp":{"image":"hostapp:latest"}}}',
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
        ],
      });
    }
    if (isCatalog && url.pathname === '/v6/image') {
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
            id: 40,
            start_timestamp: '2026-01-01T00:00:00.000Z',
            end_timestamp: '2026-01-01T00:01:00.000Z',
            dockerfile: null,
            is_a_build_of__service: { __id: 20 },
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
      ['/v7/application', '/v7/service', '/v7/release', '/v7/image', '/v7/release_image'].includes(url.pathname)
    ) {
      return response({ d: [] });
    }

    if (method === 'POST') {
      const resource = url.pathname.split('/').pop()!;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      writes.push({ resource, method, body });
      return response({ d: [{ ...body, id: ids[resource] }] }, 201);
    }
    if (method === 'PATCH' && url.pathname === '/v7/image(40)') {
      writes.push({
        resource: 'image',
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
  });

  manager.start('Bearer token', 9);
  for (let attempt = 0; attempt < 50 && manager.getStatus().state === 'running'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.deepEqual(manager.getStatus(), {
    state: 'completed',
    phase: 'Complete',
    processed: 5,
    total: 5,
    created: 4,
    updated: 1,
    unchanged: 0,
    mode: 'all',
    version: undefined,
    startedAt: manager.getStatus().startedAt,
    finishedAt: manager.getStatus().finishedAt,
  });
  assert.deepEqual(
    writes.filter(({ method }) => method === 'POST').map(({ resource }) => resource),
    ['application', 'service', 'release', 'release_image'],
  );
  assert.equal('belongs_to__user' in writes.find(({ resource }) => resource === 'release')!.body, false);
  assert.deepEqual(writes.find(({ resource }) => resource === 'release')!.body.contract, {
    type: 'sw.block',
    requires: [],
  });
  assert.deepEqual(writes.find(({ resource }) => resource === 'release')!.body.composition, {
    services: { hostapp: { image: 'hostapp:latest' } },
  });
  assert.deepEqual(
    writes.find(({ method }) => method === 'PATCH'),
    {
      resource: 'image',
      method: 'PATCH',
      body: {
        is_stored_at__image_location: 'registry.openbalena.test/v2/cloud-image',
      },
    },
  );
  const catalog = await manager.getCatalog('******');
  assert.equal(catalog.deviceTypes[0]?.latestAvailable, '6.0.0');
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
