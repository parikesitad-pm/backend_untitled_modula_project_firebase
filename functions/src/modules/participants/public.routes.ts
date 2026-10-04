import { Router } from 'express';
import { publicController } from './public.controller';
import { validateBody } from '../../middleware/validate.middleware';
import { ParticipantInputSchema } from './participants.schema';

const router = Router();

router.get('/:slug', (req, res, next) => {
  publicController.getActivity(req, res, next);
});

router.post('/:slug/start', validateBody(ParticipantInputSchema), (req, res, next) => {
  publicController.startAttempt(req, res, next);
});

export const publicRoutes = router;
