import { z } from 'zod';
import { registry, jsonResponse, ErrorResponseSchema } from '../registry';
import {
  CreateWorkspaceSchema,
  UpdateWorkspaceSchema,
  WorkspaceItemSchema,
  CreateMembershipSchema,
  UpdateMembershipSchema,
  MembershipItemSchema,
} from '../../modules/workspaces/workspaces.schema';

// 1. GET /api/workspaces
registry.registerPath({
  method: 'get',
  path: '/api/workspaces',
  tags: ['Workspaces'],
  summary: 'List workspaces',
  description:
    'Returns all workspaces for platform_owner, or only workspaces where the caller has active membership.',
  security: [{ BearerAuth: [] }],
  responses: {
    200: jsonResponse(
      z.object({
        success: z.literal(true),
        data: z.array(WorkspaceItemSchema),
      }),
      'Workspaces retrieved successfully'
    ),
    401: jsonResponse(ErrorResponseSchema, 'Missing or invalid authentication token'),
  },
});

// 2. POST /api/workspaces
registry.registerPath({
  method: 'post',
  path: '/api/workspaces',
  tags: ['Workspaces'],
  summary: 'Create a new workspace',
  description: 'Creates an isolated workspace. Requires platform_owner role.',
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateWorkspaceSchema.openapi({
            example: {
              name: 'Bank Rakyat Indonesia',
              slug: 'bri',
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
        data: WorkspaceItemSchema,
      }),
      'Workspace created successfully'
    ),
    400: jsonResponse(ErrorResponseSchema, 'Invalid workspace payload'),
    401: jsonResponse(ErrorResponseSchema, 'Missing or invalid authentication token'),
    403: jsonResponse(ErrorResponseSchema, 'Requires platform_owner role'),
    409: jsonResponse(ErrorResponseSchema, 'Workspace slug already exists'),
  },
});

// 3. GET /api/workspaces/{workspaceId}
registry.registerPath({
  method: 'get',
  path: '/api/workspaces/{workspaceId}',
  tags: ['Workspaces'],
  summary: 'Get workspace details by ID or slug',
  description:
    'Retrieves workspace details. Requires platform_owner role or active membership in the workspace.',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({
      workspaceId: z.string().openapi({ example: 'bri' }),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        success: z.literal(true),
        data: WorkspaceItemSchema,
      }),
      'Workspace details'
    ),
    401: jsonResponse(ErrorResponseSchema, 'Missing or invalid authentication token'),
    403: jsonResponse(ErrorResponseSchema, 'Not authorized for this workspace'),
    404: jsonResponse(ErrorResponseSchema, 'Workspace not found'),
  },
});

// 4. PATCH /api/workspaces/{workspaceId}
registry.registerPath({
  method: 'patch',
  path: '/api/workspaces/{workspaceId}',
  tags: ['Workspaces'],
  summary: 'Update workspace',
  description: 'Updates workspace properties. Requires platform_owner role.',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({
      workspaceId: z.string().openapi({ example: 'bri' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateWorkspaceSchema.openapi({
            example: {
              name: 'Bank Rakyat Indonesia (Updated)',
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
        data: WorkspaceItemSchema,
      }),
      'Workspace updated successfully'
    ),
    400: jsonResponse(ErrorResponseSchema, 'Invalid update payload'),
    401: jsonResponse(ErrorResponseSchema, 'Missing or invalid authentication token'),
    403: jsonResponse(ErrorResponseSchema, 'Requires platform_owner role'),
    404: jsonResponse(ErrorResponseSchema, 'Workspace not found'),
    409: jsonResponse(ErrorResponseSchema, 'New slug already taken'),
  },
});

// 5. POST /api/workspaces/{workspaceId}/archive
registry.registerPath({
  method: 'post',
  path: '/api/workspaces/{workspaceId}/archive',
  tags: ['Workspaces'],
  summary: 'Archive workspace',
  description:
    'Archives a workspace, preventing new Activity creation while preserving historical data. Requires platform_owner role.',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({
      workspaceId: z.string().openapi({ example: 'bri' }),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        success: z.literal(true),
        data: WorkspaceItemSchema,
      }),
      'Workspace archived successfully'
    ),
    401: jsonResponse(ErrorResponseSchema, 'Missing or invalid authentication token'),
    403: jsonResponse(ErrorResponseSchema, 'Requires platform_owner role'),
    404: jsonResponse(ErrorResponseSchema, 'Workspace not found'),
  },
});

// 6. GET /api/workspaces/{workspaceId}/members
registry.registerPath({
  method: 'get',
  path: '/api/workspaces/{workspaceId}/members',
  tags: ['Memberships'],
  summary: 'List workspace members',
  description: 'Lists all operators assigned to a workspace. Requires platform_owner role.',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({
      workspaceId: z.string().openapi({ example: 'bri' }),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        success: z.literal(true),
        data: z.array(MembershipItemSchema),
      }),
      'Members list'
    ),
    401: jsonResponse(ErrorResponseSchema, 'Missing or invalid authentication token'),
    403: jsonResponse(ErrorResponseSchema, 'Requires platform_owner role'),
    404: jsonResponse(ErrorResponseSchema, 'Workspace not found'),
  },
});

