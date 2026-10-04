import { z } from 'zod';

export const ActivityStatsSummarySchema = z.object({
  activityId: z.string(),
  totalParticipants: z.number().int().min(0),
  totalAttempts: z.number().int().min(0),
  completedAttempts: z.number().int().min(0),
  incompleteAttempts: z.number().int().min(0),
  completionRate: z.number().min(0).max(100),
  scores: z.object({
    average: z.number().min(0).max(100),
    highest: z.number().min(0).max(100),
    lowest: z.number().min(0).max(100),
  }),
  timing: z.object({
    averageDurationMs: z.number().min(0),
    fastestDurationMs: z.number().min(0),
  }),
  updatedAt: z.string(),
});

export type ActivityStatsSummary = z.infer<typeof ActivityStatsSummarySchema>;

export const QuestionStatSchema = z.object({
  questionId: z.string(),
  body: z.string(),
  weight: z.number(),
  totalAnswers: z.number().int().min(0),
  correctAnswers: z.number().int().min(0),
  correctPercentage: z.number().min(0).max(100),
  averageDurationMs: z.number().min(0),
});

export type QuestionStat = z.infer<typeof QuestionStatSchema>;

export const PrePostParticipantComparisonSchema = z.object({
  participantCode: z.string(),
  name: z.string(),
  preScore: z.number().nullable(),
  postScore: z.number().nullable(),
  scoreDelta: z.number().nullable(),
  delta: z.number().nullable(),
  matched: z.boolean(),
});

export type PrePostParticipantComparison = z.infer<typeof PrePostParticipantComparisonSchema>;

export const PrePostComparisonSchema = z.object({
  groupId: z.string(),
  preActivity: z.object({ id: z.string(), title: z.string(), averageScore: z.number() }).nullable(),
  postActivity: z.object({ id: z.string(), title: z.string(), averageScore: z.number() }).nullable(),
  scoreDelta: z.number(),
  matchedCount: z.number().int().min(0),
  unmatchedCount: z.number().int().min(0),
  totalParticipants: z.number().int().min(0),
  matchedAverageDelta: z.number(),
  participants: z.array(PrePostParticipantComparisonSchema),
  questionStatsDelta: z.array(
    z.object({
      questionIndex: z.number().int().min(0),
      preCorrectPercentage: z.number(),
      postCorrectPercentage: z.number(),
      delta: z.number(),
    })
  ),
});

export type PrePostComparison = z.infer<typeof PrePostComparisonSchema>;
