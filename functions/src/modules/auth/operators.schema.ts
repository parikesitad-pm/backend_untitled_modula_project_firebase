import { z } from 'zod';

export const OperatorRoleSchema = z.enum(['operator', 'manager', 'owner', 'crown']);

export const CreateOperatorSchema = z.object({
  username: z.string().min(2).max(50),
  accessCode: z.string().min(12, 'Access code must be at least 12 characters'),
  role: OperatorRoleSchema,
});

export type CreateOperatorInput = z.infer<typeof CreateOperatorSchema>;

export const UpdateOperatorSchema = z.object({
  role: OperatorRoleSchema.optional(),
  active: z.boolean().optional(),
  accessCode: z.string().min(12, 'Access code must be at least 12 characters').optional(),
});

export type UpdateOperatorInput = z.infer<typeof UpdateOperatorSchema>;

export const OperatorItemSchema = z.object({
  uid: z.string(),
  username: z.string(),
  role: OperatorRoleSchema,
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type OperatorItem = z.infer<typeof OperatorItemSchema>;
