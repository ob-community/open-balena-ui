import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { createFixtureTransport } from './fixtures/balenaOsApi/transport';

const require = createRequire(import.meta.url);
const { createSourceServer }: { createSourceServer: () => Server } = require('./fixtures/balenaOsApi/source.cjs');

const withServer = async (server: Server, run: (url: string) => Promise<void>): Promise<void> => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
};

test('fixture transport reports a fixed plain-text error and logs diagnostics only server-side', async (context) => {
  const failure = new Error('<script>alert("fixture")</script>\nprivate diagnostic detail');
  const log = context.mock.method(console, 'error', () => {});
  const server = createFixtureTransport(async () => {
    throw failure;
  });

  await withServer(server, async (url) => {
    const response = await fetch(`${url}/api/test`);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('Content-Type'), 'text/plain; charset=utf-8');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    const body = await response.text();
    assert.equal(body, 'Fixture transport request failed.');
    assert.ok(!body.includes(failure.message));
    assert.ok(!body.includes('Error:'));
    assert.equal(log.mock.callCount(), 1);
    assert.deepEqual(log.mock.calls[0].arguments, ['Fixture transport request failed:', failure]);
  });
});

test('fixture transport preserves routing, request bodies and upstream responses', async () => {
  for (const [service, origin] of [
    ['api', 'http://api:80'],
    ['postgrest', 'http://postgrest:3000'],
    ['source', 'http://source:8080'],
  ]) {
    const server = createFixtureTransport(async (request) => {
      assert.equal(request.url, `${origin}/test?value=1`);
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.authorization, 'Bearer synthetic');
      assert.equal(request.headers.host, undefined);
      assert.equal(request.headers.connection, undefined);
      assert.equal(request.headers['x-forwarded-proto'], 'https');
      assert.equal(Buffer.from(request.body, 'base64').toString(), '{"fixture":true}');
      return {
        status: 201,
        headers: {
          'content-type': 'application/json',
          'content-length': '999',
          'content-encoding': 'gzip',
          'transfer-encoding': 'chunked',
        },
        body: Buffer.from('{"created":true}').toString('base64'),
      };
    });
    await withServer(server, async (url) => {
      const response = await fetch(`${url}/${service}/test?value=1`, {
        method: 'POST',
        headers: { Authorization: 'Bearer synthetic' },
        body: '{"fixture":true}',
      });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get('Content-Type'), 'application/json');
      assert.equal(response.headers.get('Content-Encoding'), null);
      assert.notEqual(response.headers.get('Content-Length'), '999');
      assert.deepEqual(await response.json(), { created: true });
    });
  }
});

test('fixture source escapes all XML metacharacters in reflected prefixes', async () => {
  await withServer(createSourceServer(), async (url) => {
    const prefix = `<script>alert("fixture")</script>&'`;
    const query = new URLSearchParams({ 'list-type': '2', prefix });
    const response = await fetch(`${url}/?${query}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Content-Type'), 'application/xml');
    assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
    const body = await response.text();
    assert.ok(body.includes('<Prefix>&lt;script&gt;alert(&quot;fixture&quot;)&lt;/script&gt;&amp;&apos;</Prefix>'));
    assert.ok(!body.includes('<script>'));
    assert.ok(body.includes('<IsTruncated>false</IsTruncated>'));
  });
});

test('fixture source still lists valid folders and serves device metadata', async () => {
  await withServer(createSourceServer(), async (url) => {
    const listing = await fetch(`${url}/?list-type=2&prefix=images%2Fgeneric-amd64%2F`);
    assert.ok(
      (await listing.text()).includes('<CommonPrefixes><Prefix>images/generic-amd64/7.0.0/</Prefix></CommonPrefixes>'),
    );
    const metadata = await fetch(`${url}/images/generic-amd64/7.0.0/device-type.json`);
    assert.equal(metadata.status, 200);
    assert.equal((await metadata.json()).buildId, '7.0.0');
  });
});
