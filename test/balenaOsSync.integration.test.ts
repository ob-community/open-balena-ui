import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { BalenaOsSyncManager } from '../server/balenaOsSync';
import { ApiFixture, metadataCacheLocalTtlMs, slugs } from './fixtures/balenaOsApi/harness';

test(
  'real ob-api: WebResource metadata backfill, authorization, cache invalidation and idempotency',
  {
    skip: process.env.BALENA_OS_INTEGRATION !== '1',
    timeout: 360_000,
  },
  async () => {
    const fixture = new ApiFixture();
    try {
      await fixture.start();
      const organizations = await fixture.records('organization?$select=id,name');
      const organization = organizations.find(({ name }) => name === 'balena_os');
      assert.ok(organization, 'Fixture bootstrap must create balena_os organization membership.');
      const assets = await (await fetch(`${fixture.sourceUrl}/fixture/assets`)).json();
      const types = await fixture.records('device_type?$select=id,slug');
      const applicationType = (await fixture.records("application_type?$filter=slug eq 'default'&$select=id"))[0];
      for (const [index, slug] of slugs.entries()) {
        const createdApp = await fixture.request('application', 'POST', {
          uuid: `00000000000040008000${String(index + 100).padStart(12, '0')}`,
          app_name: slug,
          organization: organization.id,
          application_type: applicationType.id,
          is_for__device_type: types.find((type) => type.slug === slug).id,
          is_host: true,
          is_public: true,
          is_of__class: 'app',
          is_archived: false,
          should_track_latest_release: true,
        });
        const app = Array.isArray(createdApp.d) ? createdApp.d[0] : (createdApp.d ?? createdApp);
        assert.ok(app.id, JSON.stringify(createdApp));
        await fixture.request('release', 'POST', {
          belongs_to__application: app.id,
          commit: createHash('sha1')
            .update(`fixture-${index + 100}`)
            .digest('hex'),
          composition: {},
          status: 'success',
          source: 'cloud',
          semver: '8.0.0',
          variant: '',
          is_invalidated: false,
          is_passing_tests: true,
          start_timestamp: '2026-01-01T00:00:00.000Z',
          end_timestamp: '2026-01-01T00:01:00.000Z',
          is_finalized_at__date: '2026-01-01T00:01:00.000Z',
        });
      }
      const getMetadata = async () => {
        const response = await fetch(`${fixture.apiUrl}/device-types/v1`, {
          headers: { Authorization: fixture.authorization },
          signal: AbortSignal.timeout(10_000),
        });
        assert.equal(response.status, 200, await response.clone().text());
        const value = await response.json();
        return Array.isArray(value) ? Object.fromEntries(value.map((entry) => [entry.slug, entry])) : value;
      };
      const oldMetadata = await getMetadata();
      for (const slug of slugs) assert.equal(oldMetadata[slug]?.buildId, '7.0.0', JSON.stringify(oldMetadata));
      const primedAt = Date.now();
      let oldCacheObservedAfterAllReferences = false;
      const requests: Array<{ url: string; method: string; body?: Record<string, unknown> }> = [];
      let deniedAuthorization = '';
      const makeManager = (denyAssetWrites = false) =>
        new BalenaOsSyncManager({
          fetch: async (input, init) => {
            const url = String(input);
            const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
            requests.push({
              url,
              method: init?.method ?? 'GET',
              ...(body === undefined ? {} : { body }),
            });
            if (
              !oldCacheObservedAfterAllReferences &&
              url.startsWith(fixture.apiUrl) &&
              /\/application\(\d+\)$/.test(url) &&
              init?.method === 'PATCH' &&
              body?.is_host === true &&
              Object.keys(body).length === 1
            ) {
              const savedReferences = await fixture.records(
                "release_asset?$filter=asset_key eq 'device-type.json'&$select=asset",
              );
              assert.equal(savedReferences.length, 5);
              for (const asset of Object.values(assets) as any[]) {
                assert.ok(
                  savedReferences.some(
                    ({ asset: actual }) =>
                      actual.href === asset.href && actual.size === asset.size && actual.checksum === asset.checksum,
                  ),
                );
              }
              assert.ok(
                Date.now() - primedAt < metadataCacheLocalTtlMs,
                'Cache evidence must precede the explicitly configured ten-minute local TTL.',
              );
              const stillOld = await getMetadata();
              for (const slug of slugs)
                assert.equal(
                  stillOld[slug]?.buildId,
                  '7.0.0',
                  `All asset references are new, but before host notification cache must remain old: ${JSON.stringify(stillOld)}`,
                );
              oldCacheObservedAfterAllReferences = true;
            }
            if (
              denyAssetWrites &&
              url.startsWith(fixture.apiUrl) &&
              url.includes('/release_asset') &&
              init?.method !== 'GET'
            ) {
              return fetch(input, {
                ...init,
                headers: {
                  ...Object.fromEntries(new Headers(init?.headers)),
                  Authorization: deniedAuthorization,
                },
              });
            }
            // PostgREST is deliberately unauthenticated inside this isolated fixture:
            // authorization must have been enforced by the preceding real OData write.
            const headers = new Headers(init?.headers);
            if (url.startsWith(fixture.postgrestUrl)) headers.delete('Authorization');
            return fetch(input, { ...init, headers });
          },
          apiUrl: () => fixture.apiUrl,
          apiVersion: () => 'v7',
          apiSoftwareVersion: () => '49.6.5',
          catalogApiUrl: () => fixture.sourceUrl,
          registryHost: () => 'registry.fixture.invalid',
          contractAllowlist: () => slugs.map((slug) => `hw.device-type/${slug}`).join(','),
          postgrestUrl: () => fixture.postgrestUrl,
          metadataVerificationTimeoutMs: 2000,
          metadataVerificationPollIntervalMs: 100,
          storeDeviceTypeMetadata: async (slug) => {
            const { body: _, ...asset } = assets[slug];
            return asset;
          },
          setHostAppUpdaterRelation: async (_authorization, host, updater) => {
            const response = await fetch(`${fixture.postgrestUrl}/application?id=eq.${host}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json', 'Prefer': 'return=representation' },
              body: JSON.stringify({ 'is updated by-application': updater }),
            });
            assert.equal(response.status, 200);
            const linked = await response.json();
            assert.equal(linked.length, 1);
            assert.equal(linked[0].id, host);
            assert.equal(linked[0]['is updated by-application'], updater);
          },
        });
      const run = async (manager: BalenaOsSyncManager) => {
        manager.start(fixture.authorization, organization.id, { mode: 'latest-and-in-use' });
        await fixture.wait(async () => {
          assert.notEqual(manager.getStatus().state, 'running', JSON.stringify(manager.getStatus()));
        }, 90_000);
        return manager.getStatus();
      };
      const initial = makeManager();
      const initialStatus = await run(initial);
      assert.equal(
        initialStatus.state,
        'completed',
        `${JSON.stringify(initialStatus)}\nAssets: ${JSON.stringify(await fixture.records('release_asset'))}\n${fixture.logs().slice(-3000)}`,
      );
      assert.equal(oldCacheObservedAfterAllReferences, true);
      const synchronizedApplications = await fixture.records('application?$select=slug,is_host,is_of__class');
      assert.equal(synchronizedApplications.find(({ slug }) => slug === 'balena_os/balenahup')?.is_of__class, 'block');
      for (const slug of slugs) {
        const host = synchronizedApplications.find((application) => application.slug === `balena_os/${slug}`);
        assert.equal(host?.is_host, true);
        assert.equal(host?.is_of__class, 'app');
      }
      const refreshedMetadata = await getMetadata();
      for (const slug of slugs) assert.equal(refreshedMetadata[slug]?.buildId, '8.0.0');
      const releases = await fixture.records('release?$select=id,raw_version');
      const release = releases.find(({ raw_version }) => raw_version === '8.0.0');
      assert.ok(release);
      const { body: _legacyBody, ...legacyAsset } = assets[slugs[0]];
      const legacy = await fetch(`${fixture.apiUrl}/v7/release_asset`, {
        method: 'POST',
        headers: { 'Authorization': fixture.authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ release: release.id, asset_key: 'legacy.json', asset: legacyAsset }),
      });
      assert.equal(legacy.status, 400);
      assert.match(await legacy.text(), /Use multipart requests to upload a file/);
      const graphCounts = async () =>
        Promise.all(
          ['application', 'release', 'service', 'image', 'release_asset'].map(async (resource) => [
            resource,
            (await fixture.records(`${resource}?$select=id`)).length,
          ]),
        );
      const counts = await graphCounts();
      const references = await fixture.records(
        "release_asset?$filter=asset_key eq 'device-type.json'&$select=id,release,asset",
      );
      assert.equal(references.length, 5);
      for (const asset of Object.values(assets) as any[]) {
        assert.ok(
          references.some(
            ({ asset: actual }) =>
              actual.href === asset.href && actual.size === asset.size && actual.checksum === asset.checksum,
          ),
        );
      }
      requests.length = 0;
      const repeat = makeManager();
      assert.equal((await run(repeat)).state, 'completed', JSON.stringify(repeat.getStatus()));
      assert.deepEqual(await graphCounts(), counts);
      assert.equal(
        requests.filter(
          ({ url, method }) =>
            url.startsWith(fixture.postgrestUrl) && url.includes('release%20asset') && method === 'PATCH',
        ).length,
        0,
      );
      assert.equal(
        requests.filter(
          ({ url, method }) => url.startsWith(fixture.apiUrl) && url.includes('/release_asset') && method !== 'GET',
        ).length,
        0,
      );
      assert.equal(
        requests.filter(
          ({ url, method, body }) =>
            url.startsWith(fixture.apiUrl) &&
            /\/application\(\d+\)$/.test(url) &&
            method === 'PATCH' &&
            body?.is_host === true &&
            Object.keys(body).length === 1,
        ).length,
        5,
      );
      const hostActions = requests.filter(
        ({ url, method, body }) =>
          url.startsWith(fixture.apiUrl) &&
          /\/application\(\d+\)\/canAccess$/.test(url) &&
          method === 'POST' &&
          body?.method === 'PATCH',
      );
      assert.equal(hostActions.length, 5);
      for (const action of hostActions) {
        const notification = requests.find(
          ({ url, method, body }) =>
            url === action.url.replace(/\/canAccess$/, '') && method === 'PATCH' && body?.is_host === true,
        );
        assert.ok(notification);
        assert.ok(requests.indexOf(action) < requests.indexOf(notification));
      }
      const stale = references[0];
      const assetActionUrl = `${fixture.apiUrl}/v7/release_asset(${stale.id})/canAccess`;
      const authorizedAccess = await fetch(assetActionUrl, {
        method: 'POST',
        headers: { 'Authorization': fixture.authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'PATCH' }),
      });
      assert.equal(authorizedAccess.status, 200, await authorizedAccess.clone().text());
      assert.deepEqual((await authorizedAccess.json()).d, [{ id: stale.id }]);
      deniedAuthorization = await fixture.assetReadOnlyAuthorization();
      const readableAccess = await fetch(assetActionUrl, {
        method: 'POST',
        headers: { 'Authorization': deniedAuthorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'GET' }),
      });
      assert.equal(readableAccess.status, 200, await readableAccess.clone().text());
      assert.deepEqual((await readableAccess.json()).d, [{ id: stale.id }]);
      const deniedAccess = await fetch(assetActionUrl, {
        method: 'POST',
        headers: { 'Authorization': deniedAuthorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'PATCH' }),
      });
      assert.equal(deniedAccess.status, 401, await deniedAccess.clone().text());
      const silentlyDeniedPatch = await fetch(`${fixture.apiUrl}/v7/release_asset(${stale.id})`, {
        method: 'PATCH',
        headers: { 'Authorization': deniedAuthorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset_key: 'must-not-be-written.json' }),
      });
      assert.equal(silentlyDeniedPatch.status, 200, await silentlyDeniedPatch.clone().text());
      const untouched = await fixture.records(`release_asset?$filter=id eq ${stale.id}&$select=asset_key,asset`);
      assert.equal(untouched[0].asset_key, 'device-type.json');
      assert.deepEqual(untouched[0].asset, stale.asset);
      const staleAsset = { ...stale.asset, href: 'http://source:8080/assets/stale/device-type.json' };
      assert.equal(
        (
          await fetch(`${fixture.postgrestUrl}/release%20asset?id=eq.${stale.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ asset: staleAsset }),
          })
        ).status,
        204,
      );
      requests.length = 0;
      const unauthorized = makeManager(true);
      assert.equal((await run(unauthorized)).state, 'failed');
      assert.equal(
        requests.filter(
          ({ url, method, body }) => url === assetActionUrl && method === 'POST' && body?.method === 'PATCH',
        ).length,
        1,
      );
      assert.equal(
        requests.filter(
          ({ url, method }) =>
            url.startsWith(fixture.postgrestUrl) && url.includes('release%20asset') && method === 'PATCH',
        ).length,
        0,
      );
      const repair = makeManager();
      assert.equal((await run(repair)).state, 'completed', JSON.stringify(repair.getStatus()));
      assert.equal(
        requests.filter(
          ({ url, method, body }) =>
            url === assetActionUrl.replace(/\/canAccess$/, '') && method === 'PATCH' && body?.asset_key != null,
        ).length,
        0,
      );
      assert.deepEqual(await graphCounts(), counts);
      const repaired = await fixture.records(`release_asset?$filter=id eq ${stale.id}&$select=asset`);
      assert.ok(
        (Object.values(assets) as any[]).some(
          (asset) =>
            asset.href === repaired[0].asset.href &&
            asset.size === repaired[0].asset.size &&
            asset.checksum === repaired[0].asset.checksum,
        ),
      );
      const metadata = await getMetadata();
      for (const slug of slugs) assert.equal(metadata[slug]?.buildId, '8.0.0');

      const slug = 'generic-amd64';
      const createdFleet = await fixture.request('application', 'POST', {
        uuid: randomUUID().replace(/-/g, ''),
        app_name: 'synthetic-config-fleet',
        organization: organization.id,
        application_type: applicationType.id,
        is_for__device_type: types.find((type) => type.slug === slug).id,
        is_host: false,
        is_public: false,
        is_of__class: 'app',
      });
      const fleet = Array.isArray(createdFleet.d) ? createdFleet.d[0] : (createdFleet.d ?? createdFleet);
      const provisioningResponse = await fetch(`${fixture.apiUrl}/api-key/application/${fleet.id}/provisioning`, {
        method: 'POST',
        headers: { 'Authorization': fixture.authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'synthetic-config-provisioning' }),
      });
      assert.equal(provisioningResponse.status, 200, await provisioningResponse.clone().text());
      const provisioningKey = await provisioningResponse.json();
      const deviceUuid = randomUUID().replace(/-/g, '');
      const registration = await fetch(
        `${fixture.apiUrl}/device/register?apikey=${encodeURIComponent(provisioningKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ application: fleet.id, device_type: slug, uuid: deviceUuid, os_version: '8.0.0' }),
        },
      );
      assert.equal(registration.status, 201, await registration.clone().text());
      const devices = await fixture.records(
        `device?$filter=uuid eq '${deviceUuid}'&$select=id,belongs_to__application`,
      );
      assert.equal(devices.length, 1);
      assert.equal(devices[0].belongs_to__application.__id, fleet.id);
      const upstreamBefore = await (await fetch(`${fixture.sourceUrl}/fixture/upstream-reads`)).json();
      const configResponse = await fetch(`${fixture.apiUrl}/download-config`, {
        method: 'POST',
        headers: { 'Authorization': fixture.authorization, 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: fleet.id, version: '8.0.0', deviceType: slug }),
        signal: AbortSignal.timeout(10_000),
      });
      assert.equal(configResponse.status, 200, await configResponse.clone().text());
      const config = await configResponse.json();
      assert.equal(config.deviceType, slug);
      assert.equal(Number(config.applicationId), fleet.id);
      assert.equal(typeof config.apiKey, 'string');
      assert.ok(config.apiKey.length > 0);
      const upstreamAfter = await (await fetch(`${fixture.sourceUrl}/fixture/upstream-reads`)).json();
      assert.equal(
        upstreamAfter.upstreamReads,
        upstreamBefore.upstreamReads,
        'Registered-fleet download-config must use completed metadata assets/cache, not upstream S3.',
      );

      // A pending cache-manager callbackFiller is not removed by cache.del.
      // This cannot recover without the upstream completing; success would be false.
      const applications = await fixture.records('application?$filter=is_host eq true&$select=id');
      for (const reference of references) {
        assert.equal(
          (
            await fetch(
              `${fixture.postgrestUrl}/release%20asset?${new URLSearchParams({
                'id': `eq.${reference.id}`,
                'release': `eq.${reference.release.__id}`,
                'asset key': 'eq.device-type.json',
              })}`,
              {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ asset: null }),
              },
            )
          ).status,
          204,
        );
      }
      assert.equal((await fetch(`${fixture.sourceUrl}/control/hang`)).status, 200);
      for (const application of applications) {
        await fixture.request(`application(${application.id})`, 'PATCH', { is_host: true });
      }
      const pendingFill = fetch(`${fixture.apiUrl}/device-types/v1`, {
        headers: { Authorization: fixture.authorization },
        signal: AbortSignal.timeout(10_000),
      }).catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 500));
      const hung = makeManager();
      const hungStatus = await run(hung);
      assert.equal(hungStatus.state, 'failed', JSON.stringify(hungStatus));
      assert.match(hungStatus.error ?? '', /cache|metadata|device.type/i);
      await pendingFill;
    } finally {
      fixture.cleanup();
    }
  },
);
