import { z } from 'zod';
import { registry, jsonResponse, ErrorResponseSchema } from '../registry';
import {
  CreateLiveSessionSchema,
  JoinLiveSessionSchema,
  LiveParticipantHeartbeatSchema,
  SetQuestionIndexSchema,
} from '../../modules/live-sessions/live-sessions.schema';

const LiveSessionOutSchema = z.object({
  id: z.string(),
  activityId: z.string(),
  assessmentId: z.string(),
  workspaceId: z.string(),
  pin: z.string(),
  status: z.enum(['lobby', 'live', 'completed']),
  createdBy: z.string(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  currentQuestionIndex: z.number().int(),
  timeLimitEnabled: z.boolean(),
  activityTimeLimitSeconds: z.number().nullable(),
  expiresAt: z.string().nullable(),
  updatedAt: z.string(),
});

const LiveParticipantOutSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  participantCode: z.string().optional(),
  joinedAt: z.string(),
  status: z.enum(['joined', 'active', 'completed', 'disconnected']),
  attemptId: z.string().nullable(),
  lastSeenAt: z.string(),
});

registry.registerPath({
  method: 'post',
  path: '/api/live-sessions',
  tags: ['LiveSessions'],
  summary: 'Create a live play session',
  security: [{ BearerAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateLiveSessionSchema.openapi({
            example: {
              activityId: 'activity-123',
            },
          }),
        },
      },
    },
  },
  responses: {
    201: jsonResponse(
      z.object({ success: z.literal(true), message: z.string(), data: z.object({ session: LiveSessionOutSchema }) }),
      'Live session created in lobby status'
    ),
    400: jsonResponse(ErrorResponseSchema, 'Bad request'),
    401: jsonResponse(ErrorResponseSchema, 'Unauthorized'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/live-sessions/{id}',
  tags: ['LiveSessions'],
  summary: 'Get live play session by ID (Host)',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(
      z.object({ success: z.literal(true), data: z.object({ session: LiveSessionOutSchema }) }),
      'Live session details'
    ),
    404: jsonResponse(ErrorResponseSchema, 'Not found'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/live-sessions/{id}/start',
  tags: ['LiveSessions'],
  summary: 'Start live play activity (Host - transition lobby to live)',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(
      z.object({ success: z.literal(true), message: z.string(), data: z.object({ session: LiveSessionOutSchema }) }),
      'Live session started'
    ),
    400: jsonResponse(ErrorResponseSchema, 'Bad request'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/live-sessions/{id}/question-index',
  tags: ['LiveSessions'],
  summary: 'Set current question index (Host)',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: SetQuestionIndexSchema,
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      z.object({ success: z.literal(true), data: z.object({ session: LiveSessionOutSchema }) }),
      'Current question index updated'
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/live-sessions/{id}/next-question',
  tags: ['LiveSessions'],
  summary: 'Advance to next question (Host)',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(
      z.object({ success: z.literal(true), data: z.object({ session: LiveSessionOutSchema }) }),
      'Advanced to next question'
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/live-sessions/{id}/end',
  tags: ['LiveSessions'],
  summary: 'End live session (Host)',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(
      z.object({ success: z.literal(true), message: z.string(), data: z.object({ session: LiveSessionOutSchema }) }),
      'Live session ended'
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/live-sessions/{id}/participants',
  tags: ['LiveSessions'],
  summary: 'List connected participants in live session',
  security: [{ BearerAuth: [] }],
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        success: z.literal(true),
        data: z.object({
          participants: z.array(LiveParticipantOutSchema),
          total: z.number().int(),
        }),
      }),
      'Participant list'
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/api/public/live-sessions/{id}',
  tags: ['LiveSessions'],
  summary: 'Get public live session state by ID or 6-digit PIN',
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        success: z.literal(true),
        data: z.object({
          session: z.object({
            id: z.string(),
            activityId: z.string(),
            assessmentId: z.string(),
            pin: z.string(),
            status: z.enum(['lobby', 'live', 'completed']),
            startedAt: z.string().nullable(),
            expiresAt: z.string().nullable(),
            currentQuestionIndex: z.number().int(),
            timeLimitEnabled: z.boolean(),
            activityTimeLimitSeconds: z.number().nullable(),
          }),
        }),
      }),
      'Public session state'
    ),
    404: jsonResponse(ErrorResponseSchema, 'Not found'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/public/live-sessions/{id}/join',
  tags: ['LiveSessions'],
  summary: 'Join live session lobby (Participant)',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: JoinLiveSessionSchema,
        },
      },
    },
  },
  responses: {
    201: jsonResponse(
      z.object({
        success: z.literal(true),
        message: z.string(),
        data: z.object({ participant: LiveParticipantOutSchema }),
      }),
      'Joined live session lobby'
    ),
  },
});

registry.registerPath({
  method: 'post',
  path: '/api/public/live-sessions/{id}/heartbeat',
  tags: ['LiveSessions'],
  summary: 'Participant presence heartbeat',
  request: {
    params: z.object({ id: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: LiveParticipantHeartbeatSchema,
        },
      },
    },
  },
  responses: {
    200: jsonResponse(
      z.object({ success: z.literal(true), data: z.object({ acknowledged: z.boolean() }) }),
      'Heartbeat acknowledged'
    ),
  },
});

