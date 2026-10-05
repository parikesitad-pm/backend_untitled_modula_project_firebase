import { z } from 'zod';

export const SubmitAnswerSchema = z.object({
  questionId: z.string().min(1, 'questionId is required'),
  selectedChoiceIds: z.array(z.string()).min(1, 'At least one choice must be selected'),
  enteredAt: z.string().datetime({ message: 'enteredAt must be valid ISO 8601 string' }).optional(),
  answeredAt: z.string().datetime({ message: 'answeredAt must be valid ISO 8601 string' }).optional(),
  durationMs: z.number().int().min(0).optional(),
  changeCount: z.number().int().min(0).optional(),
});

export type SubmitAnswerInput = z.infer<typeof SubmitAnswerSchema>;

export const FinishAttemptSchema = z.object({}).optional();

export const SanitizedChoiceSchema = z.object({
  id: z.string(),
  body: z.string(),
  position: z.number().int(),
});

export const SanitizedQuestionSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  body: z.string(),
  bodyText: z.string().optional(),
  type: z.string(),
  imagePath: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
  comparisonKey: z.string().nullable().optional(),
  choices: z.array(SanitizedChoiceSchema),
});

export type SanitizedQuestion = z.infer<typeof SanitizedQuestionSchema>;
