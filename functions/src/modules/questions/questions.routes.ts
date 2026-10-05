import { Router } from 'express';
import { questionsController } from './questions.controller';
import { requireAuth, requireWorkspaceCapability } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  UpdateQuestionSchema,
  ReorderQuestionsSchema,
} from './questions.schema';

const router = Router();

router.use(requireAuth());

router.post(
  '/reorder',
  validateBody(ReorderQuestionsSchema),
  requireWorkspaceCapability('write:content', { workspaceIdFrom: 'resource', resourceType: 'question_reorder' }),
  (req, res, next) => {
    questionsController.reorder(req, res, next);
  }
);

router.patch(
  '/:id',
  requireWorkspaceCapability('write:content', { workspaceIdFrom: 'resource', resourceType: 'question' }),
  validateBody(UpdateQuestionSchema),
  (req, res, next) => {
    questionsController.update(req, res, next);
  }
);

router.delete(
  '/:id',
  requireWorkspaceCapability('write:content', { workspaceIdFrom: 'resource', resourceType: 'question' }),
  (req, res, next) => {
    questionsController.delete(req, res, next);
  }
);

export const questionsRoutes = router;
