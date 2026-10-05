import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clearLogBuffer,
  exportDeviceLogs,
  logSeverity,
  maximumLogEntries,
  mergeLogSnapshot,
  parseDeviceLogs,
  parseLogText,
  plainLogMessage,
  selectedLogSources,
  type DeviceLogEntry,
} from './deviceLogs';

const entry = (time: number, message = 'message', serviceId?: number): DeviceLogEntry => ({
  timestamp: new Date(time).toISOString(),
  message,
  ...(serviceId == null ? {} : { serviceId }),
});

test('log responses normalize millisecond and ISO timestamps and reject invalid shapes', () => {
  assert.deepEqual(parseDeviceLogs([{ timestamp: 1000, message: 'test', serviceId: '42' }]), [entry(1000, 'test', 42)]);
  assert.deepEqual(parseDeviceLogs([entry(2000)]), [entry(2000)]);
  assert.throws(() => parseDeviceLogs({ logs: [] }), /invalid log list/);
  assert.throws(() => parseDeviceLogs([{ timestamp: 'not a timestamp', message: 'test' }]), /invalid timestamp/);
  assert.throws(() => parseDeviceLogs([{ timestamp: 1000, message: 'test', serviceId: -1 }]), /invalid service/);
});

test('safe ANSI formatting preserves colors, reset, 256 colors and RGB without HTML or OSC links', () => {
  const segments = parseLogText('\u001b[31;1merror\u001b[0m normal \u001b[38;5;196mred\u001b[0m \u001b[38;2;1;2;3mrgb');
  assert.deepEqual(segments[0], { text: 'error', style: { color: '#ee6666', fontWeight: 'bold' } });
  assert.deepEqual(segments[1], { text: ' normal ', style: {} });
  assert.equal(segments[2].style.color, 'rgb(255, 0, 0)');
  assert.equal(segments[4].style.color, 'rgb(1, 2, 3)');
  assert.equal(plainLogMessage('\u001b]8;;https://example.test\u0007<script>\u001b]8;;\u0007\r\n'), '<script>\n');
  assert.equal(plainLogMessage('\u001b[2Jtest'), 'test');
  assert.equal(plainLogMessage('\u001b[32mgreen\u001b[0m'), 'green');
});

test('container structured log levels get severity colors without guessing from arbitrary text', () => {
  assert.equal(logSeverity(entry(1, '{"level":"error","message":"failure"}')), 'error');
  assert.equal(logSeverity(entry(1, '{"level":"warn"}')), 'warning');
  assert.equal(logSeverity(entry(1, '{"level":"info"}')), 'info');
  assert.equal(logSeverity(entry(1, '{"severity":"DEBUG"}')), 'debug');
  assert.equal(logSeverity(entry(1, 'ERROR mentioned in normal output')), 'default');
  assert.equal(logSeverity(entry(1, '{not JSON')), 'default');
  assert.equal(logSeverity({ ...entry(1), isStdErr: true }), 'error');
  assert.equal(logSeverity({ ...entry(1), isSystem: true }), 'warning');
});

test('poll snapshots merge chronologically without duplicating history or losing identical occurrences', () => {
  const snapshot = [entry(3000, 'last', 42), entry(1000, 'first'), entry(2000, 'same', 42), entry(2000, 'same', 42)];
  const first = mergeLogSnapshot({ entries: [] }, snapshot);
  assert.deepEqual(
    first.entries.map(({ message }) => message),
    ['first', 'same', 'same', 'last'],
  );
  const second = mergeLogSnapshot(first, snapshot);
  assert.deepEqual(second, first);
  assert.equal(mergeLogSnapshot(first, [entry(4000)]).entries.length, 5);
  assert.equal(mergeLogSnapshot(first, []).entries.length, 4);
});

test('clear watermark rejects old and in-flight snapshots while admitting only post-clear logs', () => {
  const buffer = mergeLogSnapshot({ entries: [] }, [entry(1000), entry(2000)]);
  const cleared = clearLogBuffer(buffer, 2500);
  assert.equal(cleared.entries.length, 0);
  const updated = mergeLogSnapshot(cleared, [entry(1000), entry(2000), entry(2500), entry(2501)]);
  assert.deepEqual(
    updated.entries.map(({ timestamp }) => timestamp),
    [entry(2501).timestamp],
  );
  assert.equal(clearLogBuffer(buffer, 1500).after, 2000, 'already displayed future-clock entries must not reappear');
});

test('retention is bounded and evicted tail entries cannot return on the next snapshot', () => {
  const snapshot = Array.from({ length: maximumLogEntries + 1 }, (_, i) => entry(i + 1));
  const buffer = mergeLogSnapshot({ entries: [] }, snapshot);
  assert.equal(buffer.entries.length, maximumLogEntries);
  assert.equal(buffer.after, 1);
  assert.deepEqual(mergeLogSnapshot(buffer, snapshot), buffer);
});

test('multi-source selection emits overlapping default sources only once and exports displayed plain text', () => {
  const selections = [
    { serviceId: 0, serviceName: 'Host OS' },
    { serviceId: 12, serviceName: 'core', logSource: 'supervisor' as const },
    { serviceId: 42, serviceName: 'ugcontainer' },
  ];
  const logs = [entry(1000, 'host'), entry(2000, '\u001b[32mcontainer\u001b[0m', 42), entry(3000, 'other', 99)];
  const displayed = logs.filter((row) => selectedLogSources(row, selections).length);
  assert.equal(displayed.length, 2);
  assert.equal(
    exportDeviceLogs(displayed, selections),
    '[1970-01-01T00:00:01.000Z] [Host OS, core] host\n[1970-01-01T00:00:02.000Z] [ugcontainer] container\n',
  );
  assert.equal(exportDeviceLogs([], selections), '');
});
