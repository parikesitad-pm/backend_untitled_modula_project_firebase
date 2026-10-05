import { v2 as cloudinary } from 'cloudinary';
import crypto from 'crypto';
import { env } from '../../../config/env';
import {
  AssetStorageProvider,
  CreateUploadIntentInput,
  DeliveryOptions,
  StoredAsset,
  UploadIntent,
} from './asset-storage-provider';

export class CloudinaryAssetStorageProvider implements AssetStorageProvider {
  constructor() {
    this.configure();
  }

  private configure(): void {
    cloudinary.config({
      cloud_name: env.CLOUDINARY_CLOUD_NAME || 'modula-cloud',
      api_key: env.CLOUDINARY_API_KEY || 'modula-key',
      api_secret: env.CLOUDINARY_API_SECRET || 'modula-secret',
      secure: true,
    });
  }

  async createSignedUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent> {
    const workspaceId = input.workspaceId || 'default';
    const rootFolder = env.CLOUDINARY_ROOT_ASSET_FOLDER || 'untitled-modula';
    const assetFolder = `${rootFolder}/workspaces/${workspaceId}/activities/${input.activityId}/questions/${input.questionId}`;

    const cloudName = env.CLOUDINARY_CLOUD_NAME || 'modula-cloud';
    const apiKey = env.CLOUDINARY_API_KEY || 'modula-key';
    const apiSecret = env.CLOUDINARY_API_SECRET || 'modula-secret';

    // Unguessable server-generated random public ID
    const publicId = crypto.randomBytes(16).toString('hex');
    const timestamp = Math.floor(Date.now() / 1000);
    const uploadPreset = env.CLOUDINARY_UPLOAD_PRESET || 'modula_question_images_signed';

    const paramsToSign: Record<string, string | number> = {
      asset_folder: assetFolder,
      public_id: publicId,
      timestamp,
      upload_preset: uploadPreset,
    };

    const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);
    const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
    const expiresAt = new Date((timestamp + 3600) * 1000).toISOString();

    return {
      provider: 'cloudinary',
      uploadUrl,
      cloudName,
      apiKey,
      timestamp,
      signature,
      uploadPreset,
      assetFolder,
      publicId,
      expiresAt,
    };
  }

  private sanitizePublicId(publicId: string): string {
    if (!publicId || typeof publicId !== 'string') {
      throw new Error('Invalid public_id: must be a non-empty string');
    }
    const trimmed = publicId.trim();
    if (!/^[a-zA-Z0-9_\-\/]+$/.test(trimmed) || trimmed.includes('..')) {
      throw new Error('Invalid public_id: contains disallowed characters');
    }
    return trimmed;
  }

  async verifyAsset(publicId: string): Promise<StoredAsset> {
    const sanitizedId = this.sanitizePublicId(publicId);
    const res = await cloudinary.api.resource(sanitizedId);
    return {
      assetId: (res.asset_id as string) || sanitizedId,
      publicId: res.public_id as string,
      version: Number(res.version),
      resourceType: (res.resource_type as string) || 'image',
      format: (res.format as string) || '',
      width: Number(res.width || 0),
      height: Number(res.height || 0),
      bytes: Number(res.bytes || 0),
      secureUrl: (res.secure_url as string) || '',
      assetFolder: (res.asset_folder as string) || '',
      provider: 'cloudinary',
    };
  }

  async deleteAsset(publicId: string): Promise<void> {
    const sanitizedId = this.sanitizePublicId(publicId);
    await cloudinary.uploader.destroy(sanitizedId, { invalidate: true });
  }

  buildDeliveryUrl(asset: StoredAsset, options?: DeliveryOptions): string {
    const cloudName = env.CLOUDINARY_CLOUD_NAME || 'modula-cloud';
    return cloudinary.url(asset.publicId, {
      cloud_name: cloudName,
      secure: true,
      fetch_format: options?.format || 'auto',
      quality: options?.quality || 'auto',
      version: asset.version ? String(asset.version) : undefined,
      width: options?.width,
      height: options?.height,
      crop: options?.crop,
      raw_transformation: options?.transformation,
      urlAnalytics: false,
    });
  }
}
