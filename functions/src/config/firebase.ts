import * as admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp();
}

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
