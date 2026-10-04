import { z } from 'zod';
import { registry, jsonResponse, ErrorResponseSchema } from '../registry';
import { ParticipantInputSchema } from '../../modules/participants/participants.schema';

registry.registerPath({
  method: 'get',
  path: '/api/public/{slug}',
  tags: ['Participants'],
  summary: 'Public activity inspection (safe questions, no leaked answers)',
  request: {
    params: z.object({ slug: z.string() }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        success: z.literal(true),
        data: z.object({
          activity: z.record(z.unknown()),
          questions: z.array(
            z.object({
              id: z.string(),
              body: z.string(),
              weight: z.number(),
              choices: z.array(z.object({ id: z.string(), body: z.string(), position: z.number() })),
            })
          ),
        }),
      }),
      'Safe public activity data'
    ),
    400: jsonResponse(ErrorResponseSchema, 'Activity not open or closed'),
    404: jsonResponse(ErrorResponseSchema, 'Activity not found'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/public/{slug}/start',
  tags: ['Participants'],
  summary: 'Start an attempt as a participant',
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
          participant: z.record(z.unknown()),
        }),
      }),
      'Attempt initialized'
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
  },
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: z.array(z.record(z.unknown())) }), 'Participants list'),
  },
});
