import { Router } from 'express';
import { assetsController } from './assets.controller';
import { requireAuth, requireWorkspaceCapability } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { UploadIntentInputSchema, ConfirmAssetInputSchema } from './assets.schema';

export const assetsRoutes = Router();

assetsRoutes.post(
  '/upload-intent',
  requireAuth(),
  requireWorkspaceCapability('write:content', { workspaceIdFrom: 'resource', resourceType: 'asset' }),
  validateBody(UploadIntentInputSchema, 422),
  (req, res, next) => assetsController.createUploadIntent(req, res, next)
);

assetsRoutes.post(
  '/confirm',
  requireAuth(),
  requireWorkspaceCapability('write:content', { workspaceIdFrom: 'resource', resourceType: 'asset' }),
  validateBody(ConfirmAssetInputSchema, 422),
  (req, res, next) => assetsController.confirmAsset(req, res, next)
);
