import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import { SignJWT } from 'jose';
import deviceUpdateRoutes from './routes/deviceUpdates';
import { PERMISSION_HINT } from '../src/lib/httpErrorMessage';

const JWT_SECRET = 'device-update-test-secret';

test('device update options are scoped and limited to newer semantic versions', async () => {
  const originalFetch = globalThis.fetch;
  const originalSecret = process.env.OPEN_BALENA_JWT_SECRET;
  const originalApiUrl = process.env.REACT_APP_OPEN_BALENA_API_URL;
  const originalApiVersion = process.env.REACT_APP_OPEN_BALENA_API_VERSION;
  const requests: Array<{ url: URL; authorization: string | null }> = [];
  let localSupervisorReleasesAvailable = true;
  let apiErrorStatus: number | undefined;

  process.env.OPEN_BALENA_JWT_SECRET = JWT_SECRET;
  process.env.REACT_APP_OPEN_BALENA_API_URL = 'https://api.example.test';
  process.env.REACT_APP_OPEN_BALENA_API_VERSION = 'v30.0.0';
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, authorization: new Headers(init?.headers).get('Authorization') });
    if (url.origin === 'https://api.example.test' && apiErrorStatus !== undefined) {
      return Response.json({ message: 'Rejected' }, { status: apiErrorStatus });
    }
    if (url.origin === 'https://api.balena-cloud.com') {
      return Response.json({
        d: [
          { id: 30, raw_version: '19.2.1' },
          { id: 31, raw_version: '18.2.2' },
        ],
      });
    }
    if (url.pathname === '/v7/device_type' || url.pathname === '/v6/device_type') {
      return Response.json({
        d: [{ id: 1, slug: 'generic-amd64', is_of__cpu_architecture: { __id: 2 } }],
      });
    }
    if (url.pathname === '/v7/cpu_architecture' || url.pathname === '/v6/cpu_architecture') {
      return Response.json({ d: [{ id: 2, slug: 'amd64' }] });
    }
    if (url.pathname === '/v7/release') {
      const filter = url.searchParams.get('$filter') ?? '';
      if (filter.includes('-supervisor')) {
        return Response.json({
          d: localSupervisorReleasesAvailable
            ? [
                { id: 20, raw_version: '15.0.4' },
                { id: 21, raw_version: '16.1.0' },
                { id: 22, raw_version: '16.1.0' },
              ]
            : [],
        });
      }
      return Response.json({
        d: [
          { id: 10, raw_version: '5.1.0' },
          {
            id: 11,
            raw_version: '5.2.0',
            known_issue_list: JSON.stringify([{ description: 'Test compatibility before updating.' }]),
          },
          { id: 13, raw_version: '5.2.0+rev1' },
          { id: 12, raw_version: '6.0.0-beta.1' },
        ],
      });
    }
    if (url.pathname === '/v6/application') {
      const filter = url.searchParams.get('$filter') ?? '';
      return Response.json({
        d: filter.includes('is_host eq true')
          ? [{ id: 100 }]
          : [{ id: 101, slug: 'balena_os/generic-amd64-supervisor' }],
      });
    }
    if (url.pathname === '/v6/release') {
      const filter = url.searchParams.get('$filter') ?? '';
      return Response.json({ d: [{ id: filter.includes('101') ? 201 : 200 }] });
    }
    if (url.pathname === '/v6/release_tag') {
      const filter = url.searchParams.get('$filter') ?? '';
      return Response.json({
        d: [
          {
            release: { __id: filter.includes('201') ? 201 : 200 },
            value: filter.includes('201') ? '16.1.0' : '5.2.0',
          },
        ],
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const app = express();
  app.use(deviceUpdateRoutes);
  const server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });

  try {
    const address = server.address() as AddressInfo;
    const token = await new SignJWT({ id: 1 })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode(JWT_SECRET));
    const authorization = ['Bearer', token].join(' ');
    const response = await originalFetch(
      `http://127.0.0.1:${address.port}/device-update-options?deviceTypeId=1&currentOsVersion=5.1.0&currentSupervisorVersion=15.0.4`,
      { headers: { Authorization: authorization } },
    );

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      operatingSystems: [
        { id: 12, version: '6.0.0-beta.1' },
        { id: 13, version: '5.2.0+rev1' },
        { id: 11, version: '5.2.0', knownIssues: ['Test compatibility before updating.'] },
      ],
      supervisors: [
        { id: '19.2.1', version: '19.2.1', target: 'version' },
        { id: '18.2.2', version: '18.2.2', target: 'version' },
        { id: 22, version: '16.1.0', target: 'release' },
      ],
    });
    assert.equal(requests.length, 5);
    assert.ok(requests.slice(0, 4).every((request) => request.authorization === authorization));
    assert.equal(requests[4].authorization, null);
    assert.match(requests[2].url.searchParams.get('$filter') ?? '', /semver_major gt 5/);
    assert.match(requests[2].url.searchParams.get('$filter') ?? '', /generic-amd64/);
    assert.match(requests[2].url.searchParams.get('$orderby') ?? '', /semver_major desc/);
    assert.match(requests[3].url.searchParams.get('$filter') ?? '', /semver_major gt 15/);
    assert.match(requests[3].url.searchParams.get('$filter') ?? '', /architecture\/id eq 2/);
    assert.match(requests[3].url.searchParams.get('$filter') ?? '', /-supervisor/);
    assert.match(requests[3].url.searchParams.get('$orderby') ?? '', /semver_major desc/);

    requests.length = 0;
    process.env.REACT_APP_OPEN_BALENA_API_VERSION = 'v0.139.0';
    const legacyResponse = await originalFetch(
      `http://127.0.0.1:${address.port}/device-update-options?deviceTypeId=1&currentOsVersion=5.1.0&currentSupervisorVersion=15.0.4`,
      { headers: { Authorization: authorization } },
    );
    assert.equal(legacyResponse.status, 200);
    assert.deepEqual(await legacyResponse.json(), {
      operatingSystems: [{ id: 200, version: '5.2.0' }],
      supervisors: [
        { id: '19.2.1', version: '19.2.1', target: 'version' },
        { id: '18.2.2', version: '18.2.2', target: 'version' },
        { id: 201, version: '16.1.0', target: 'release' },
      ],
    });
    assert.deepEqual(
      requests.map(({ url }) => url.pathname),
      [
        '/v6/device_type',
        '/v6/cpu_architecture',
        '/v6/application',
        '/v6/application',
        '/v6/release',
        '/v6/release',
        '/v6/release_tag',
        '/v6/release_tag',
        '/v7/release',
      ],
    );

    requests.length = 0;
    process.env.REACT_APP_OPEN_BALENA_API_VERSION = 'v30.0.0';
    localSupervisorReleasesAvailable = false;
    const fallbackResponse = await originalFetch(
      `http://127.0.0.1:${address.port}/device-update-options?deviceTypeId=1&currentOsVersion=5.1.0&currentSupervisorVersion=17.0.3`,
      { headers: { Authorization: authorization } },
    );
    assert.equal(fallbackResponse.status, 200);
    assert.deepEqual((await fallbackResponse.json()).supervisors, [
      { id: '19.2.1', version: '19.2.1', target: 'version' },
      { id: '18.2.2', version: '18.2.2', target: 'version' },
    ]);

    const invalidTargetResponse = await originalFetch(`http://127.0.0.1:${address.port}/device-supervisor-target`, {
      method: 'POST',
      headers: { 'Authorization': authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: 1, version: '' }),
    });
    assert.equal(invalidTargetResponse.status, 400);
    assert.deepEqual(await invalidTargetResponse.json(), {
      message: 'A valid device and Supervisor version are required.',
    });

    for (const status of [401, 403, 503]) {
      apiErrorStatus = status;
      const errorResponse = await originalFetch(
        `http://127.0.0.1:${address.port}/device-update-options?deviceTypeId=1&currentOsVersion=5.1.0&currentSupervisorVersion=15.0.4`,
        { headers: { Authorization: authorization } },
      );
      assert.equal(errorResponse.status, 502);
      assert.deepEqual(await errorResponse.json(), {
        message: `open-balena-api device_type query failed with status ${status}.${status === 401 ? ` ${PERMISSION_HINT}` : ''}`,
      });
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    globalThis.fetch = originalFetch;
    if (originalSecret == null) delete process.env.OPEN_BALENA_JWT_SECRET;
    else process.env.OPEN_BALENA_JWT_SECRET = originalSecret;
    if (originalApiUrl == null) delete process.env.REACT_APP_OPEN_BALENA_API_URL;
    else process.env.REACT_APP_OPEN_BALENA_API_URL = originalApiUrl;
    if (originalApiVersion == null) delete process.env.REACT_APP_OPEN_BALENA_API_VERSION;
    else process.env.REACT_APP_OPEN_BALENA_API_VERSION = originalApiVersion;
  }
});
