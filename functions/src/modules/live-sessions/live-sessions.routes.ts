import { Router } from 'express';
import { liveSessionsController } from './live-sessions.controller';
import { requireAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  CreateLiveSessionSchema,
  JoinLiveSessionSchema,
  LiveParticipantHeartbeatSchema,
  SetQuestionIndexSchema,
} from './live-sessions.schema';

const router = Router();

// Host / Operator routes
router.use(requireAuth());

router.post(
  '/',
  validateBody(CreateLiveSessionSchema),
  liveSessionsController.create
);

router.get('/:id', liveSessionsController.getById);

router.post('/:id/start', liveSessionsController.start);

router.post(
  '/:id/question-index',
  validateBody(SetQuestionIndexSchema),
  liveSessionsController.setQuestionIndex
);

router.post('/:id/next-question', liveSessionsController.nextQuestion);

router.post('/:id/end', liveSessionsController.end);

router.get('/:id/participants', liveSessionsController.listParticipants);

export const liveSessionsRoutes = router;

// Public Live Session router
const publicRouter = Router();

publicRouter.get('/:id', liveSessionsController.getPublicSession);

publicRouter.post(
  '/:id/join',
  validateBody(JoinLiveSessionSchema),
  liveSessionsController.join
);

publicRouter.post(
  '/:id/heartbeat',
  validateBody(LiveParticipantHeartbeatSchema),
  liveSessionsController.heartbeat
);

export const publicLiveSessionsRoutes = publicRouter;
