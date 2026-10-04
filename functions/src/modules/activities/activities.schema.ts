import { z } from 'zod';

export const ActivityModeSchema = z.enum(['quiz', 'task']);
export const ActivityStatusSchema = z.enum(['draft', 'published', 'closed', 'archived']);
export const ActivityPhaseSchema = z.enum(['pre', 'post', 'standalone']);

export const ParticipantFieldDefSchema = z.object({
  key: z.string(),
  label: z.string(),
  required: z.boolean().default(true),
  type: z.enum(['text', 'number', 'email']).default('text'),
});

export const ActivitySettingsSchema = z.object({
  timeLimitSeconds: z.number().int().positive().optional(),
  maxAttempts: z.number().int().positive().optional(),
  finishGraceSeconds: z.number().int().nonnegative().optional().default(120),
  shuffleQuestions: z.boolean().default(false),
  allowMultipleAttempts: z.boolean().default(false),
  speedBonusCapPercent: z.number().min(0).max(100).default(20),
  hideLeaderboardFromParticipants: z.boolean().default(false),
  appearance: z.record(z.unknown()).optional(),
  music: z.record(z.unknown()).optional(),
});

export const CreateActivitySchema = z
  .object({
    title: z.string().min(1).max(150),
    description: z.string().max(2000).default(''),
    slug: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens'),
    mode: ActivityModeSchema,
    phase: ActivityPhaseSchema.optional().default('standalone'),
    groupId: z.string().optional(),
    opensAt: z.string().datetime({ message: 'opensAt must be valid ISO 8601 string' }),
    closesAt: z.string().datetime({ message: 'closesAt must be valid ISO 8601 string' }),
    settings: ActivitySettingsSchema.optional().default({}),
    participantFields: z.array(ParticipantFieldDefSchema).optional().default([
      { key: 'name', label: 'Full Name', required: true, type: 'text' },
      { key: 'participantCode', label: 'Participant Code / ID', required: true, type: 'text' },
    ]),
  })
  .refine(
    (data) => new Date(data.opensAt).getTime() < new Date(data.closesAt).getTime(),
    {
      message: 'opensAt must be earlier than closesAt',
      path: ['closesAt'],
    }
  );

export type CreateActivityInput = z.infer<typeof CreateActivitySchema>;

export const UpdateActivitySchema = z
  .object({
    title: z.string().min(1).max(150).optional(),
    description: z.string().max(2000).optional(),
    slug: z
      .string()
      .min(3)
      .max(80)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
    mode: ActivityModeSchema.optional(),
    status: ActivityStatusSchema.optional(),
    phase: ActivityPhaseSchema.optional(),
    groupId: z.string().optional(),
    opensAt: z.string().datetime().optional(),
    closesAt: z.string().datetime().optional(),
    settings: ActivitySettingsSchema.partial().optional(),
    participantFields: z.array(ParticipantFieldDefSchema).optional(),
  })
  .refine(
    (data) => {
      if (data.opensAt && data.closesAt) {
        return new Date(data.opensAt).getTime() < new Date(data.closesAt).getTime();
      }
      return true;
    },
    {
      message: 'opensAt must be earlier than closesAt',
      path: ['closesAt'],
    }
  );

export type UpdateActivityInput = z.infer<typeof UpdateActivitySchema>;

export const ActivityQuerySchema = z.object({
  status: ActivityStatusSchema.optional(),
  mode: ActivityModeSchema.optional(),
  groupId: z.string().optional(),
});

export type ActivityQuery = z.infer<typeof ActivityQuerySchema>;
