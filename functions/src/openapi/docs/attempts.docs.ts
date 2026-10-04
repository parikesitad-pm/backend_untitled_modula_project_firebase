import { z } from 'zod';
import { registry, jsonResponse, ErrorResponseSchema } from '../registry';
import { SubmitAnswerSchema } from '../../modules/attempts/attempts.schema';

registry.registerPath({
  method: 'post',
  path: '/api/attempts/{attemptId}/answers',
  tags: ['Attempts'],
  summary: 'Submit answer for a question in an active attempt',
  request: {
    params: z.object({ attemptId: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: SubmitAnswerSchema.openapi({
            example: {
              questionId: 'q-123',
              selectedChoiceIds: ['c-abc'],
              enteredAt: '2026-10-01T08:00:00Z',
              answeredAt: '2026-10-01T08:00:06Z',
              durationMs: 6000,
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
        data: z.object({ recorded: z.literal(true), questionId: z.string() }),
      }),
      'Answer recorded'
    ),
    400: jsonResponse(ErrorResponseSchema, 'Attempt not in progress or invalid question'),
    404: jsonResponse(ErrorResponseSchema, 'Attempt not found'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/attempts/{attemptId}/finish',
  tags: ['Attempts'],
  summary: 'Finish attempt and compute final score and leaderboard points',
  request: {
    params: z.object({ attemptId: z.string() }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        success: z.literal(true),
        data: z.object({
          attempt: z.record(z.unknown()),
          summary: z.object({
            totalWeight: z.number(),
            earnedWeight: z.number(),
            finalScore: z.number(),
            totalLeaderboardPoints: z.number(),
            totalDurationMs: z.number(),
            correctCount: z.number(),
            totalQuestions: z.number(),
          }),
        }),
      }),
      'Attempt completed'
    ),
    400: jsonResponse(ErrorResponseSchema, 'Attempt already finished or invalid'),
    404: jsonResponse(ErrorResponseSchema, 'Attempt not found'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/attempts/{attemptId}',
  tags: ['Attempts'],
  summary: 'Get attempt status and details',
  request: {
    params: z.object({ attemptId: z.string() }),
  },
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: z.record(z.unknown()) }), 'Attempt data'),
    404: jsonResponse(ErrorResponseSchema, 'Attempt not found'),
  },
});
