import { z } from 'zod';

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  attemptId: z.string(),
  displayName: z.string(),
  status: z.enum(['in_progress', 'completed']),
  locked: z.boolean(),
  leaderboardPoints: z.number(),
  scorePercent: z.number(),
  finalScore: z.number().optional(),
  answeredCount: z.number().int().min(0),
  totalQuestions: z.number().int().min(0),
  durationMs: z.number(),
  lastAnswerAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
  rankTimeAt: z.string().nullable().optional(),
});

export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardResponseSchema = z.object({
  disabled: z.boolean().optional(),
  message: z.string().optional(),
  activityId: z.string(),
  activityTitle: z.string(),
  slug: z.string(),
  state: z.enum(['live', 'final']),
  top5: z.array(LeaderboardEntrySchema),
  others: z.array(LeaderboardEntrySchema),
  entries: z.array(LeaderboardEntrySchema).optional(),
  totalCompleted: z.number().int().min(0),
  totalEntries: z.number().int().min(0).optional(),
  updatedAt: z.string(),
});

export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;
