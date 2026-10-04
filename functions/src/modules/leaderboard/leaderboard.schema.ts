import { z } from 'zod';

export const LeaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  attemptId: z.string(),
  participantId: z.string(),
  participantName: z.string(),
  participantCode: z.string(),
  division: z.string().nullable().optional(),
  finalScore: z.number(),
  leaderboardPoints: z.number(),
  durationMs: z.number(),
  completedAt: z.string(),
});

export type LeaderboardEntry = z.infer<typeof LeaderboardEntrySchema>;

export const LeaderboardResponseSchema = z.object({
  activityId: z.string(),
  activityTitle: z.string(),
  slug: z.string(),
  top5: z.array(LeaderboardEntrySchema),
  others: z.array(LeaderboardEntrySchema),
  totalCompleted: z.number().int().min(0),
  updatedAt: z.string(),
});

export type LeaderboardResponse = z.infer<typeof LeaderboardResponseSchema>;
