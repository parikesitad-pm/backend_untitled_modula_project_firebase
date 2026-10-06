import { Router } from 'express';
import { assessmentsController } from './assessments.controller';
import { requireAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { CreateAssessmentSchema, UpdateAssessmentSchema } from './assessments.schema';

const router = Router();

router.use(requireAuth());

router.get('/', (req, res, next) => {
  assessmentsController.list(req, res, next);
});

router.post('/', validateBody(CreateAssessmentSchema), (req, res, next) => {
  assessmentsController.create(req, res, next);
});

router.get('/:id', (req, res, next) => {
  assessmentsController.getById(req, res, next);
});

router.patch('/:id', validateBody(UpdateAssessmentSchema), (req, res, next) => {
  assessmentsController.update(req, res, next);
});

router.delete('/:id', (req, res, next) => {
  assessmentsController.delete(req, res, next);
});

export const assessmentsRoutes = router;

