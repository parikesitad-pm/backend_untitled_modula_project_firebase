import { z } from 'zod';
import { registry, jsonResponse, ErrorResponseSchema } from '../registry';
import {
  CreateActivitySchema,
  UpdateActivitySchema,
} from '../../modules/activities/activities.schema';

const ActivityOutSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  slug: z.string(),
  mode: z.enum(['quiz', 'task']),
  status: z.enum(['draft', 'published', 'closed', 'archived']),
  phase: z.enum(['pre', 'post', 'standalone']).optional(),
  groupId: z.string().optional(),
  opensAt: z.string(),
  closesAt: z.string(),
  settings: z.record(z.unknown()),
  participantFields: z.array(z.record(z.unknown())),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

registry.registerPath({
  method: 'get',
  path: '/api/activities',
  tags: ['Activities'],
  summary: 'List activities',
  security: [{ BearerAuth: [] }],
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: z.array(ActivityOutSchema) }), 'Activity list'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/activities',
  tags: ['Activities'],
  summary: 'Create activity',
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateActivitySchema.openapi({
            example: {
              title: 'VMIX BRI Assessment',
              description: 'Pretest session for internal engineers',
              slug: 'vmix-bri-pretest',
              mode: 'quiz',
              phase: 'pre',
              groupId: 'vmix-2026',
              opensAt: '2026-10-01T08:00:00Z',
              closesAt: '2026-10-01T12:00:00Z',
            },
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse(z.object({ success: z.literal(true), data: ActivityOutSchema }), 'Activity created'),
    400: jsonResponse(ErrorResponseSchema, 'Invalid schedule or payload'),
    409: jsonResponse(ErrorResponseSchema, 'Slug already exists'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/activities/{id}',
  tags: ['Activities'],
  summary: 'Get activity details',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: ActivityOutSchema }), 'Activity detail'),
    404: jsonResponse(ErrorResponseSchema, 'Activity not found'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/activities/{id}',
  tags: ['Activities'],
  summary: 'Update activity',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': { schema: UpdateActivitySchema },
      },
    },
  },
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: ActivityOutSchema }), 'Activity updated'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/api/activities/{id}',
  tags: ['Activities'],
  summary: 'Delete activity',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: z.object({ deleted: z.literal(true) }) }), 'Deleted'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/activities/{id}/publish',
  tags: ['Activities'],
  summary: 'Publish activity',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: ActivityOutSchema }), 'Published'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/activities/{id}/close',
  tags: ['Activities'],
  summary: 'Close activity',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(z.object({ success: z.literal(true), data: ActivityOutSchema }), 'Closed'),
  },
});
