import { z } from 'zod';

export const AssessmentModeSchema = z.enum([
  'quiz',
  'pretest',
  'posttest',
  'task',
  'survey',
  'form',
]);

export const PresentationModeSchema = z.enum(['formal', 'playful', 'custom']);

export const AssessmentStatusSchema = z.enum(['draft', 'active', 'archived']);

export const ChoiceSchema = z.object({
  id: z.string(),
  body: z.string(),
  isCorrect: z.boolean().optional(),
  order: z.number().int().optional(),
});

export const QuestionSchema = z.object({
  id: z.string(),
  type: z.enum(['choice', 'checkbox', 'text', 'scale', 'info']),
  title: z.string().default(''),
  body: z.string().default(''),
  description: z.string().optional(),
  choices: z.array(ChoiceSchema).optional().default([]),
  options: z.array(ChoiceSchema).optional(),
  points: z.number().nonnegative().optional().default(10),
  timeLimitSeconds: z.number().int().positive().nullable().optional(),
  allowMultiple: z.boolean().optional(),
  order: z.number().int().optional(),
  category: z.string().optional(),
  explanation: z.string().optional(),
  imageUrl: z.string().nullable().optional(),
  asset: z.any().optional(),
});

export const AssessmentSettingsSchema = z.object({
  showLeaderboard: z.boolean().default(true),
  showScore: z.boolean().default(true),
  showTimer: z.boolean().default(true),
  soundEnabled: z.boolean().default(true),
  shuffleQuestions: z.boolean().default(false),
  allowBackNavigation: z.boolean().default(true),
  requireAuth: z.boolean().default(false),
  passPercentage: z.number().min(0).max(100).default(70),
  timeLimitTotalMinutes: z.number().int().positive().optional(),
  themeStyle: z
    .enum(['dark-formal', 'steel-minimal', 'crimson-game', 'deep-charcoal'])
    .optional(),
});

export const CreateAssessmentSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(3000).default(''),
  slug: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens')
    .optional(),
  mode: AssessmentModeSchema.default('quiz'),
  presentationMode: PresentationModeSchema.default('formal'),
  status: AssessmentStatusSchema.default('draft'),
  timeLimitEnabled: z.boolean().default(false),
  activityTimeLimitSeconds: z.number().int().positive().nullable().optional(),
  leaderboardEnabled: z.boolean().default(true),
  scoreVisible: z.boolean().optional().default(true),
  rankVisible: z.boolean().optional().default(true),
  blocks: z.array(QuestionSchema).optional().default([]),
  questions: z.array(QuestionSchema).optional(),
  settings: AssessmentSettingsSchema.optional().default({}),
  bannerUrl: z.string().nullable().optional(),
  coverImage: z.string().nullable().optional(),
  ownerId: z.string().optional(), // Accepted in schema to avoid strict rejection, but strictly overwritten by backend
});

export type CreateAssessmentInput = z.infer<typeof CreateAssessmentSchema>;

export const UpdateAssessmentSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(3000).optional(),
  slug: z
    .string()
    .min(3)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  mode: AssessmentModeSchema.optional(),
  presentationMode: PresentationModeSchema.optional(),
  status: AssessmentStatusSchema.optional(),
  timeLimitEnabled: z.boolean().optional(),
  activityTimeLimitSeconds: z.number().int().positive().nullable().optional(),
  leaderboardEnabled: z.boolean().optional(),
  scoreVisible: z.boolean().optional(),
  rankVisible: z.boolean().optional(),
  blocks: z.array(QuestionSchema).optional(),
  questions: z.array(QuestionSchema).optional(),
  settings: AssessmentSettingsSchema.partial().optional(),
  bannerUrl: z.string().nullable().optional(),
  coverImage: z.string().nullable().optional(),
  ownerId: z.string().optional(), // Strictly discarded during update
});

export type UpdateAssessmentInput = z.infer<typeof UpdateAssessmentSchema>;
