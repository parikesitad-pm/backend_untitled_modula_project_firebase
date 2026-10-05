export const env = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT || '5001', 10),
  FIREBASE_PROJECT_ID: process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID || 'modula-backend-dev',
  STORAGE_BUCKET: process.env.STORAGE_BUCKET || 'modula-backend-dev.appspot.com',
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME || '',
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY || '',
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET || '',
  CLOUDINARY_UPLOAD_PRESET: process.env.CLOUDINARY_UPLOAD_PRESET || 'modula_question_images_signed',
  CLOUDINARY_ROOT_ASSET_FOLDER: process.env.CLOUDINARY_ROOT_ASSET_FOLDER || 'untitled-modula',
  DEFAULT_SPEED_BONUS_CAP_PERCENT: 20,
  DEFAULT_TIME_REFERENCE_SECONDS: 30,
  MAX_QUESTION_BODY_LENGTH: 255,
} as const;

