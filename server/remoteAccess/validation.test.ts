import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { contentDisposition } from './validation';

test('Unicode download names use a safe ASCII fallback and preserve the RFC 5987 name', async (t) => {
  const name = '\u62a5\u544a \u{1f4e6} "one" (copy)*.txt';
  const disposition = contentDisposition(`/tmp/${name}`);
  assert.match(disposition, /^[\x20-\x7e]+$/);
  assert.match(disposition, /%22one%22%20%28copy%29%2A/);
  const encoded = /filename\*=UTF-8''(.+)$/.exec(disposition)?.[1];
  assert.ok(encoded);
  assert.equal(decodeURIComponent(encoded), name);
  const app = express();
  app.get('/download', (_req, res) => res.set('Content-Disposition', disposition).send('contents'));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const response = await fetch(`http://127.0.0.1:${address.port}/download`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Disposition'), disposition);
  assert.equal(await response.text(), 'contents');
});

test('download fallback names cannot inject quoted parameters or header controls', () => {
  const disposition = contentDisposition('/tmp/report"\\\r\n.txt');
  assert.match(disposition, /filename="report____\.txt";/);
  assert.doesNotMatch(disposition, /[\r\n]/);
  assert.ok(disposition.endsWith("filename*=UTF-8''report%22%5C%0D%0A.txt"));
});
