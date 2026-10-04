import { z } from 'zod';

export function normalizeParticipantCode(code: string): string {
  return code.trim().replace(/\s+/g, ' ').toUpperCase();
}

export const ParticipantInputSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100).trim(),
  participantCode: z
    .string()
    .min(1, 'Participant code is required')
    .max(100)
    .transform(normalizeParticipantCode),
  email: z.string().email().nullable().optional(),
  division: z.string().max(100).nullable().optional(),
  customFields: z.record(z.unknown()).optional().default({}),
});

export type ParticipantInput = z.infer<typeof ParticipantInputSchema>;

export const StartAttemptSchema = ParticipantInputSchema;
export type StartAttemptInput = z.infer<typeof StartAttemptSchema>;
