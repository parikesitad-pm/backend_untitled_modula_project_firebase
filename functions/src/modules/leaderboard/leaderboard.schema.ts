import { z } from 'zod';

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  attemptId: z.string().optional(),
  displayName: z.string(),
  status: z.enum(['in_progress', 'completed']).optional(),
  locked: z.boolean().optional(),
  leaderboardPoints: z.number(),
  scorePercent: z.number().optional(),
  finalScore: z.number().optional(),
  answeredCount: z.number().int().min(0).optional(),
  totalQuestions: z.number().int().min(0).optional(),
  durationMs: z.number(),
  rankTimeAt: z.string().optional(),
  lastAnswerAt: z.string().nullable().optional(),
  completedAt: z.string().nullable().optional(),
});

export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardResponseSchema = z.object({
  activityId: z.string(),
  activityTitle: z.string(),
  slug: z.string(),
  state: z.enum(['live', 'final']).optional(),
  top5: z.array(LeaderboardEntrySchema),
  others: z.array(LeaderboardEntrySchema),
  totalCompleted: z.number().int().min(0),
  totalEntries: z.number().int().min(0).optional(),
  updatedAt: z.string(),
});

export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;
