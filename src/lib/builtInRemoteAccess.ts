export interface RemoteSession {
  version: 1;
  ticket: string;
  expiresAt: number;
}

export interface RemoteControlMessage {
  v: 1;
  type: string;
  channel?: number;
  code?: number | null;
  signal?: string | null;
  message?: string;
}

export const remoteWebSocketUrl = (location: Pick<Location, 'protocol' | 'host'> = window.location): string =>
  `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/remote/ws`;

export const encodeTerminalInput = (channel: number, input: string): ArrayBuffer => {
  const payload = new TextEncoder().encode(input);
  const message = new Uint8Array(4 + payload.length);
  new DataView(message.buffer).setUint32(0, channel);
  message.set(payload, 4);
  return message.buffer;
};

export const decodeTerminalOutput = async (data: Blob | ArrayBuffer): Promise<{ channel: number; output: string }> => {
  const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
  if (buffer.byteLength < 5) {
    throw new Error('The terminal server returned an invalid binary message.');
  }
  const channel = new DataView(buffer).getUint32(0);
  if (channel === 0) {
    throw new Error('The terminal server returned an invalid channel.');
  }
  return { channel, output: new TextDecoder().decode(buffer.slice(4)) };
};

export const remoteTransferUrl = (operation: 'upload' | 'download', deviceUuid: string, path: string): string => {
  const query = new URLSearchParams({ deviceUuid, path });
  return `/remote/sftp/${operation}?${query.toString()}`;
};

export const responseError = async (response: Response, fallback: string): Promise<Error> => {
  let message = fallback;
  try {
    const body = (await response.json()) as { message?: unknown };
    if (typeof body.message === 'string' && body.message.trim()) {
      message = body.message;
    }
  } catch {
    // The response is not required to contain JSON.
  }
  return new Error(message);
};
