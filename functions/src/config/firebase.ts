import * as admin from 'firebase-admin';

export function formatPrivateKey(key: string | undefined): string {
  if (!key) return '';
  return key.replace(/\\n/g, '\n');
}

export function validateFirebaseProductionEnv(): {
  projectId: string;
  clientEmail: string;
  privateKey: string;
} {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'untitled-modula-backend';
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || '';
  const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';

  const missing: string[] = [];
  if (!projectId) missing.push('FIREBASE_PROJECT_ID');
  if (!clientEmail) missing.push('FIREBASE_CLIENT_EMAIL');
  if (!rawKey) missing.push('FIREBASE_PRIVATE_KEY');

  if (missing.length > 0) {
    throw new Error(
      `Missing required Firebase production environment variables: ${missing.join(', ')}. ` +
      `Ensure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY are configured.`
    );
  }

  return {
    projectId,
    clientEmail,
    privateKey: formatPrivateKey(rawKey),
  };
}

export function initializeFirebaseAdmin(): admin.app.App {
  if (admin.apps.length > 0) {
    return admin.apps[0]!;
  }

  const isEmulator = Boolean(
    process.env.FIRESTORE_EMULATOR_HOST ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST ||
    process.env.FIREBASE_EMULATOR_HUB
  );

  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.VERCEL === '1';

  // 1. If explicit credentials are provided, always use cert
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    const creds = validateFirebaseProductionEnv();
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId: creds.projectId,
        clientEmail: creds.clientEmail,
        privateKey: creds.privateKey,
      }),
      projectId: creds.projectId,
    });
  }

  // 2. If in production (and not running against emulator), fail fast if credentials missing
  if (isProduction && !isEmulator && process.env.NODE_ENV !== 'test') {
    const creds = validateFirebaseProductionEnv();
    return admin.initializeApp({
      credential: admin.credential.cert({
        projectId: creds.projectId,
        clientEmail: creds.clientEmail,
        privateKey: creds.privateKey,
      }),
      projectId: creds.projectId,
    });
  }

  // 3. Local / emulator / test default initialization
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'modula-backend-dev';
  return admin.initializeApp({ projectId });
}

initializeFirebaseAdmin();

export const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });
export const auth = admin.auth();

/**
 * @deprecated Firebase Storage runtime is deprecated in favor of Cloudinary AssetStorageProvider.
 */
export const storage = {
  bucket: () => {
    throw new Error('Firebase Storage is deprecated. Use Cloudinary AssetStorageProvider.');
  },
};

export { admin };
