import express from 'express';
import dotenv from 'dotenv';
import { createServer } from 'node:http';
import { createApiRouter } from './routes/api';
import { createClientRouter } from './routes/clientHtml';
import { bootstrapGlobalAdminFromEnvironment } from './bootstrapGlobalAdmin';
import { createRemoteAccessBackend, type RemoteAccessBackend } from './remoteAccess';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';
const CLIENT_DIR = 'dist/client';

const app = express();
const server = createServer(app);
let remoteAccess: RemoteAccessBackend | undefined;

if (process.env.OPEN_BALENA_TUNNEL_URL) {
  try {
    remoteAccess = createRemoteAccessBackend();
    remoteAccess.attach(server);
  } catch (error) {
    console.error('Unable to configure built-in remote access:', error);
  }
}
if (!remoteAccess) {
  server.on('upgrade', (request, socket) => {
    if (new URL(request.url ?? '', 'http://localhost').pathname === '/remote/ws') {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
    } else {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      socket.destroy();
    }
  });
}
app.use(createApiRouter(remoteAccess?.router));
app.use(createClientRouter({ clientDir: CLIENT_DIR, remoteAccessEnabled: Boolean(remoteAccess) }));

const start = async (): Promise<void> => {
  await bootstrapGlobalAdminFromEnvironment();
  server.listen(PORT, HOST, () => {
    console.log(`Running open-balena-ui on http://${HOST}:${PORT}`);
  });
};

let stopping = false;
const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  await remoteAccess?.shutdown();
  await new Promise<void>((resolve) => server.close(() => resolve()));
};

process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());

start().catch((error) => {
  console.error('Unable to start open-balena-ui:', error);
  process.exitCode = 1;
});
