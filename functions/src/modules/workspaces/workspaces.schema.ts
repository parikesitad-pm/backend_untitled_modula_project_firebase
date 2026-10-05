import { z } from 'zod';

export const WorkspaceStatusSchema = z.enum(['active', 'archived']);
export type WorkspaceStatus = z.infer<typeof WorkspaceStatusSchema>;

export const WorkspaceRoleSchema = z.enum(['workspace_admin', 'editor', 'viewer']);
export type WorkspaceRole = z.infer<typeof WorkspaceRoleSchema>;

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1, 'Workspace name is required').max(100),
  slug: z
    .string()
    .min(2, 'Slug must be at least 2 characters')
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens'),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceSchema>;

export const UpdateWorkspaceSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  slug: z
    .string()
    .min(2)
    .max(50)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  status: WorkspaceStatusSchema.optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof UpdateWorkspaceSchema>;

export const WorkspaceItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  status: WorkspaceStatusSchema,
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkspaceItem = z.infer<typeof WorkspaceItemSchema>;

export const CreateMembershipSchema = z.object({
  uid: z.string().min(1, 'uid is required'),
  role: WorkspaceRoleSchema,
});
export type CreateMembershipInput = z.infer<typeof CreateMembershipSchema>;

export const UpdateMembershipSchema = z.object({
  role: WorkspaceRoleSchema.optional(),
  active: z.boolean().optional(),
});
export type UpdateMembershipInput = z.infer<typeof UpdateMembershipSchema>;

export const MembershipItemSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  uid: z.string(),
  username: z.string().optional(),
  role: WorkspaceRoleSchema,
  active: z.boolean(),
  createdBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type MembershipItem = z.infer<typeof MembershipItemSchema>;

