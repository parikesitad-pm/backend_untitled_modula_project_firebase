import { z } from 'zod';
import { registry, jsonResponse, ErrorResponseSchema } from '../registry';
import { LoginRequestSchema, LoginResponseSchema, OperatorResponseSchema } from '../../modules/auth/auth.schema';

registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  tags: ['Auth'],
  summary: 'Operator login with username and access code',
  description: 'Authenticates an operator and mints a Firebase custom token.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: LoginRequestSchema.openapi({
            example: {
              username: 'owner',
              accessCode: 'supersecret123',
            },
          }),
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      z.object({ success: z.literal(true), data: LoginResponseSchema, message: z.string().optional() }),
      'Successful login'
    ),
    401: jsonResponse(ErrorResponseSchema, 'Invalid credentials'),
    429: jsonResponse(ErrorResponseSchema, 'Too many login attempts. Account temporarily locked (RATE_LIMITED)'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  tags: ['Auth'],
  summary: 'Get current operator profile',
  security: [{ BearerAuth: [] }],
  responses: {
    200: jsonResponse(
      z.object({ success: z.literal(true), data: OperatorResponseSchema }),
      'Current operator record'
    ),
    401: jsonResponse(ErrorResponseSchema, 'Unauthorized'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/bootstrap',
  tags: ['Auth'],
  summary: 'Bootstrap default system operators (OWL superadmin and Editor)',
  responses: {
    200: jsonResponse(
      z.object({
        success: z.literal(true),
        message: z.string(),
        data: z.object({
          count: z.number().int(),
          operators: z.array(z.string()),
        }),
      }),
      'Bootstrap complete'
    ),
  },
});
