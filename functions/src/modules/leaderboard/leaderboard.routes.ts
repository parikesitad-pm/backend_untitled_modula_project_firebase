import { Router } from 'express';
import { leaderboardController } from './leaderboard.controller';

const router = Router();

router.get('/:slug', (req, res, next) => {
  leaderboardController.getBySlug(req, res, next);
});

export const leaderboardRoutes = router;
