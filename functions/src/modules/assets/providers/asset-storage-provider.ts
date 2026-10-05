export interface CreateUploadIntentInput {
  activityId: string;
  questionId: string;
  fileName: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  sizeBytes: number;
  width: number;
  height: number;
  workspaceId?: string;
}

export interface UploadIntent {
  provider: 'cloudinary';
  uploadUrl: string;
  cloudName: string;
  apiKey: string;
  timestamp: number;
  signature: string;
  uploadPreset: string;
  assetFolder: string;
  publicId: string;
  expiresAt: string;
}

export interface StoredAsset {
  assetId: string;
  publicId: string;
  version: number;
  resourceType: string;
  format: string;
  width: number;
  height: number;
  bytes: number;
  secureUrl: string;
  assetFolder: string;
  provider: 'cloudinary';
}

export interface DeliveryOptions {
  transformation?: string;
  width?: number;
  height?: number;
  crop?: string;
  quality?: string | number;
  format?: string;
}

export interface AssetStorageProvider {
  createSignedUploadIntent(input: CreateUploadIntentInput): Promise<UploadIntent>;
  verifyAsset(publicIdOrAssetId: string): Promise<StoredAsset>;
  deleteAsset(assetIdOrPublicId: string): Promise<void>;
  buildDeliveryUrl(asset: StoredAsset, options?: DeliveryOptions): string;
}
