import { z } from 'zod';

export const AllowedImageMimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const AllowedImageFormats = ['jpg', 'jpeg', 'png', 'webp'] as const;
export const MAX_ASSET_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const UploadIntentInputSchema = z.object({
  activityId: z.string().min(1, 'activityId is required'),
  questionId: z.string().min(1, 'questionId is required'),
  fileName: z.string().min(1, 'fileName is required'),
  mimeType: z.enum(AllowedImageMimeTypes, {
    errorMap: () => ({ message: 'Only image/jpeg, image/png, and image/webp are supported' }),
  }),
  sizeBytes: z
    .number()
    .int('sizeBytes must be an integer')
    .positive('sizeBytes must be greater than 0')
    .max(MAX_ASSET_SIZE_BYTES, 'Max source size is 5 MB (5242880 bytes)'),
  width: z.number().int('width must be an integer').positive('width must be positive'),
  height: z.number().int('height must be an integer').positive('height must be positive'),
});

export type UploadIntentInput = z.infer<typeof UploadIntentInputSchema>;

export const UploadIntentResponseSchema = z.object({
  provider: z.literal('cloudinary'),
  uploadUrl: z.string().url(),
  cloudName: z.string(),
  apiKey: z.string(),
  timestamp: z.number().int(),
  signature: z.string(),
  uploadPreset: z.string(),
  assetFolder: z.string(),
  publicId: z.string(),
  expiresAt: z.string().datetime(),
});

export type UploadIntentResponse = z.infer<typeof UploadIntentResponseSchema>;

export const ConfirmAssetInputSchema = z.object({
  activityId: z.string().min(1, 'activityId is required'),
  questionId: z.string().min(1, 'questionId is required'),
  publicId: z.string().min(1, 'publicId is required'),
});

export type ConfirmAssetInput = z.infer<typeof ConfirmAssetInputSchema>;

export const StoredAssetSchema = z.object({
  assetId: z.string(),
  publicId: z.string(),
  version: z.number(),
  resourceType: z.string(),
  format: z.string(),
  width: z.number(),
  height: z.number(),
  bytes: z.number(),
  secureUrl: z.string().url(),
  assetFolder: z.string(),
  provider: z.literal('cloudinary'),
});

export type StoredAsset = z.infer<typeof StoredAssetSchema>;

export const ConfirmAssetResponseSchema = z.object({
  success: z.literal(true),
  asset: StoredAssetSchema,
  deliveryUrl: z.string().url(),
});

export type ConfirmAssetResponse = z.infer<typeof ConfirmAssetResponseSchema>;
