import { Router } from 'express';
import { authController } from './auth.controller';
import { validateBody } from '../../middleware/validate.middleware';
import { LoginRequestSchema } from './auth.schema';
import { requireAuth } from '../../middleware/auth.middleware';

const router = Router();

router.post('/login', validateBody(LoginRequestSchema), (req, res, next) => {
  authController.login(req, res, next);
});

router.post('/bootstrap', (req, res, next) => {
  authController.bootstrap(req, res, next);
});

router.get('/me', requireAuth(), (req, res, next) => {
  authController.getMe(req, res, next);
});

export const authRoutes = router;
