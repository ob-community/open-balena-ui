import { Router, static as staticFiles } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import serialize from 'serialize-javascript';
import {
  authenticatedRequestSucceeded,
  createAuthenticationRateKey,
  rejectInvalidAuthentication,
} from '../middleware/authenticationRateLimit';

const clientEnvPlaceholder = '<!--OBUI_RUNTIME_ENV-->';
const clientEnvKeys = [
  'REACT_APP_OPEN_BALENA_REMOTE_URL',
  'REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED',
  'REACT_APP_OPEN_BALENA_API_URL',
  'REACT_APP_OPEN_BALENA_API_VERSION',
  'REACT_APP_OPEN_BALENA_ODATA_VERSION',
  'REACT_APP_BANNER_IMAGE',
  'REACT_APP_OPEN_BALENA_UI_URL',
];

interface ClientHtmlOptions {
  clientDir?: string;
  env?: Readonly<Record<string, string | undefined>>;
  remoteAccessEnabled?: boolean;
  maxRequests?: number;
  windowMs?: number;
}

export const createClientRouter = (options: ClientHtmlOptions = {}): Router => {
  const router = Router();
  const assets = staticFiles(options.clientDir ?? 'dist/client', { index: false });
  router.use((req, res, next) => {
    let pathname: string;
    try {
      pathname = decodeURIComponent(req.path).replace(/\\/g, '/').replace(/\/+$/, '');
    } catch {
      res.status(400).json({ message: 'Invalid request path.' });
      return;
    }
    const name = path.posix
      .basename(pathname)
      .split(':')[0]
      .replace(/[. ]+$/, '');
    if (/\.html?$/i.test(name)) {
      next();
      return;
    }
    assets(req, res, next);
  });
  router.use(createClientHtmlRouter(options));
  return router;
};

export const createClientHtmlRouter = ({
  clientDir = 'dist/client',
  env = process.env,
  remoteAccessEnabled = false,
  maxRequests = 600,
  windowMs = 5 * 60 * 1000,
}: ClientHtmlOptions = {}): Router => {
  const router = Router();
  const indexPath = path.resolve(clientDir, 'index.html');
  const protect = rateLimit({
    windowMs,
    max: maxRequests,
    skipSuccessfulRequests: true,
    requestWasSuccessful: authenticatedRequestSucceeded,
    keyGenerator: createAuthenticationRateKey(() => env.OPEN_BALENA_JWT_SECRET),
  });
  router.get(/.*/, protect, rejectInvalidAuthentication, (_req, res) => {
    if (!fs.existsSync(indexPath)) {
      res.status(404).send('Client build not found');
      return;
    }

    const rawHtml = fs.readFileSync(indexPath, 'utf-8');
    if (!rawHtml.includes(clientEnvPlaceholder)) {
      res.type('text/html').send(rawHtml);
      return;
    }

    const clientEnv = clientEnvKeys.reduce<Record<string, string>>((acc, key) => {
      const value = env[key];
      if (typeof value === 'string') acc[key] = value;
      return acc;
    }, {});
    clientEnv.REACT_APP_OPEN_BALENA_BUILT_IN_REMOTE_ENABLED = remoteAccessEnabled ? 'true' : 'false';

    const serializedEnv = serialize(clientEnv, { isJSON: true });
    const injection = `<script>window.__OBUI_ENV__ = Object.freeze(${serializedEnv});</script>`;
    res.type('text/html').send(rawHtml.replace(clientEnvPlaceholder, injection));
  });
  return router;
};
