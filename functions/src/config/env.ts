export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '5001', 10),
  FIREBASE_PROJECT_ID: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'modula-backend-dev',
  STORAGE_BUCKET: process.env.STORAGE_BUCKET || 'modula-backend-dev.appspot.com',
  DEFAULT_SPEED_BONUS_CAP_PERCENT: 20,
  DEFAULT_TIME_REFERENCE_SECONDS: 30,
  MAX_QUESTION_BODY_LENGTH: 255,
} as const;
