import { z } from 'zod';
import { env } from '../../config/env';

export const RichTextNodeSchema = z.object({
  type: z.enum(['text', 'bold', 'italic', 'quote', 'inline_code', 'code_block', 'link']),
  content: z.string(),
  url: z.string().optional(),
  language: z.string().optional(),
});

export const ChoiceInputSchema = z.object({
  id: z.string().optional(),
  body: z.string().min(1).max(500),
  position: z.number().int().min(0).optional(),
  isCorrect: z.boolean(),
});

export type ChoiceInput = z.infer<typeof ChoiceInputSchema>;

export const CreateQuestionSchema = z.object({
  body: z
    .string()
    .min(1, 'Question body cannot be empty')
    .max(env.MAX_QUESTION_BODY_LENGTH, `Question body limit is ${env.MAX_QUESTION_BODY_LENGTH} characters`),
  richText: z.array(RichTextNodeSchema).optional(),
  type: z.enum(['multiple_choice']).default('multiple_choice'),
  position: z.number().int().min(0).optional(),
  weight: z.number().positive().default(1),
  speedBonusEnabled: z.boolean().default(false),
  speedBonusPercent: z.number().min(0).max(100).default(env.DEFAULT_SPEED_BONUS_CAP_PERCENT),
  timeReferenceSeconds: z.number().positive().default(env.DEFAULT_TIME_REFERENCE_SECONDS),
  imagePath: z.string().optional(),
  choices: z.array(ChoiceInputSchema).min(2, 'At least 2 choices are required'),
});

export type CreateQuestionInput = z.infer<typeof CreateQuestionSchema>;

export const UpdateQuestionSchema = z.object({
  body: z
    .string()
    .min(1)
    .max(env.MAX_QUESTION_BODY_LENGTH, `Question body limit is ${env.MAX_QUESTION_BODY_LENGTH} characters`)
    .optional(),
  richText: z.array(RichTextNodeSchema).optional(),
  position: z.number().int().min(0).optional(),
  weight: z.number().positive().optional(),
  speedBonusEnabled: z.boolean().optional(),
  speedBonusPercent: z.number().min(0).max(100).optional(),
  timeReferenceSeconds: z.number().positive().optional(),
  imagePath: z.string().optional().nullable(),
  choices: z.array(ChoiceInputSchema).min(2).optional(),
});

export type UpdateQuestionInput = z.infer<typeof UpdateQuestionSchema>;

export const ReorderQuestionsSchema = z.object({
  activityId: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      position: z.number().int().min(0),
    })
  ).min(1),
});

export type ReorderQuestionsInput = z.infer<typeof ReorderQuestionsSchema>;