// 7. POST /api/workspaces/{workspaceId}/members
registry.registerPath({
  method: 'post',
  path: '/api/workspaces/{workspaceId}/members',
  tags: ['Memberships'],
  summary: 'Assign operator to workspace',
  description:
    'Assigns an active operator to a workspace with a role (workspace_admin, editor, or viewer). Requires platform_owner role.',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({
      workspaceId: z.string().openapi({ example: 'bri' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: CreateMembershipSchema.openapi({
            example: {
              uid: 'user_123',
              role: 'editor',
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
        data: MembershipItemSchema,
      }),
      'Membership created successfully'
    ),
    400: jsonResponse(ErrorResponseSchema, 'Invalid membership payload or deactivated operator'),
    401: jsonResponse(ErrorResponseSchema, 'Missing or invalid authentication token'),
    403: jsonResponse(ErrorResponseSchema, 'Requires platform_owner role'),
    404: jsonResponse(ErrorResponseSchema, 'Workspace or Operator not found'),
  },
});

// 8. PATCH /api/workspaces/{workspaceId}/members/{uid}
registry.registerPath({
  method: 'patch',
  path: '/api/workspaces/{workspaceId}/members/{uid}',
  tags: ['Memberships'],
  summary: 'Update workspace membership',
  description:
    'Updates role or active status of a membership. Deactivating denies workspace access immediately. Requires platform_owner role.',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({
      workspaceId: z.string().openapi({ example: 'bri' }),
      uid: z.string().openapi({ example: 'user_123' }),
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateMembershipSchema.openapi({
            example: {
              role: 'workspace_admin',
              active: true,
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
        data: MembershipItemSchema,
      }),
      'Membership updated successfully'
    ),
    400: jsonResponse(ErrorResponseSchema, 'Invalid update payload'),
    401: jsonResponse(ErrorResponseSchema, 'Missing or invalid authentication token'),
    403: jsonResponse(ErrorResponseSchema, 'Requires platform_owner role'),
    404: jsonResponse(ErrorResponseSchema, 'Membership not found'),
  },
});

// 9. DELETE /api/workspaces/{workspaceId}/members/{uid}
registry.registerPath({
  method: 'delete',
  path: '/api/workspaces/{workspaceId}/members/{uid}',
  tags: ['Memberships'],
  summary: 'Remove operator membership from workspace',
  description:
    'Deletes the workspace membership. Does not delete the operator account. Requires platform_owner role.',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({
      workspaceId: z.string().openapi({ example: 'bri' }),
      uid: z.string().openapi({ example: 'user_123' }),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        success: z.literal(true),
        message: z.string(),
      }),
      'Membership removed successfully'
    ),
    401: jsonResponse(ErrorResponseSchema, 'Missing or invalid authentication token'),
    403: jsonResponse(ErrorResponseSchema, 'Requires platform_owner role'),
    404: jsonResponse(ErrorResponseSchema, 'Membership not found'),
  },
});

