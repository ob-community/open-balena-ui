import assert from 'node:assert/strict';
import net, { createServer, type AddressInfo, Socket } from 'node:net';
import { getEventListeners, once } from 'node:events';
import test from 'node:test';
import { loadRemoteAccessConfig } from './config';
import { openTunnel } from './tunnel';

test('private HTTP CONNECT authenticates and preserves initial SSH bytes', async (t) => {
  const device = 'a'.repeat(32);
  let request = '';
  const server = createServer((socket) => {
    socket.on('data', (chunk) => {
      request += chunk.toString();
      if (request.includes('\r\n\r\n')) {
        socket.write('HTTP/1.1 200 Connection Established\r\n\r\nSSH-2.0-test\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));
  const config = loadRemoteAccessConfig({
    OPEN_BALENA_TUNNEL_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test',
    OPEN_BALENA_POSTGREST_URL: 'http://postgrest.example.test',
  });
  const controller = new AbortController();
  const socket = await openTunnel(
    config,
    { userId: 1, username: 'alice', token: 'test-token' },
    device,
    controller.signal,
  );
  t.after(() => socket.destroy());
  for (const event of ['timeout', 'error', 'close', 'connect']) assert.equal(socket.listenerCount(event), 0);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  controller.abort();
  assert.equal(socket.destroyed, false, 'the settled handshake must leave ownership of the socket to its caller');
  const bytes = once(socket, 'data');
  socket.resume();
  assert.equal((await bytes)[0].toString(), 'SSH-2.0-test\r\n');
  assert.match(request, new RegExp(`^CONNECT ${device}\\.balena:22222 HTTP/1.1`));
  assert.ok(request.includes(`Proxy-Authorization: Basic ${Buffer.from('alice:test-token').toString('base64')}`));
  socket.destroy();
});

for (const response of ['', 'HTTP/1.1 200 Connection Established\r\n']) {
  test(
    `CONNECT rejects clean EOF with ${response ? 'partial headers' : 'no response'}`,
    { timeout: 2_000 },
    async (t) => {
      const server = createServer((socket) => {
        socket.once('data', () => socket.end(response));
      });
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      t.after(
        () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
      );
      const config = loadRemoteAccessConfig({
        OPEN_BALENA_TUNNEL_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test',
        OPEN_BALENA_POSTGREST_URL: 'http://postgrest.example.test',
      });
      const controller = new AbortController();
      await assert.rejects(
        openTunnel(config, { userId: 1, username: 'alice', token: 'test-token' }, 'a'.repeat(32), controller.signal),
        /closed before the CONNECT response was complete/,
      );
      assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
    },
  );
}

test('CONNECT rejects a close without end and removes handshake listeners on all failure paths', async (t) => {
  const config = loadRemoteAccessConfig({
    OPEN_BALENA_TUNNEL_URL: 'http://127.0.0.1:12345',
    REACT_APP_OPEN_BALENA_API_URL: 'https://api.example.test',
    OPEN_BALENA_POSTGREST_URL: 'http://postgrest.example.test',
  });
  for (const failure of ['close', 'error', 'timeout', 'abort', 'refused', 'already-aborted']) {
    const socket = new Socket();
    const baselineEndListeners = socket.listenerCount('end');
    t.mock.method(net, 'connect', () => socket);
    const controller = new AbortController();
    if (failure === 'already-aborted') controller.abort();
    const rejected = assert.rejects(
      openTunnel(config, { userId: 1, username: 'alice', token: 'test-token' }, 'a'.repeat(32), controller.signal),
      /closed before|fixture error|timed out|aborted|refused/,
    );
    if (failure === 'abort') controller.abort();
    else if (failure === 'refused') socket.emit('data', Buffer.from('HTTP/1.1 403 Forbidden\r\n\r\n'));
    else if (failure === 'error') socket.emit('error', new Error('fixture error'));
    else if (failure !== 'already-aborted') socket.emit(failure);
    await rejected;
    assert.equal(socket.destroyed, true);
    for (const event of ['data', 'error', 'close', 'connect', 'timeout']) assert.equal(socket.listenerCount(event), 0);
    assert.equal(socket.listenerCount('end'), baselineEndListeners);
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  }
});
