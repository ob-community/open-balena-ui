import type { Server } from 'node:http';

export const attachUnavailableRemoteUpgrade = (server: Server): void => {
  server.on('upgrade', (request, socket) => {
    let pathname: string;
    try {
      pathname = new URL(request.url ?? '', 'http://localhost').pathname;
    } catch {
      socket.destroy();
      return;
    }
    const status = pathname === '/remote/ws' ? '503 Service Unavailable' : '404 Not Found';
    socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\n\r\n`, () => socket.destroy());
  });
};
