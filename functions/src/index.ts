import { onRequest } from 'firebase-functions/v2/https';
import { app } from './app';

export const api = onRequest(
  {
    cors: true,
    region: 'us-central1',
    maxInstances: 10,
  },
  app
);
