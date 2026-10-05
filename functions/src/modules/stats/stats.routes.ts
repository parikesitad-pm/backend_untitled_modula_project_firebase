import { Router } from 'express';
import { statsController } from './stats.controller';
import { requireAuth, requireWorkspaceCapability } from '../../middleware/auth.middleware';

const router = Router();

router.get(
  '/groups/:groupId/comparison',
  requireAuth(),
  requireWorkspaceCapability('read:content', { workspaceIdFrom: 'resource', resourceType: 'group' }),
  (req, res, next) => {
    statsController.getGroupComparison(req, res, next);
  }
);

export const statsRoutes = router;
