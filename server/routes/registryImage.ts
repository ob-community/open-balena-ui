import { json, Router } from 'express';
import authorize from '../middleware/authorize';
import dosProtect from '../middleware/dosProtect';
import { deleteRegistryImage, deleteOrphanedRegistryImages } from '../controller/registryImage';

interface DeleteRegistryImageRequest {
  imageLocationHash?: string;
}

interface DeleteOrphanedRegistryImagesRequest {
  databaseImages?: string[];
}

interface ErrorResponse {
  success: false;
  message: string;
}

interface DeleteRegistryImageSuccessResponse {
  success: true;
}

interface DeleteOrphanedRegistryImagesSuccessResponse {
  success: true;
  orphanedImages: string[];
  imagesToDelete: string[];
}

const router = Router();

router.use(json());

router.post<Record<string, never>, DeleteRegistryImageSuccessResponse | ErrorResponse, DeleteRegistryImageRequest>(
  '/deleteRegistryImage',
  ...dosProtect,
  authorize,
  async (req, res) => {
    const { imageLocationHash } = req.body;

    if (!imageLocationHash) {
      res.status(406).json({ success: false, message: 'Request is lacking imageLocationHash in body context' });
      return;
    }

    try {
      await deleteRegistryImage(imageLocationHash);
      res.status(200).json({ success: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete registry image';
      res.status(400).json({ success: false, message });
    }
  },
);

router.post<
  Record<string, never>,
  DeleteOrphanedRegistryImagesSuccessResponse | ErrorResponse,
  DeleteOrphanedRegistryImagesRequest
>('/deleteOrphanedRegistryImages', ...dosProtect, authorize, async (req, res) => {
  const { databaseImages } = req.body;

  if (!Array.isArray(databaseImages)) {
    res.status(406).json({ success: false, message: 'Request is lacking databaseImages in body context' });
    return;
  }

  try {
    const summary = await deleteOrphanedRegistryImages(databaseImages);
    res.status(200).json({ success: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete orphaned registry images';
    res.status(400).json({ success: false, message });
  }
});

export default router;
