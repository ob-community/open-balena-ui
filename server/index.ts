import express from 'express';
import dotenv from 'dotenv';
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import serialize from 'serialize-javascript';
import registryImageRoutes from './routes/registryImage';

dotenv.config();

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';
const CLIENT_DIR = 'dist/client';
const CLIENT_ENV_PLACEHOLDER = '<!--OBUI_RUNTIME_ENV-->';
const CLIENT_ENV_KEYS = [
  'REACT_APP_OPEN_BALENA_POSTGREST_URL',
  'REACT_APP_OPEN_BALENA_REMOTE_URL',
  'REACT_APP_OPEN_BALENA_API_URL',
  'REACT_APP_OPEN_BALENA_API_VERSION',
  'REACT_APP_BANNER_IMAGE',
  'REACT_APP_OPEN_BALENA_UI_URL',
];

const app = express();

app.use('/', registryImageRoutes);
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

  const serializedEnv = serialize(clientEnv, { isJSON: true });
  const injection = `<script>window.__OBUI_ENV__ = Object.freeze(${serializedEnv});</script>`;
  res.type('text/html').send(rawHtml.replace(CLIENT_ENV_PLACEHOLDER, injection));
});

app.listen(PORT, HOST, () => {
  console.log(`Running open-balena-ui on http://${HOST}:${PORT}`);
});
