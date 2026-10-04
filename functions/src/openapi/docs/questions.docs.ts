import { z } from 'zod';
import { registry, jsonResponse, ErrorResponseSchema } from '../registry';
import {
  CreateQuestionSchema,
  UpdateQuestionSchema,
  ReorderQuestionsSchema,
} from '../../modules/questions/questions.schema';

const QuestionWithChoicesSchema = z.object({
  id: z.string(),
  activityId: z.string(),
  body: z.string(),
  richText: z.unknown().optional(),
  type: z.string(),
  position: z.number(),
  weight: z.number(),
  speedBonusEnabled: z.boolean(),
  speedBonusPercent: z.number(),
  timeReferenceSeconds: z.number(),
  imagePath: z.string().nullable().optional(),
  comparisonKey: z.string().nullable().optional(),
  choices: z.array(
    z.object({
      id: z.string(),
      questionId: z.string(),
      body: z.string(),
      position: z.number(),
      isCorrect: z.boolean().optional(),
    })
  ),
});

registry.registerPath({
  method: 'get',
  path: '/api/activities/{id}/questions',
  tags: ['Questions'],
  summary: 'List questions for activity (organizer view with answers)',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: z.array(QuestionWithChoicesSchema) }), 'Question list'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/activities/{id}/questions',
  tags: ['Questions'],
  summary: 'Add question to activity',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': { schema: CreateQuestionSchema },
      },
    },
  },
  responses: {
    201: jsonResponse(z.object({ success: z.literal(true), data: QuestionWithChoicesSchema }), 'Question created'),
    400: jsonResponse(ErrorResponseSchema, 'Validation error, e.g. body > 255 chars'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/questions/{id}',
  tags: ['Questions'],
  summary: 'Update question and choices',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': { schema: UpdateQuestionSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: QuestionWithChoicesSchema }), 'Question updated'),
    400: jsonResponse(ErrorResponseSchema, 'Validation error'),
    401: jsonResponse(ErrorResponseSchema, 'Unauthorized'),
    403: jsonResponse(ErrorResponseSchema, 'Forbidden'),
    404: jsonResponse(ErrorResponseSchema, 'Question not found'),
    409: jsonResponse(ErrorResponseSchema, 'Scoring fields locked because attempts exist (QUESTION_LOCKED)'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/questions/{id}',
  tags: ['Questions'],
  summary: 'Delete question',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: z.object({ deleted: z.literal(true) }) }), 'Deleted'),
    401: jsonResponse(ErrorResponseSchema, 'Unauthorized'),
    403: jsonResponse(ErrorResponseSchema, 'Forbidden'),
    404: jsonResponse(ErrorResponseSchema, 'Question not found'),
    409: jsonResponse(ErrorResponseSchema, 'Question cannot be deleted because attempts exist (QUESTION_LOCKED)'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/questions/reorder',
  tags: ['Questions'],
  summary: 'Reorder questions positions',
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': { schema: ReorderQuestionsSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: z.object({ reordered: z.literal(true) }) }), 'Reordered'),
  },
});
