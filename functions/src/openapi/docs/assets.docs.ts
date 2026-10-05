import { z } from 'zod';
import { registry, jsonResponse, ErrorResponseSchema } from '../registry';
import {
  UploadIntentInputSchema,
  UploadIntentResponseSchema,
  ConfirmAssetInputSchema,
  ConfirmAssetResponseSchema,
} from '../../modules/assets/assets.schema';

registry.registerPath({
  method: 'post',
  path: '/api/assets/upload-intent',
  tags: ['Assets'],
  summary: 'Create signed upload intent for Cloudinary media asset',
  description:
    'Returns server-signed upload parameters and an unguessable publicId for direct browser-to-Cloudinary upload. Bytes do not traverse the API server.',
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: UploadIntentInputSchema.openapi({
            example: {
              activityId: 'act-123',
              questionId: 'q-456',
              fileName: 'diagram.png',
              mimeType: 'image/png',
              sizeBytes: 321000,
              width: 1600,
              height: 900,
            },
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      z.object({
        success: z.literal(true),
        data: UploadIntentResponseSchema.openapi({
          example: {
            provider: 'cloudinary',
            uploadUrl: 'https://api.cloudinary.com/v1_1/demo-cloud/image/upload',
            cloudName: 'demo-cloud',
            apiKey: '123456789012345',
            timestamp: 1700000000,
            signature: '8f4c6e9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e',
            uploadPreset: 'modula_question_images_signed',
            assetFolder: 'untitled-modula/workspaces/default/activities/act-123/questions/q-456',
            publicId: '7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
            expiresAt: '2026-10-06T05:00:00.000Z',
          },
        }),
        message: z.string().optional(),
      }),
      'Signed upload intent generated successfully'
    ),
    401: jsonResponse(ErrorResponseSchema, 'Missing or invalid authentication token'),
    403: jsonResponse(ErrorResponseSchema, 'Not authorized to modify this activity or question'),
    404: jsonResponse(ErrorResponseSchema, 'Referenced activity or question not found'),
    422: jsonResponse(ErrorResponseSchema, 'Unsupported MIME type, declared size > 5 MB, or non-positive dimensions'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/assets/confirm',
  tags: ['Assets'],
  summary: 'Confirm and verify uploaded Cloudinary asset',
  description:
    'Verifies asset existence and metadata directly with Cloudinary server-side, validates size/format/context, and persists trusted asset metadata on the question document. Idempotent.',
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: ConfirmAssetInputSchema.openapi({
            example: {
              activityId: 'act-123',
              questionId: 'q-456',
              publicId: '7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
            },
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      z.object({
        success: z.literal(true),
        data: ConfirmAssetResponseSchema.openapi({
          example: {
            success: true,
            asset: {
              assetId: 'cld-asset-id-99',
              publicId: '7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
              version: 1700000050,
              resourceType: 'image',
              format: 'png',
              width: 1600,
              height: 900,
              bytes: 321000,
              secureUrl:
                'https://res.cloudinary.com/demo-cloud/image/upload/v1700000050/untitled-modula/workspaces/default/activities/act-123/questions/q-456/7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b.png',
              assetFolder: 'untitled-modula/workspaces/default/activities/act-123/questions/q-456',
              provider: 'cloudinary',
            },
            deliveryUrl:
              'https://res.cloudinary.com/demo-cloud/image/upload/f_auto,q_auto/v1700000050/7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b',
          },
        }),
        message: z.string().optional(),
      }),
      'Asset confirmed and attached successfully'
    ),
    401: jsonResponse(ErrorResponseSchema, 'Missing or invalid authentication token'),
    403: jsonResponse(ErrorResponseSchema, 'Not authorized to modify this activity or question'),
    404: jsonResponse(ErrorResponseSchema, 'Referenced activity or question not found'),
    422: jsonResponse(
      ErrorResponseSchema,
      'Asset not found on Cloudinary, invalid format, size exceeds 5MB, or folder mismatch'
    ),
  },
});

