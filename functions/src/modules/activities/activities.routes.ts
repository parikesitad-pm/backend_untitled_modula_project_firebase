import { Router } from 'express';
import { activitiesController } from './activities.controller';
import { requireAuth, requireWorkspaceCapability } from '../../middleware/auth.middleware';
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

router.post(
  '/',
  validateBody(CreateActivitySchema),
  requireWorkspaceCapability('write:content', { workspaceIdFrom: 'body' }),
  (req, res, next) => {
    activitiesController.create(req, res, next);
  }
);

router.get(
  '/:id',
  requireWorkspaceCapability('read:content', { workspaceIdFrom: 'resource', resourceType: 'activity' }),
  (req, res, next) => {
    activitiesController.getById(req, res, next);
  }
);

router.patch(
  '/:id',
  requireWorkspaceCapability('write:content', { workspaceIdFrom: 'resource', resourceType: 'activity' }),
  validateBody(UpdateActivitySchema),
  (req, res, next) => {
    activitiesController.update(req, res, next);
  }
);

router.delete(
  '/:id',
  requireWorkspaceCapability('activity:delete', { workspaceIdFrom: 'resource', resourceType: 'activity' }),
  (req, res, next) => {
    activitiesController.delete(req, res, next);
  }
);

router.post(
  '/:id/publish',
  requireWorkspaceCapability('activity:lifecycle', { workspaceIdFrom: 'resource', resourceType: 'activity' }),
  (req, res, next) => {
    activitiesController.publish(req, res, next);
  }
);

router.post(
  '/:id/close',
  requireWorkspaceCapability('activity:lifecycle', { workspaceIdFrom: 'resource', resourceType: 'activity' }),
  (req, res, next) => {
    activitiesController.close(req, res, next);
  }
);

router.post(
  '/:id/archive',
  requireWorkspaceCapability('activity:lifecycle', { workspaceIdFrom: 'resource', resourceType: 'activity' }),
  (req, res, next) => {
    activitiesController.archive(req, res, next);
  }
);

router.get(
  '/:id/questions',
  requireWorkspaceCapability('read:content', { workspaceIdFrom: 'resource', resourceType: 'activity' }),
  (req, res, next) => {
    questionsController.getByActivity(req, res, next);
  }
);

router.post(
  '/:id/questions',
  requireWorkspaceCapability('write:content', { workspaceIdFrom: 'resource', resourceType: 'activity' }),
  validateBody(CreateQuestionSchema),
  (req, res, next) => {
    questionsController.create(req, res, next);
  }
);

router.get(
  '/:id/stats',
  requireWorkspaceCapability('read:content', { workspaceIdFrom: 'resource', resourceType: 'activity' }),
  (req, res, next) => {
    statsController.getActivityStats(req, res, next);
  }
);

router.get(
  '/:id/participants',
  requireWorkspaceCapability('read:pii', { workspaceIdFrom: 'resource', resourceType: 'activity' }),
  (req, res, next) => {
    statsController.getParticipants(req, res, next);
  }
);

router.get(
  '/:id/participants/:participantId',
  requireWorkspaceCapability('read:pii', { workspaceIdFrom: 'resource', resourceType: 'activity' }),
  (req, res, next) => {
    statsController.getParticipantDetail(req, res, next);
  }
);

router.get(
  '/:id/responses',
  requireWorkspaceCapability('read:pii', { workspaceIdFrom: 'resource', resourceType: 'activity' }),
  (req, res, next) => {
    statsController.getResponses(req, res, next);
  }
);

router.get(
  '/:id/question-stats',
  requireWorkspaceCapability('read:content', { workspaceIdFrom: 'resource', resourceType: 'activity' }),
  (req, res, next) => {
    statsController.getQuestionStats(req, res, next);
  }
);

export const activitiesRoutes = router;
