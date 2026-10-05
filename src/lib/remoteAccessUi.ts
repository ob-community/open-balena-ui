export const isAbsoluteDevicePath = (path: string): boolean => path.trim().startsWith('/') && !path.includes('\0');

export const transferFilename = (path: string): string => {
  const segments = path.split('/').filter(Boolean);
  return segments[segments.length - 1] ?? 'download';
};

export const isTransferCancellation = (error: unknown, signal: AbortSignal): boolean =>
  signal.aborted || (error instanceof Error && error.name === 'AbortError');

export const createTerminalDecoder = (channel: number): ((buffer: ArrayBuffer) => string) => {
  const decoder = new TextDecoder();
  return (buffer) => {
    if (buffer.byteLength < 5 || new DataView(buffer).getUint32(0) !== channel) {
      throw new Error('The terminal server returned an invalid binary message.');
    }
    return decoder.decode(new Uint8Array(buffer, 4), { stream: true });
  };
};
