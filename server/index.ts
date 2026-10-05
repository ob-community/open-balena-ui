import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import serialize from 'serialize-javascript';
import registryImageRoutes from './routes/registryImage';
import adminDatabaseRoutes from './routes/adminDatabase';
import deviceUpdateRoutes from './routes/deviceUpdates';
import balenaOsRoutes from './routes/balenaOs';
import deviceTypeMetadataRoutes from './routes/deviceTypeMetadata';
import { bootstrapGlobalAdminFromEnvironment } from './bootstrapGlobalAdmin';
import { createRemoteAccessBackend, type RemoteAccessBackend } from './remoteAccess';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';
const CLIENT_DIR = 'dist/client';
const CLIENT_ENV_PLACEHOLDER = '<!--OBUI_RUNTIME_ENV-->';
const CLIENT_ENV_KEYS = [
  'REACT_APP_OPEN_BALENA_REMOTE_URL',
  'REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED',
  'REACT_APP_OPEN_BALENA_API_URL',
  'REACT_APP_OPEN_BALENA_API_VERSION',
  'REACT_APP_OPEN_BALENA_ODATA_VERSION',
  'REACT_APP_BANNER_IMAGE',
  'REACT_APP_OPEN_BALENA_UI_URL',
];

const app = express();
const server = createServer(app);
let remoteAccess: RemoteAccessBackend | undefined;

app.use('/', deviceTypeMetadataRoutes);
app.use('/', registryImageRoutes);
app.use('/', adminDatabaseRoutes);
app.use('/', deviceUpdateRoutes);
app.use('/', balenaOsRoutes);
if (process.env.OPEN_BALENA_TUNNEL_URL) {
  try {
    remoteAccess = createRemoteAccessBackend();
    app.use('/', remoteAccess.router);
    remoteAccess.attach(server);
  } catch (error) {
    console.error('Unable to configure built-in remote access:', error);
  }
}
if (!remoteAccess) {
  app.all(/^\/remote(?:\/|$)/, (_req, res) => {
    res.status(503).json({ error: 'remote_access_unavailable', message: 'Remote access is not configured.' });
  });
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
app.use(express.static(CLIENT_DIR, { index: false }));
app.get(/.*/, (_req, res) => {
  const indexPath = path.join(process.cwd(), CLIENT_DIR, 'index.html');

  if (!existsSync(indexPath)) {
    res.status(404).send('Client build not found');
    return;
  }

  const rawHtml = readFileSync(indexPath, 'utf-8');
  if (!rawHtml.includes(CLIENT_ENV_PLACEHOLDER)) {
    res.type('text/html').send(rawHtml);
    return;
  }

  const clientEnv = CLIENT_ENV_KEYS.reduce<Record<string, string>>((acc, key) => {
    const value = process.env[key];
    if (typeof value === 'string') {
      acc[key] = value;
    }
    return acc;
  }, {});
  clientEnv.REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED = remoteAccess ? 'true' : 'false';

  const serializedEnv = serialize(clientEnv, { isJSON: true });
  const injection = `<script>window.__OBUI_ENV__ = Object.freeze(${serializedEnv});</script>`;
  res.type('text/html').send(rawHtml.replace(CLIENT_ENV_PLACEHOLDER, injection));
});

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
