import { Router } from 'express';
import { attemptsController } from './attempts.controller';
import { validateBody } from '../../middleware/validate.middleware';
import { SubmitAnswerSchema } from './attempts.schema';

const router = Router();

router.post('/:attemptId/answers', validateBody(SubmitAnswerSchema), (req, res, next) => {
  attemptsController.submitAnswer(req, res, next);
});

router.post('/:attemptId/finish', (req, res, next) => {
  attemptsController.finish(req, res, next);
});

router.get('/:attemptId', (req, res, next) => {
  attemptsController.getById(req, res, next);
});

export const attemptsRoutes = router;
