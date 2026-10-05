import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'node:fs';
import path from 'node:path';
import serialize from 'serialize-javascript';
import {
  authenticatedRequestSucceeded,
  authenticationRateKey,
  inspectAuthentication,
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
    keyGenerator: authenticationRateKey,
  });
  router.get(
    /.*/,
    inspectAuthentication(() => env.OPEN_BALENA_JWT_SECRET),
    protect,
    rejectInvalidAuthentication,
    (_req, res) => {
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
    },
  );
  return router;
};
