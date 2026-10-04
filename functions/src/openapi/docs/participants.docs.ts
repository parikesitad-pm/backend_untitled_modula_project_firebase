import { z } from 'zod';
import { registry, jsonResponse, ErrorResponseSchema } from '../registry';
import { ParticipantInputSchema } from '../../modules/participants/participants.schema';

registry.registerPath({
  method: 'get',
  path: '/api/public/{slug}',
  tags: ['Participants'],
  summary: 'Public activity inspection (safe metadata only, zero question leakage)',
  request: {
    params: z.object({ slug: z.string() }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        success: z.literal(true),
        data: z.object({
          activity: z.record(z.unknown()),
          questionCount: z.number().int().min(0),
        }),
      }),
      'Safe public activity metadata'
    ),
    400: jsonResponse(ErrorResponseSchema, 'Activity not open or closed'),
    404: jsonResponse(ErrorResponseSchema, 'Activity not found'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/public/{slug}/start',
  tags: ['Participants'],
  summary: 'Start an attempt as a participant and reveal first question',
  request: {
    params: z.object({ slug: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: ParticipantInputSchema.openapi({
            example: {
              name: 'John Doe',
              participantCode: 'EMP-001',
              email: 'john@example.com',
              division: 'Engineering',
            },
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse(
      z.object({
        success: z.literal(true),
        data: z.object({
          attempt: z.record(z.unknown()),
          attemptToken: z.string().openapi({ description: 'One-time attempt token required in X-Attempt-Token header' }),
          participant: z.record(z.unknown()),
          firstQuestion: z.record(z.unknown()).openapi({ description: 'First sanitized question revealed to participant' }),
        }),
      }),
      'Attempt initialized and first question revealed'
    ),
    400: jsonResponse(ErrorResponseSchema, 'Schedule or attempt rule blocked'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/activities/{id}/participants',
  tags: ['Participants'],
  summary: 'List durable participants and their attempts for an activity',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      limit: z.string().optional().openapi({ example: '50', description: 'Page size (1-200, default 50)' }),
      cursor: z.string().optional().openapi({ description: 'Next cursor ID from previous page meta' }),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        success: z.literal(true),
        data: z.array(z.record(z.unknown())),
        meta: z.object({
          limit: z.number(),
          nextCursor: z.string().nullable(),
        }).optional(),
      }),
      'Participants list'
    ),
  },
});
