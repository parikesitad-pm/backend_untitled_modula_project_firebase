import { storage } from '../../config/firebase';
import { env } from '../../config/env';
import { RequestUploadUrlInput, UploadUrlResponse } from './storage.schema';
import { generateSecureToken } from '../../lib/hash';

export class StorageService {
  private getExtension(fileName: string, mimeType: string): string {
    const ext = fileName.split('.').pop()?.toLowerCase();
    if (ext && ['jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
      return ext === 'jpeg' ? 'jpg' : ext;
    }
    if (mimeType === 'image/webp') return 'webp';
    if (mimeType === 'image/png') return 'png';
    return 'jpg';
  }

  async getUploadUrl(input: RequestUploadUrlInput): Promise<UploadUrlResponse> {
    const ext = this.getExtension(input.fileName, input.mimeType);
    const randomId = generateSecureToken(16);
    const qId = input.questionId || 'general';
    const storagePath = `activities/${input.activityId}/questions/${qId}/${randomId}.${ext}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

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
      uploadUrl = `http://127.0.0.1:9199/v0/b/${bucketName}/o?name=${encodeURIComponent(storagePath)}`;
    }

    const publicUrl = `https://storage.googleapis.com/${bucketName}/${storagePath}`;
    return { storagePath, uploadUrl, publicUrl, expiresAt };
  }

  async getSignedReadUrl(storagePath: string): Promise<string> {
    const bucketName = env.STORAGE_BUCKET;
    const bucket = storage.bucket(bucketName);
    const file = bucket.file(storagePath);

    try {
      const [signedUrl] = await file.getSignedUrl({
        version: 'v4',
        action: 'read',
        expires: Date.now() + 30 * 60 * 1000, // 30 mins
      });
      return signedUrl;
    } catch (_e) {
      return `http://127.0.0.1:9199/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media`;
    }
  }
}

export const storageService = new StorageService();
