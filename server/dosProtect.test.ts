import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import express from 'express';
import dosProtect from './middleware/dosProtect';

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

test('successful requests do not consume the failed-request rate limit', async () => {
  const app = express();
  app.get('/success', ...dosProtect, (_req, res) => res.sendStatus(204));
  app.get('/failure', ...dosProtect, (_req, res) => res.sendStatus(401));
  const server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
  });
  const address = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    for (let request = 0; request < 110; request += 1) {
      assert.equal((await fetch(`${baseUrl}/success`)).status, 204);
    }

    const failedRequests = await Promise.all(
      Array.from({ length: 101 }, () => fetch(`${baseUrl}/failure`).then(({ status }) => status)),
    );
    assert.equal(failedRequests.filter((status) => status === 401).length, 100);
    assert.equal(failedRequests.filter((status) => status === 429).length, 1);
  } finally {
    await closeServer(server);
  }
});
