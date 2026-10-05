import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import test, { type TestContext } from 'node:test';
import express, { Router } from 'express';
import { createApiRouter } from './routes/api';

const fixture = async (t: TestContext, remoteRouter?: Router) => {
  const app = express();
  app.use(createApiRouter(remoteRouter));
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
  return `http://127.0.0.1:${address.port}`;
};

test('remote JSON uploads reach the streaming router intact before general JSON parsers', async (t) => {
  const remote = Router();
  remote.put('/remote/sftp/upload', async (req, res, next) => {
    try {
      const hash = createHash('sha256');
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        hash.update(chunk);
      }
      res.status(201).json({ bytes, hash: hash.digest('hex'), parsed: req.body !== undefined });
    } catch (error) {
      next(error);
    }
  });
  const url = await fixture(t, remote);
  for (const data of ['{"message":"small"}', JSON.stringify({ message: 'x'.repeat(200 * 1024) })]) {
    const response = await fetch(`${url}/remote/sftp/upload`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: data,
    });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), {
      bytes: Buffer.byteLength(data),
      hash: createHash('sha256').update(data).digest('hex'),
      parsed: false,
    });
  }
});

test('unconfigured remote uploads fail explicitly before general JSON parsing', async (t) => {
  const url = await fixture(t);
  const response = await fetch(`${url}/remote/sftp/upload`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'x'.repeat(200 * 1024) }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    error: 'remote_access_unavailable',
    message: 'Remote access is not configured.',
  });
});
