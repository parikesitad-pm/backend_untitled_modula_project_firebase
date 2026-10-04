import { z } from 'zod';
import { env } from '../../config/env';

export const RichTextNodeSchema = z.object({
  type: z.enum(['text', 'bold', 'italic', 'quote', 'inline_code', 'code_block', 'link']),
  content: z.string(),
  url: z
    .string()
    .refine((val) => /^https?:\/\//i.test(val), {
      message: 'Only http and https links are allowed',
    })
    .optional(),
  language: z.string().optional(),
});

export type RichTextNode = z.infer<typeof RichTextNodeSchema>;

export function extractPlainText(body: string, richText?: RichTextNode[]): string {
  if (richText && richText.length > 0) {
    return richText.map((n) => n.content).join('');
  }
  return body;
}

export const ChoiceInputSchema = z.object({
  id: z.string().optional(),
  body: z.string().min(1).max(500),
  position: z.number().int().min(0).optional(),
  isCorrect: z.boolean(),
});

export type ChoiceInput = z.infer<typeof ChoiceInputSchema>;

export const CreateQuestionSchema = z
  .object({
    body: z.string().min(1, 'Question body cannot be empty'),
    richText: z.array(RichTextNodeSchema).optional(),
    type: z.enum(['multiple_choice']).default('multiple_choice'),
    position: z.number().int().min(0).optional(),
    weight: z.number().positive().default(1),
    speedBonusEnabled: z.boolean().default(false),
    speedBonusPercent: z.number().min(0).max(100).default(env.DEFAULT_SPEED_BONUS_CAP_PERCENT),
    timeReferenceSeconds: z.number().positive().default(env.DEFAULT_TIME_REFERENCE_SECONDS),
    imagePath: z.string().optional().nullable(),
    comparisonKey: z.string().max(100).optional().nullable(),
    choices: z.array(ChoiceInputSchema).min(2, 'At least 2 choices are required'),
  })
  .superRefine((data, ctx) => {
    const plain = extractPlainText(data.body, data.richText);
    if (plain.length > env.MAX_QUESTION_BODY_LENGTH) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Question plain text limit is ${env.MAX_QUESTION_BODY_LENGTH} characters (got ${plain.length})`,
        path: ['body'],
      });
    }
  });

export type CreateQuestionInput = z.infer<typeof CreateQuestionSchema>;

export const UpdateQuestionSchema = z
  .object({
    body: z.string().min(1).optional(),
    richText: z.array(RichTextNodeSchema).optional(),
    position: z.number().int().min(0).optional(),
    weight: z.number().positive().optional(),
    speedBonusEnabled: z.boolean().optional(),
    speedBonusPercent: z.number().min(0).max(100).optional(),
    timeReferenceSeconds: z.number().positive().optional(),
    imagePath: z.string().optional().nullable(),
    comparisonKey: z.string().max(100).optional().nullable(),
    choices: z.array(ChoiceInputSchema).min(2).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.body || data.richText) {
      const plain = extractPlainText(data.body || '', data.richText);
      if (plain.length > env.MAX_QUESTION_BODY_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Question plain text limit is ${env.MAX_QUESTION_BODY_LENGTH} characters (got ${plain.length})`,
          path: ['body'],
        });
      }
    }
  });

export type UpdateQuestionInput = z.infer<typeof UpdateQuestionSchema>;

export const ReorderQuestionsSchema = z.object({
  activityId: z.string(),
  items: z
    .array(
      z.object({
        id: z.string(),
        position: z.number().int().min(0),
      })
    )
    .min(1),
});

export type ReorderQuestionsInput = z.infer<typeof ReorderQuestionsSchema>;
