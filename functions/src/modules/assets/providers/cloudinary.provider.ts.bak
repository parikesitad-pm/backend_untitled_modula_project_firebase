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
      cloud_name: env.CLOUDINARY_CLOUD_NAME,
      api_key: env.CLOUDINARY_API_KEY,
      api_secret: env.CLOUDINARY_API_SECRET,
      secure: true,
    });
  }

  async createSignedUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent> {
    const workspaceId = input.workspaceId || 'default';
    const rootFolder = env.CLOUDINARY_ROOT_ASSET_FOLDER || 'untitled-modula';
    const assetFolder = `${rootFolder}/workspaces/${workspaceId}/activities/${input.activityId}/questions/${input.questionId}`;

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

    const signature = cloudinary.utils.api_sign_request(paramsToSign, env.CLOUDINARY_API_SECRET);
    const uploadUrl = `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`;
    const expiresAt = new Date((timestamp + 3600) * 1000).toISOString();

    return {
      provider: 'cloudinary',
      uploadUrl,
      cloudName: env.CLOUDINARY_CLOUD_NAME,
      apiKey: env.CLOUDINARY_API_KEY,
      timestamp,
      signature,
      uploadPreset,
      assetFolder,
      publicId,
      expiresAt,
    };
  }

  async verifyAsset(publicId: string): Promise<StoredAsset> {
    const res = await cloudinary.api.resource(publicId);
    return {
      assetId: (res.asset_id as string) || publicId,
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
    await cloudinary.uploader.destroy(publicId, { invalidate: true });
  }

  buildDeliveryUrl(asset: StoredAsset, options?: DeliveryOptions): string {
    return cloudinary.url(asset.publicId, {
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
