import type { DeviceLogServiceSelection } from './deviceServicePresentation';
import { matchesDeviceServiceLog } from './deviceServicePresentation';

export const logFontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
export const logPollIntervalMs = 2000;
export const maximumLogEntries = 5000;

export interface DeviceLogEntry {
  timestamp: string;
  message: string;
  isStdErr?: boolean;
  isSystem?: boolean;
  serviceId?: number;
}

export interface LogTextStyle {
  color?: string;
  backgroundColor?: string;
  fontWeight?: 'bold';
  fontStyle?: 'italic';
  opacity?: number;
  textDecoration?: string;
}

export interface LogTextSegment {
  text: string;
  style: LogTextStyle;
}

const ansiColors = [
  '#555555',
  '#ee6666',
  '#8ed08c',
  '#ffee66',
  '#79b8ff',
  '#c49bff',
  '#72d5d5',
  '#eeeeee',
  '#999999',
  '#ff8888',
  '#a8eda6',
  '#fff899',
  '#a0ceff',
  '#dabaff',
  '#9ff0f0',
  '#ffffff',
];
const ansiSequence = /\u001b(?:\][^\u0007]*?(?:\u0007|\u001b\\)|\[[0-?]*[ -/]*[@-~]|[=>])/g;

const indexedColor = (index: number): string | undefined => {
  if (!Number.isInteger(index) || index < 0 || index > 255) return undefined;
  if (index < 16) return ansiColors[index];
  if (index >= 232) {
    const grey = 8 + (index - 232) * 10;
    return `rgb(${grey}, ${grey}, ${grey})`;
  }
  const value = index - 16;
  const level = (component: number) => (component === 0 ? 0 : 55 + component * 40);
  return `rgb(${level(Math.floor(value / 36))}, ${level(Math.floor(value / 6) % 6)}, ${level(value % 6)})`;
};

export const parseLogText = (message: string): LogTextSegment[] => {
  const segments: LogTextSegment[] = [];
  let style: LogTextStyle = {};
  let offset = 0;
  const normalized = message.replace(/\r\n?/g, '\n');
  for (const match of normalized.matchAll(ansiSequence)) {
    if (match.index > offset) segments.push({ text: normalized.slice(offset, match.index), style: { ...style } });
    offset = match.index + match[0].length;
    if (!match[0].startsWith('\u001b[') || !match[0].endsWith('m')) continue;
    const codes = match[0]
      .slice(2, -1)
      .split(';')
      .map((value) => (value === '' ? 0 : Number(value)));
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) style = {};
      else if (code === 1) style.fontWeight = 'bold';
      else if (code === 2) style.opacity = 0.7;
      else if (code === 3) style.fontStyle = 'italic';
      else if (code === 4) style.textDecoration = 'underline';
      else if (code === 9) style.textDecoration = 'line-through';
      else if (code === 22) {
        delete style.fontWeight;
        delete style.opacity;
      } else if (code === 23) delete style.fontStyle;
      else if (code === 24 || code === 29) delete style.textDecoration;
      else if (code === 39) delete style.color;
      else if (code === 49) delete style.backgroundColor;
      else if (code >= 30 && code <= 37) style.color = ansiColors[code - 30];
      else if (code >= 90 && code <= 97) style.color = ansiColors[code - 90 + 8];
      else if (code >= 40 && code <= 47) style.backgroundColor = ansiColors[code - 40];
      else if (code >= 100 && code <= 107) style.backgroundColor = ansiColors[code - 100 + 8];
      else if (code === 38 || code === 48) {
        let color: string | undefined;
        if (codes[i + 1] === 5) {
          color = indexedColor(codes[i + 2]);
          i += 2;
        } else if (codes[i + 1] === 2) {
          const rgb = codes.slice(i + 2, i + 5);
          if (rgb.length === 3 && rgb.every((value) => Number.isInteger(value) && value >= 0 && value <= 255))
            color = `rgb(${rgb.join(', ')})`;
          i += 4;
        }
        if (color) style[code === 38 ? 'color' : 'backgroundColor'] = color;
      }
    }
  }
  if (offset < normalized.length) segments.push({ text: normalized.slice(offset), style: { ...style } });
  return segments;
};

export const plainLogMessage = (message: string): string =>
  parseLogText(message)
    .map(({ text }) => text)
    .join('');

