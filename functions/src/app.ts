import express, { Express } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { getOpenApiDocument } from './openapi/openapi';
import { authRoutes } from './modules/auth/auth.routes';
import { activitiesRoutes } from './modules/activities/activities.routes';
import { questionsRoutes } from './modules/questions/questions.routes';
import { publicRoutes } from './modules/participants/public.routes';
import { attemptsRoutes } from './modules/attempts/attempts.routes';
import { leaderboardRoutes } from './modules/leaderboard/leaderboard.routes';
import { statsRoutes } from './modules/stats/stats.routes';
import { assetsRoutes } from './modules/assets/assets.routes';
import { storageRoutes } from './modules/storage/storage.routes';
import { operatorsRoutes } from './modules/auth/operators.routes';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';

export function createApp(): Express {
  const app = express();
  const openApiDoc = getOpenApiDocument();

  app.use(cors({ origin: true }));
  app.use(express.json());

  // API Documentation routes
  app.get('/api/openapi.json', (_req, res) => res.json(openApiDoc));
  app.get('/openapi.json', (_req, res) => res.json(openApiDoc));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiDoc));

  // Feature routers
  const apiRouter = express.Router();
  apiRouter.use('/auth', authRoutes);
  apiRouter.use('/activities', activitiesRoutes);
  apiRouter.use('/questions', questionsRoutes);
  apiRouter.use('/public', publicRoutes);
  apiRouter.use('/attempts', attemptsRoutes);
  apiRouter.use('/leaderboards', leaderboardRoutes);
  apiRouter.use('/assets', assetsRoutes);
  apiRouter.use('/storage', storageRoutes);
  apiRouter.use('/operators', operatorsRoutes);
  apiRouter.use('/', statsRoutes);

  // Mount router under both /api and root for Cloud Function compatibility
  app.use('/api', apiRouter);
  app.use('/', apiRouter);

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

export const app = createApp();
