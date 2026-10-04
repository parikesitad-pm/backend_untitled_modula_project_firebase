import { z } from 'zod';

export const AllowedImageMimeTypes = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export const RequestUploadUrlSchema = z.object({
  activityId: z.string().min(1),
  fileName: z.string().min(1).max(255),
  mimeType: z.enum(AllowedImageMimeTypes),
  sizeBytes: z.number().int().positive().max(MAX_IMAGE_SIZE_BYTES, 'Max image size is 5MB'),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
});

export type RequestUploadUrlInput = z.infer<typeof RequestUploadUrlSchema>;

export const UploadUrlResponseSchema = z.object({
  storagePath: z.string(),
  uploadUrl: z.string(),
  publicUrl: z.string(),
  expiresAt: z.string(),
});

export type UploadUrlResponse = z.infer<typeof UploadUrlResponseSchema>;
