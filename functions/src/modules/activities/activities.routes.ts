import { Router } from 'express';
import { activitiesController } from './activities.controller';
import { requireAuth, requireCapability } from '../../middleware/auth.middleware';
import { validateBody, validateQuery } from '../../middleware/validate.middleware';
import {
  CreateActivitySchema,
  UpdateActivitySchema,
  ActivityQuerySchema,
} from './activities.schema';
import { questionsController } from '../questions/questions.controller';
import { CreateQuestionSchema } from '../questions/questions.schema';
import { statsController } from '../stats/stats.controller';

const router = Router();

router.use(requireAuth());

router.get('/', validateQuery(ActivityQuerySchema), (req, res, next) => {
  activitiesController.list(req, res, next);
});

router.post('/', validateBody(CreateActivitySchema), (req, res, next) => {
  activitiesController.create(req, res, next);
});

router.get('/:id', (req, res, next) => {
  activitiesController.getById(req, res, next);
});

router.patch('/:id', validateBody(UpdateActivitySchema), (req, res, next) => {
  activitiesController.update(req, res, next);
});

router.delete('/:id', requireCapability('activity:delete'), (req, res, next) => {
  activitiesController.delete(req, res, next);
});

router.post('/:id/publish', requireCapability('activity:lifecycle'), (req, res, next) => {
  activitiesController.publish(req, res, next);
});

router.post('/:id/close', requireCapability('activity:lifecycle'), (req, res, next) => {
  activitiesController.close(req, res, next);
});

router.post('/:id/archive', requireCapability('activity:lifecycle'), (req, res, next) => {
  activitiesController.archive(req, res, next);
});

router.get('/:id/questions', (req, res, next) => {
  questionsController.getByActivity(req, res, next);
});

router.post('/:id/questions', validateBody(CreateQuestionSchema), (req, res, next) => {
  questionsController.create(req, res, next);
});

router.get('/:id/stats', (req, res, next) => {
  statsController.getActivityStats(req, res, next);
});

router.get('/:id/participants', requireCapability('read:pii'), (req, res, next) => {
  statsController.getParticipants(req, res, next);
});

router.get('/:id/responses', requireCapability('read:pii'), (req, res, next) => {
  statsController.getResponses(req, res, next);
});

router.get('/:id/question-stats', (req, res, next) => {
  statsController.getQuestionStats(req, res, next);
});

export const activitiesRoutes = router;
