import { z } from 'zod';
import { registry, jsonResponse, ErrorResponseSchema } from '../registry';
import {
  ActivityStatsSummarySchema,
  QuestionStatSchema,
  PrePostComparisonSchema,
} from '../../modules/stats/stats.schema';

registry.registerPath({
  method: 'get',
  path: '/api/activities/{id}/stats',
  tags: ['Stats'],
  summary: 'Activity aggregate statistics (scores, timing, completion rates)',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: ActivityStatsSummarySchema }), 'Aggregate stats'),
    404: jsonResponse(ErrorResponseSchema, 'Activity not found'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/activities/{id}/responses',
  tags: ['Stats'],
  summary: 'Activity response/answers database for export',
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
      'Raw responses'
    ),
    404: jsonResponse(ErrorResponseSchema, 'Activity not found'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/activities/{id}/question-stats',
  tags: ['Stats'],
  summary: 'Per-question analytics (correct percentage, average time)',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: z.array(QuestionStatSchema) }), 'Question stats'),
    404: jsonResponse(ErrorResponseSchema, 'Activity not found'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/groups/{groupId}/comparison',
  tags: ['Stats'],
  summary: 'Pre/Post test comparison across linked activities in a group',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ groupId: z.string() }),
  },
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: PrePostComparisonSchema }), 'Pre/Post delta comparison'),
    404: jsonResponse(ErrorResponseSchema, 'Group not found'),
  },
});
