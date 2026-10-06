import { Router } from 'express';
import { assessmentsController } from './assessments.controller';

const router = Router();

// Public participant assessment by slug (no auth required)
router.get('/:slug', (req, res, next) => {
  assessmentsController.getBySlugPublic(req, res, next);
});

export const publicAssessmentsRoutes = router;