export const logSeverity = (entry: DeviceLogEntry): 'error' | 'warning' | 'info' | 'debug' | 'default' => {
  if (entry.isStdErr) return 'error';
  const message = plainLogMessage(entry.message).trim();
  if (message.startsWith('{')) {
    try {
      const body: unknown = JSON.parse(message);
      if (body && typeof body === 'object') {
        const fields = body as Record<string, unknown>;
        const level = String(fields.level ?? fields.severity ?? '').toLowerCase();
        if (['error', 'fatal', 'panic'].includes(level)) return 'error';
        if (['warn', 'warning'].includes(level)) return 'warning';
        if (['info', 'information'].includes(level)) return 'info';
        if (['debug', 'trace'].includes(level)) return 'debug';
      }
    } catch {
      // A message beginning with "{" is not necessarily structured JSON.
    }
  }
  return entry.isSystem ? 'warning' : 'default';
};

export const parseDeviceLogs = (value: unknown): DeviceLogEntry[] => {
  if (!Array.isArray(value)) throw new Error('The logs endpoint returned an invalid log list.');
  return value.map((row: unknown) => {
    if (!row || typeof row !== 'object') throw new Error('The logs endpoint returned an invalid log entry.');
    const entry = row as Record<string, unknown>;
    if (
      (typeof entry.timestamp !== 'number' && typeof entry.timestamp !== 'string') ||
      typeof entry.message !== 'string'
    )
      throw new Error('The logs endpoint returned an invalid log entry.');
    const timestamp = new Date(entry.timestamp);
    if (!Number.isFinite(timestamp.getTime())) throw new Error('The logs endpoint returned an invalid timestamp.');
    if (entry.serviceId != null && (!Number.isSafeInteger(Number(entry.serviceId)) || Number(entry.serviceId) <= 0))
      throw new Error('The logs endpoint returned an invalid service identifier.');
    return {
      timestamp: timestamp.toISOString(),
      message: entry.message,
      ...(entry.serviceId == null ? {} : { serviceId: Number(entry.serviceId) }),
      ...(typeof entry.isStdErr === 'boolean' ? { isStdErr: entry.isStdErr } : {}),
      ...(typeof entry.isSystem === 'boolean' ? { isSystem: entry.isSystem } : {}),
    };
  });
};

export interface BufferedLogEntry extends DeviceLogEntry {
  key: string;
}
export interface DeviceLogBuffer {
  entries: BufferedLogEntry[];
  after?: number;
}

export const mergeLogSnapshot = (buffer: DeviceLogBuffer, snapshot: DeviceLogEntry[]): DeviceLogBuffer => {
  const entries = new Map(buffer.entries.map((entry) => [entry.key, entry]));
  const occurrences = new Map<string, number>();
  for (const entry of snapshot) {
    if (buffer.after != null && Date.parse(entry.timestamp) <= buffer.after) continue;
    const identity = JSON.stringify([entry.timestamp, entry.serviceId, entry.message, entry.isStdErr, entry.isSystem]);
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    const key = `${identity}:${occurrence}`;
    if (!entries.has(key)) entries.set(key, { ...entry, key });
  }
  const sorted = [...entries.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const removed = sorted.length - maximumLogEntries;
  return {
    entries: sorted.slice(Math.max(0, removed)),
    after: removed > 0 ? Math.max(buffer.after ?? 0, Date.parse(sorted[removed - 1].timestamp)) : buffer.after,
  };
};

export const clearLogBuffer = (buffer: DeviceLogBuffer, now = Date.now()): DeviceLogBuffer => ({
  entries: [],
  after: Math.max(now, buffer.after ?? 0, ...buffer.entries.map((entry) => Date.parse(entry.timestamp))),
});

export const selectedLogSources = (entry: DeviceLogEntry, selections: DeviceLogServiceSelection[]) =>
  selections.filter((selection) => matchesDeviceServiceLog(entry, selection));

export const exportDeviceLogs = (entries: DeviceLogEntry[], selections: DeviceLogServiceSelection[]): string =>
  entries
    .map(
      (entry) =>
        `[${entry.timestamp}] [${selectedLogSources(entry, selections)
          .map(({ serviceName }) => serviceName)
          .join(', ')}] ${plainLogMessage(entry.message)}`,
    )
    .join('\n') + (entries.length ? '\n' : '');
