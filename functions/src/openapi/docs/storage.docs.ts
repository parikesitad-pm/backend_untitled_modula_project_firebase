import { z } from 'zod';
import { registry, jsonResponse, ErrorResponseSchema } from '../registry';
import { RequestUploadUrlSchema, UploadUrlResponseSchema } from '../../modules/storage/storage.schema';

registry.registerPath({
  method: 'post',
  path: '/api/storage/upload-url',
  tags: ['Storage'],
  summary: 'Request signed URL for question image upload',
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: RequestUploadUrlSchema.openapi({
            example: {
              activityId: 'act-123',
              fileName: 'diagram.webp',
              mimeType: 'image/webp',
              sizeBytes: 154200,
              width: 1200,
              height: 800,
            },
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      z.object({ success: z.literal(true), data: UploadUrlResponseSchema }),
      'Upload URL and storage target'
    ),
    400: jsonResponse(ErrorResponseSchema, 'Invalid mime type or size limit exceeded'),
  },
});
