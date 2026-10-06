import { Router } from 'express';
import registryImageRoutes from './registryImage';
import adminDatabaseRoutes from './adminDatabase';
import deviceUpdateRoutes from './deviceUpdates';
import balenaOsRoutes from './balenaOs';
import deviceTypeMetadataRoutes from './deviceTypeMetadata';

export const createApiRouter = (remoteRouter?: Router): Router => {
  const router = Router();
  if (remoteRouter) {
    router.use(remoteRouter);
  } else {
    router.all(/^\/remote(?:\/|$)/, (_req, res) => {
      res.status(503).json({ error: 'remote_access_unavailable', message: 'Remote access is not configured.' });
    });
  }
  router.use(deviceTypeMetadataRoutes);
  router.use(registryImageRoutes);
  router.use(adminDatabaseRoutes);
  router.use(deviceUpdateRoutes);
  router.use(balenaOsRoutes);
  return router;
};
