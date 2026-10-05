import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeTerminalOutput,
  encodeTerminalInput,
  remoteTransferUrl,
  remoteWebSocketUrl,
} from './builtInRemoteAccess';

test('built-in remote access uses the current origin and secure WebSockets', () => {
  assert.equal(
    remoteWebSocketUrl({ protocol: 'https:', host: 'obui.example.test' } as Location),
    'wss://obui.example.test/remote/ws',
  );
  assert.equal(
    remoteWebSocketUrl({ protocol: 'http:', host: 'localhost:3000' } as Location),
    'ws://localhost:3000/remote/ws',
  );
});

test('terminal binary frames reserve four bytes for the channel identifier', async () => {
  const encoded = encodeTerminalInput(42, 'hello');
  const bytes = new Uint8Array(encoded);
  assert.equal(new DataView(encoded).getUint32(0), 42);
  assert.equal(new TextDecoder().decode(bytes.slice(4)), 'hello');
  assert.deepEqual(await decodeTerminalOutput(encoded), { channel: 42, output: 'hello' });
  await assert.rejects(decodeTerminalOutput(new ArrayBuffer(4)), /invalid binary message/);
});

test('transfer paths are encoded as query data', () => {
  assert.equal(
    remoteTransferUrl('upload', 'a'.repeat(32), '/var/lib/data report.txt'),
    `/remote/sftp/upload?deviceUuid=${'a'.repeat(32)}&path=%2Fvar%2Flib%2Fdata+report.txt`,
  );
});

test('both transfer directions explicitly carry the selected container without changing host URLs', () => {
  for (const operation of ['upload', 'download'] as const) {
    const url = new URL(
      remoteTransferUrl(operation, 'a'.repeat(32), '/tmp/data report.txt', 'balena_supervisor'),
      'http://localhost',
    );
    assert.equal(url.searchParams.get('container'), 'balena_supervisor');
    assert.equal(url.searchParams.get('path'), '/tmp/data report.txt');
    assert.equal(
      new URL(remoteTransferUrl(operation, 'a'.repeat(32), '/tmp/file'), 'http://localhost').searchParams.has(
        'container',
      ),
      false,
    );
  }
});
