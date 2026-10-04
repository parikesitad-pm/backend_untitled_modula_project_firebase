import { Router } from 'express';
import { statsController } from './stats.controller';
import { requireAuth } from '../../middleware/auth.middleware';

const router = Router();

router.use(requireAuth());

router.get('/groups/:groupId/comparison', (req, res, next) => {
  statsController.getGroupComparison(req, res, next);
});

export const statsRoutes = router;
