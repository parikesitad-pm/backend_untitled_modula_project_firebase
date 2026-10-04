import { Router } from 'express';
import { storageController } from './storage.controller';
import { requireAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { RequestUploadUrlSchema } from './storage.schema';

const router = Router();

router.use(requireAuth());

router.post('/upload-url', validateBody(RequestUploadUrlSchema), (req, res, next) => {
  storageController.requestUploadUrl(req, res, next);
});

export const storageRoutes = router;
