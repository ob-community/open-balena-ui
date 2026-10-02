import { validateContainerName } from './validation';

export type ClientControl =
  | { v: 1; type: 'auth'; ticket: string }
  | {
      v: 1;
      type: 'open';
      channel: number;
      target: 'host' | 'container';
      container?: string;
      cols: number;
      rows: number;
    }
  | { v: 1; type: 'resize'; channel: number; cols: number; rows: number }
  | { v: 1; type: 'close'; channel: number }
  | { v: 1; type: 'heartbeat'; nonce?: string };

const dimensions = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 1000;
const channel = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 0xffffffff;

export const parseControlMessage = (data: string): ClientControl => {
  if (Buffer.byteLength(data) > 64 * 1024) throw new Error('Control message is too large.');
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(data) as Record<string, unknown>;
  } catch {
    throw new Error('Control message must be valid JSON.');
  }
  if (!value || value.v !== 1 || typeof value.type !== 'string')
    throw new Error('Unsupported remote protocol message.');
  if (value.type === 'auth' && typeof value.ticket === 'string') return { v: 1, type: 'auth', ticket: value.ticket };
  if (value.type === 'heartbeat' && (value.nonce == null || typeof value.nonce === 'string')) {
    return { v: 1, type: 'heartbeat', ...(value.nonce == null ? {} : { nonce: value.nonce }) };
  }
  if (!channel(value.channel)) throw new Error('Invalid channel identifier.');
  if (value.type === 'close') return { v: 1, type: 'close', channel: value.channel };
  if (value.type === 'resize' && dimensions(value.cols) && dimensions(value.rows)) {
    return { v: 1, type: 'resize', channel: value.channel, cols: value.cols, rows: value.rows };
  }
  if (
    value.type === 'open' &&
    dimensions(value.cols) &&
    dimensions(value.rows) &&
    (value.target === 'host' || value.target === 'container')
  ) {
    const containerName = value.target === 'container' ? validateContainerName(value.container) : undefined;
    return {
      v: 1,
      type: 'open',
      channel: value.channel,
      target: value.target,
      ...(containerName ? { container: containerName } : {}),
      cols: value.cols,
      rows: value.rows,
    };
  }
  throw new Error('Invalid remote protocol message.');
};

export const encodeChannelData = (channel: number, payload: Buffer): Buffer => {
  const header = Buffer.allocUnsafe(4);
  header.writeUInt32BE(channel);
  return Buffer.concat([header, payload]);
};

export const decodeChannelData = (message: Buffer): { channel: number; payload: Buffer } => {
  if (message.length < 5) throw new Error('Invalid binary channel message.');
  const channelId = message.readUInt32BE(0);
  if (channelId === 0) throw new Error('Invalid binary channel message.');
  return { channel: channelId, payload: message.subarray(4) };
};
