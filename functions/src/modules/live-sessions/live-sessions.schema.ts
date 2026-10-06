import { z } from 'zod';

export const LiveSessionStatusSchema = z.enum(['lobby', 'live', 'completed']);
export type LiveSessionStatus = z.infer<typeof LiveSessionStatusSchema>;

export const LiveParticipantStatusSchema = z.enum(['joined', 'active', 'completed', 'disconnected']);
export type LiveParticipantStatus = z.infer<typeof LiveParticipantStatusSchema>;

export const CreateLiveSessionSchema = z.object({
  activityId: z.string().min(1, 'activityId is required'),
  workspaceId: z.string().optional(),
});

export type CreateLiveSessionInput = z.infer<typeof CreateLiveSessionSchema>;

export const JoinLiveSessionSchema = z.object({
  participantId: z.string().optional(),
  displayName: z.string().min(1).max(100),
  participantCode: z.string().optional(),
});

export type JoinLiveSessionInput = z.infer<typeof JoinLiveSessionSchema>;

export const LiveParticipantHeartbeatSchema = z.object({
  participantId: z.string().min(1),
  status: LiveParticipantStatusSchema.optional().default('active'),
});

export type LiveParticipantHeartbeatInput = z.infer<typeof LiveParticipantHeartbeatSchema>;

export const SetQuestionIndexSchema = z.object({
  questionIndex: z.number().int().min(0),
});

export type SetQuestionIndexInput = z.infer<typeof SetQuestionIndexSchema>;

