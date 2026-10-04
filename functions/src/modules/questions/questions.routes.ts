import { Router } from 'express';
import { questionsController } from './questions.controller';
import { requireAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  UpdateQuestionSchema,
  ReorderQuestionsSchema,
} from './questions.schema';

const router = Router();

router.use(requireAuth());

router.post('/reorder', validateBody(ReorderQuestionsSchema), (req, res, next) => {
  questionsController.reorder(req, res, next);
});

router.patch('/:id', validateBody(UpdateQuestionSchema), (req, res, next) => {
  questionsController.update(req, res, next);
});

router.delete('/:id', (req, res, next) => {
  questionsController.delete(req, res, next);
});

export const questionsRoutes = router;
