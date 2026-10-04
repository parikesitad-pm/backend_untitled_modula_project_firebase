import { storage } from '../../config/firebase';
import { env } from '../../config/env';
import { RequestUploadUrlInput, UploadUrlResponse } from './storage.schema';

export class StorageService {
  async getUploadUrl(input: RequestUploadUrlInput): Promise<UploadUrlResponse> {
    const cleanFileName = input.fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `activities/${input.activityId}/questions/${Date.now()}_${cleanFileName}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins

    const bucketName = env.STORAGE_BUCKET;
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(storagePath);

    let uploadUrl = '';
    try {
      const [signedUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'write',
        expires: Date.now() + 15 * 60 * 1000,
        contentType: input.mimeType,
      });
      uploadUrl = signedUrl;
    } catch (_e) {
      // In local emulator or dev without service account private key, provide direct emulator endpoint
      uploadUrl = `http://127.0.0.1:9199/v0/b/${bucketName}/o?name=${encodeURIComponent(storagePath)}`;
    }

    const publicUrl = `https://storage.googleapis.com/${bucketName}/${storagePath}`;

    return {
      storagePath,
      uploadUrl,
      publicUrl,
      expiresAt,
    };
  }
}

export const storageService = new StorageService();
