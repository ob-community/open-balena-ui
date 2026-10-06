import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTerminalDecoder,
  isAbsoluteDevicePath,
  isTransferCancellation,
  transferFilename,
} from './remoteAccessUi';

test('terminal decoder preserves UTF-8 characters split between frames and isolates sessions', () => {
  const frame = (payload: Uint8Array): ArrayBuffer => {
    const bytes = new Uint8Array(4 + payload.length);
    new DataView(bytes.buffer).setUint32(0, 1);
    bytes.set(payload, 4);
    return bytes.buffer;
  };
  const decode = createTerminalDecoder(1);
  const other = createTerminalDecoder(1);
  const unicode = new TextEncoder().encode('😀');
  assert.equal(decode(frame(unicode.slice(0, 2))), '');
  assert.equal(other(frame(new TextEncoder().encode('host'))), 'host');
  assert.equal(decode(frame(unicode.slice(2))), '😀');
  assert.throws(() => decode(new ArrayBuffer(4)), /invalid binary message/);
  assert.throws(() => createTerminalDecoder(2)(frame(unicode)), /invalid binary message/);
});

test('transfers require absolute device paths and derive the local filename', () => {
  assert.equal(isAbsoluteDevicePath(' /mnt/data/file.txt '), true);
  assert.equal(isAbsoluteDevicePath('file.txt'), false);
  assert.equal(isAbsoluteDevicePath('/file\0'), false);
  assert.equal(transferFilename('/mnt/data/report.txt'), 'report.txt');
});

test('user picker cancellation and explicit abort are not failures', () => {
  const controller = new AbortController();
  assert.equal(isTransferCancellation(new DOMException('Cancelled', 'AbortError'), controller.signal), true);
  assert.equal(isTransferCancellation(new Error('Network failed'), controller.signal), false);
  controller.abort();
  assert.equal(isTransferCancellation(new Error('Network failed'), controller.signal), true);
});
