import { z } from 'zod';

export const LoginRequestSchema = z.object({
  username: z.string().min(2).max(50),
  accessCode: z.string().min(4).max(100),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const OperatorWorkspaceMembershipSchema = z.object({
  workspaceId: z.string(),
  role: z.enum(['workspace_admin', 'editor', 'viewer']),
});
export type OperatorWorkspaceMembership = z.infer<typeof OperatorWorkspaceMembershipSchema>;

export const OperatorResponseSchema = z.object({
  uid: z.string(),
  username: z.string(),
  role: z.enum(['operator', 'manager', 'owner', 'crown']).optional(),
  platformRole: z.enum(['platform_owner']).nullable().optional(),
  workspaces: z.array(OperatorWorkspaceMembershipSchema).optional(),
  active: z.boolean(),
});

export type OperatorResponse = z.infer<typeof OperatorResponseSchema>;

export const LoginResponseSchema = z.object({
  token: z.string(),
  operator: OperatorResponseSchema,
});

export type LoginResponse = z.infer<typeof LoginResponseSchema>;
