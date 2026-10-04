import { z } from 'zod';
import { registry, jsonResponse, ErrorResponseSchema } from '../registry';
import {
  CreateOperatorSchema,
  UpdateOperatorSchema,
  OperatorItemSchema,
} from '../../modules/auth/operators.schema';

registry.registerPath({
  method: 'get',
  path: '/api/operators',
  tags: ['Auth'],
  summary: 'List operators',
  description: 'Returns all operator accounts. Requires owner or crown role.',
  security: [{ BearerAuth: [] }],
  responses: {
    200: jsonResponse(
      z.object({ success: z.literal(true), data: z.array(OperatorItemSchema) }),
      'List of operators'
    ),
    401: jsonResponse(ErrorResponseSchema, 'Unauthorized'),
    403: jsonResponse(ErrorResponseSchema, 'Forbidden'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/operators',
  tags: ['Auth'],
  summary: 'Create operator',
  description: 'Creates a new operator. Requires owner or crown role.',
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateOperatorSchema.openapi({
            example: {
              username: 'exam_manager',
              accessCode: 'VeryStrongPass123!',
              role: 'manager',
            },
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse(
      z.object({ success: z.literal(true), data: OperatorItemSchema, message: z.string().optional() }),
      'Operator created'
    ),
    400: jsonResponse(ErrorResponseSchema, 'Invalid input or role violation'),
    401: jsonResponse(ErrorResponseSchema, 'Unauthorized'),
    403: jsonResponse(ErrorResponseSchema, 'Forbidden'),
    409: jsonResponse(ErrorResponseSchema, 'Username already exists'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/api/operators/{id}',
  tags: ['Auth'],
  summary: 'Update operator',
  description: 'Updates an operator. Cannot assign role >= caller role.',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: UpdateOperatorSchema.openapi({
            example: {
              role: 'manager',
              active: true,
            },
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      z.object({ success: z.literal(true), data: OperatorItemSchema }),
      'Operator updated'
    ),
    400: jsonResponse(ErrorResponseSchema, 'Invalid input or role violation'),
    401: jsonResponse(ErrorResponseSchema, 'Unauthorized'),
    403: jsonResponse(ErrorResponseSchema, 'Forbidden'),
    404: jsonResponse(ErrorResponseSchema, 'Operator not found'),
    409: jsonResponse(ErrorResponseSchema, 'Last owner demotion blocked'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/operators/{id}/deactivate',
  tags: ['Auth'],
  summary: 'Deactivate operator',
  description: 'Deactivates an operator account and revokes tokens.',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(
      z.object({ success: z.literal(true), data: OperatorItemSchema }),
      'Operator deactivated'
    ),
    401: jsonResponse(ErrorResponseSchema, 'Unauthorized'),
    403: jsonResponse(ErrorResponseSchema, 'Forbidden'),
    404: jsonResponse(ErrorResponseSchema, 'Operator not found'),
    409: jsonResponse(ErrorResponseSchema, 'Cannot deactivate last owner'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/operators/{id}/reactivate',
  tags: ['Auth'],
  summary: 'Reactivate operator',
  description: 'Reactivates a previously deactivated operator account.',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(
      z.object({ success: z.literal(true), data: OperatorItemSchema }),
      'Operator reactivated'
    ),
    401: jsonResponse(ErrorResponseSchema, 'Unauthorized'),
    403: jsonResponse(ErrorResponseSchema, 'Forbidden'),
    404: jsonResponse(ErrorResponseSchema, 'Operator not found'),
  },
});
