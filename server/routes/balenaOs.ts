import { json, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { buildAccessContext, canManageBalenaOsCatalog } from '../accessControl';
import { BalenaOsSyncValidationError, balenaOsSyncManager, type BalenaOsSyncMode } from '../balenaOsSync';
import authorize, { type AuthorizedLocals } from '../middleware/authorize';
import dosProtect from '../middleware/dosProtect';
import { databaseReader } from './adminDatabase';
import {
  authenticatedRequestSucceeded,
  authenticationRateKey,
  inspectAuthentication,
} from '../middleware/authenticationRateLimit';

const router = Router();
router.use(json());

const statusProtect = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 600,
  skipSuccessfulRequests: true,
  requestWasSuccessful: authenticatedRequestSucceeded,
  keyGenerator: authenticationRateKey,
});

const requireBalenaOsAccess = async (
  authorization: string,
  auth: AuthorizedLocals['auth'],
): Promise<number | undefined> => {
  const database = databaseReader(authorization);
  const context = await buildAccessContext(auth, database);
  if (!context.enforcementEnabled || context.globalAdmin) {
    return undefined;
  }
  const organizations = await database.list('organization', new URLSearchParams({ name: 'eq.balena_os' }));
  const organizationId = Number(organizations[0]?.id);
  if (!Number.isInteger(organizationId) || !canManageBalenaOsCatalog(context, organizationId)) {
    throw new Error('BalenaOS catalog access requires membership in the balena_os organization.');
  }
  return organizationId;
};

router.get('/balena-os/status', inspectAuthentication(), statusProtect, authorize, async (req, res) => {
  try {
    await requireBalenaOsAccess(req.headers.authorization!, (res.locals as AuthorizedLocals).auth);
    res.json(balenaOsSyncManager.getStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read BalenaOS synchronization status.';
    res.status(message.includes('requires membership') ? 403 : 502).json({ message });
  }
});

router.get('/balena-os/catalog', ...dosProtect, authorize, async (req, res) => {
  try {
    const authorization = req.headers.authorization!;
    await requireBalenaOsAccess(authorization, (res.locals as AuthorizedLocals).auth);
    res.json(await balenaOsSyncManager.getCatalog(authorization));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to inspect the BalenaOS catalog.';
    res.status(message.includes('requires membership') ? 403 : 502).json({ message });
  }
});

router.post('/balena-os/sync', ...dosProtect, authorize, async (req, res) => {
  try {
    const mode = String(req.body?.mode ?? 'all');
    if (!['all', 'latest-and-in-use', 'newer-and-in-use', 'in-use', 'single'].includes(mode)) {
      res.status(400).json({ message: 'A valid BalenaOS synchronization mode is required.' });
      return;
    }
    const version = typeof req.body?.version === 'string' ? req.body.version.trim() : undefined;
    const authorization = req.headers.authorization!;
    const auth = (res.locals as AuthorizedLocals).auth;
    const authorizedOrganizationId = await requireBalenaOsAccess(authorization, auth);
    const organizationId =
      authorizedOrganizationId ?? (await balenaOsSyncManager.getBalenaOsOrganizationId(authorization));
    if (!organizationId) {
      res.status(400).json({
        message:
          'The balena_os system organization must exist and be accessible to the signed-in administrator before synchronizing the BalenaOS catalog.',
      });
      return;
    }
    res.status(202).json(
      balenaOsSyncManager.start(authorization, organizationId, {
        mode: mode as BalenaOsSyncMode,
        version,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to start BalenaOS synchronization.';
    const status = message.includes('requires membership')
      ? 403
      : message.includes('already running')
        ? 409
        : error instanceof BalenaOsSyncValidationError
          ? 400
          : 502;
    res.status(status).json({ message });
  }
});

export default router;
