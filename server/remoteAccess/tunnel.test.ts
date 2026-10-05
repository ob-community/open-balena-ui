import assert from 'node:assert/strict';
import { createServer, type AddressInfo } from 'node:net';
import { once } from 'node:events';
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
  const socket = await openTunnel(config, { userId: 1, username: 'alice', token: 'test-token' }, device);
  t.after(() => socket.destroy());
  const bytes = once(socket, 'data');
  socket.resume();
  assert.equal((await bytes)[0].toString(), 'SSH-2.0-test\r\n');
  assert.match(request, new RegExp(`^CONNECT ${device}\\.balena:22222 HTTP/1.1`));
  assert.ok(request.includes(`Proxy-Authorization: Basic ${Buffer.from('alice:test-token').toString('base64')}`));
  socket.destroy();
});
