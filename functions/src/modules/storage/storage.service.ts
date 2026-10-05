import { RequestUploadUrlInput, UploadUrlResponse } from './storage.schema';
import { generateSecureToken } from '../../lib/hash';

/**
 * @deprecated Legacy Firebase Storage service. Replaced by AssetsService and CloudinaryAssetStorageProvider.
 */
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

    return {
      storagePath,
      uploadUrl: `https://deprecated.storage.local/upload/${encodeURIComponent(storagePath)}`,
      publicUrl: `https://deprecated.storage.local/${encodeURIComponent(storagePath)}`,
      expiresAt,
    };
  }

  async getSignedReadUrl(storagePath: string): Promise<string> {
    return `https://deprecated.storage.local/${encodeURIComponent(storagePath)}`;
  }
}

export const storageService = new StorageService();
