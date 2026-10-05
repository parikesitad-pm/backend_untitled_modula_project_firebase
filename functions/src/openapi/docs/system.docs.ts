import { z } from 'zod';
import { registry, jsonResponse } from '../registry';

export const HealthResponseSchema = registry.register(
  'HealthResponse',
  z.object({
    status: z.literal('ok'),
    service: z.string().openapi({ example: 'modula-backend' }),
    version: z.string().openapi({ example: '0.4.0' }),
  })
);

registry.registerPath({
  method: 'get',
  path: '/api/health',
  tags: ['System'],
  summary: 'System health check',
  description: 'Returns the current service status and API version.',
  responses: {
    200: jsonResponse(HealthResponseSchema, 'Service is healthy'),
  },
});

