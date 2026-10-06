import path from 'path';
import fs from 'fs';
import express, { Express } from 'express';
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
import { workspacesRoutes } from './modules/workspaces/workspaces.routes';
import { liveSessionsRoutes, publicLiveSessionsRoutes } from './modules/live-sessions/live-sessions.routes';
import { assessmentsRoutes } from './modules/assessments/assessments.routes';
import { publicAssessmentsRoutes } from './modules/assessments/public-assessments.routes';
import { corsMiddleware } from './middleware/cors.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';

const SWAGGER_CDN_BASE = 'https://cdnjs.cloudflare.com/ajax/libs/swagger-ui/5.18.2';
const swaggerCdnMap: Record<string, string> = {
  'swagger-ui.css': `${SWAGGER_CDN_BASE}/swagger-ui.min.css`,
  'swagger-ui.css.map': `${SWAGGER_CDN_BASE}/swagger-ui.css.map`,
  'swagger-ui-bundle.js': `${SWAGGER_CDN_BASE}/swagger-ui-bundle.min.js`,
  'swagger-ui-bundle.js.map': `${SWAGGER_CDN_BASE}/swagger-ui-bundle.js.map`,
  'swagger-ui-standalone-preset.js': `${SWAGGER_CDN_BASE}/swagger-ui-standalone-preset.min.js`,
  'swagger-ui-standalone-preset.js.map': `${SWAGGER_CDN_BASE}/swagger-ui-standalone-preset.js.map`,
  'favicon-32x32.png': `${SWAGGER_CDN_BASE}/favicon-32x32.png`,
  'favicon-16x16.png': `${SWAGGER_CDN_BASE}/favicon-16x16.png`,
};

function handleSwaggerStaticAsset(req: express.Request, res: express.Response, next: express.NextFunction) {
  const filename = req.path.split('/').pop() || '';
  if (swaggerCdnMap[filename]) {
    try {
      // In local dev/testing where node_modules/swagger-ui-dist is on disk, serve local file
      const getDistPath = require('swagger-ui-dist/absolute-path');
      const distDir = typeof getDistPath === 'function' ? getDistPath() : '';
      if (distDir) {
        const localFile = path.join(distDir, filename);
        if (fs.existsSync(localFile)) {
          return res.sendFile(localFile);
        }
      }
    } catch {
      // ignore
    }
    // In serverless environments (Vercel) without unpacked static assets, redirect directly to CDN
    return res.redirect(302, swaggerCdnMap[filename]);
  }
  next();
}

export function createApp(): Express {
  const app = express();
  const openApiDoc = getOpenApiDocument();

  app.use(corsMiddleware());
  app.use(express.json());

  // Health check
  const healthHandler = (_req: express.Request, res: express.Response) => {
    res.status(200).json({
      status: 'ok',
      service: 'modula-backend',
      version: '0.4.0',
    });
  };
  app.get('/api/health', healthHandler);
  app.get('/health', healthHandler);

  // API Documentation routes
  app.get('/api/openapi.json', (_req, res) => res.json(openApiDoc));
  app.get('/openapi.json', (_req, res) => res.json(openApiDoc));

  // Swagger UI trailing-slash redirect (fixes blank UI under Vercel catch-all rewrites)
  app.get(['/api/docs', '/docs'], (req, res, next) => {
    const urlPath = req.originalUrl.split('?')[0];
    if (!urlPath.endsWith('/')) {
      const query = req.originalUrl.includes('?') ? req.originalUrl.substring(urlPath.length) : '';
      const target = (urlPath === '/docs' ? '/api/docs/' : urlPath + '/') + query;
      return res.redirect(301, target);
    }
    next();
  });

  // Intercept Swagger UI static asset requests (serve local file or CDN fallback)
  app.use(['/api/docs', '/docs'], handleSwaggerStaticAsset);

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
  apiRouter.use('/workspaces', workspacesRoutes);
  apiRouter.use('/live-sessions', liveSessionsRoutes);
  apiRouter.use('/public/live-sessions', publicLiveSessionsRoutes);
  apiRouter.use('/assessments', assessmentsRoutes);
  apiRouter.use('/public/assessments', publicAssessmentsRoutes);
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
