import { z } from 'zod';

export const SubmitAnswerSchema = z.object({
  questionId: z.string().min(1, 'questionId is required'),
  selectedChoiceIds: z.array(z.string()).min(1, 'At least one choice must be selected'),
  enteredAt: z.string().datetime({ message: 'enteredAt must be valid ISO 8601 string' }),
  answeredAt: z.string().datetime({ message: 'answeredAt must be valid ISO 8601 string' }),
  durationMs: z.number().int().min(0).optional(),
  changeCount: z.number().int().min(0).optional(),
});

export type SubmitAnswerInput = z.infer<typeof SubmitAnswerSchema>;

export const FinishAttemptSchema = z.object({}).optional();
