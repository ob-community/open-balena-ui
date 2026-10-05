import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  authenticatedRequestSucceeded,
  createAuthenticationRateKey,
  rejectInvalidAuthentication,
} from '../middleware/authenticationRateLimit';
import {
  DeviceTypeMetadataForbiddenError,
  DeviceTypeMetadataNotFoundError,
  DeviceTypeMetadataValidationError,
  readDeviceTypeMetadata,
  validateDeviceTypeMetadataPath,
} from '../deviceTypeMetadata';

export function createDeviceTypeMetadataRouter(
  read: typeof readDeviceTypeMetadata = readDeviceTypeMetadata,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Router {
  const router = Router();
  const protect = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 600,
    skipSuccessfulRequests: true,
    requestWasSuccessful: authenticatedRequestSucceeded,
    keyGenerator: createAuthenticationRateKey(() => env.OPEN_BALENA_JWT_SECRET),
  });
  router.get(
    '/balena-os/device-types/:slug/:version/:checksum/device-type.json',
    protect,
    rejectInvalidAuthentication,
    async (req, res) => {
      try {
        const { slug, version, checksum } = req.params;
        validateDeviceTypeMetadataPath(slug, version, checksum, env.CONTRACT_ALLOWLIST);
        const body = await read(slug, version, checksum);
        res.set('Cache-Control', 'public, max-age=31536000, immutable');
        res.type('application/json').send(body);
      } catch (error) {
        const status =
          error instanceof DeviceTypeMetadataNotFoundError
            ? 404
            : error instanceof DeviceTypeMetadataValidationError
              ? 400
              : error instanceof DeviceTypeMetadataForbiddenError
                ? 403
                : 502;
        res.status(status).json({
          message: error instanceof Error ? error.message : 'Unable to read stored device type metadata.',
        });
      }
    },
  );
  return router;
}

export default createDeviceTypeMetadataRouter();
