import { z } from 'zod';
import { WorkspaceRoleSchema } from '../workspaces/workspaces.schema';

export const OperatorRoleSchema = z.enum(['operator', 'manager', 'owner', 'crown']);

export const CreateOperatorMembershipAssignmentSchema = z.object({
  workspaceId: z.string().min(1),
  role: WorkspaceRoleSchema,
});

export const CreateOperatorSchema = z.object({
  username: z.string().min(2).max(50),
  accessCode: z.string().min(12, 'Access code must be at least 12 characters'),
  role: OperatorRoleSchema.optional().default('operator'),
  platformRole: z.enum(['platform_owner']).nullable().optional(),
  memberships: z.array(CreateOperatorMembershipAssignmentSchema).optional(),
});

export type CreateOperatorInput = z.infer<typeof CreateOperatorSchema>;

export const UpdateOperatorSchema = z.object({
  role: OperatorRoleSchema.optional(),
  platformRole: z.enum(['platform_owner']).nullable().optional(),
  active: z.boolean().optional(),
  accessCode: z.string().min(12, 'Access code must be at least 12 characters').optional(),
});

export type UpdateOperatorInput = z.infer<typeof UpdateOperatorSchema>;

export const OperatorItemSchema = z.object({
  uid: z.string(),
  username: z.string(),
  role: OperatorRoleSchema.optional(),
  platformRole: z.enum(['platform_owner']).nullable().optional(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type OperatorItem = z.infer<typeof OperatorItemSchema>;
