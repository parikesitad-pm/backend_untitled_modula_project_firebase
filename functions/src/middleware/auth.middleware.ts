import { Request, Response, NextFunction } from 'express';
import { auth, db } from '../config/firebase';
import { UnauthorizedError, ForbiddenError, NotFoundError, BadRequestError } from '../lib/errors';

export type PlatformRole = 'platform_owner' | null;
export type WorkspaceRole = 'workspace_admin' | 'editor' | 'viewer';
export type OperatorRole = 'operator' | 'manager' | 'owner' | 'crown'; // legacy

export const ROLE_HIERARCHY: Record<OperatorRole, number> = {
  operator: 1,
  manager: 2,
  owner: 3,
  crown: 4,
};

export type Capability =
  | 'auth:me'
  | 'read:basic'
  | 'read:content'
  | 'write:content'
  | 'storage:upload'
  | 'assets:manage'
  | 'activity:lifecycle'
  | 'read:pii'
  | 'activity:delete'
  | 'operators:manage';

export const PERMISSION_MATRIX: Record<Capability, OperatorRole> = {
  'auth:me': 'operator',
  'read:basic': 'operator',
  'read:content': 'operator',
  'write:content': 'operator',
  'storage:upload': 'operator',
  'assets:manage': 'operator',
  'activity:lifecycle': 'manager',
  'read:pii': 'manager',
  'activity:delete': 'owner',
  'operators:manage': 'owner',
};

export type WorkspaceCapability =
  | 'read:content'
  | 'write:content'
  | 'activity:lifecycle'
  | 'activity:delete'
  | 'read:pii';

export const WORKSPACE_CAPABILITY_ROLES: Record<WorkspaceCapability, WorkspaceRole[]> = {
  'read:content': ['workspace_admin', 'editor', 'viewer'],
  'write:content': ['workspace_admin', 'editor'],
  'activity:lifecycle': ['workspace_admin'],
  'activity:delete': ['workspace_admin'],
  'read:pii': ['workspace_admin'],
};

export interface AuthOperator {
  uid: string;
  username: string;
  platformRole: PlatformRole;
  role?: OperatorRole;
  active: boolean;
}

export interface WorkspaceMembershipInfo {
  workspaceId: string;
  uid: string;
  role: WorkspaceRole;
  active: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      operator?: AuthOperator;
      workspaceMembership?: WorkspaceMembershipInfo;
      activity?: any;
    }
  }
}

export function hasCapability(role: OperatorRole, capability: Capability): boolean {
  const minRole = PERMISSION_MATRIX[capability];
  return ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[minRole];
}

export function extractBearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or malformed Authorization header');
  }
  return header.split(' ')[1].trim();
}

async function resolveOperatorByUid(uid: string): Promise<AuthOperator> {
  const doc = await db.collection('operators').doc(uid).get();
  if (!doc.exists) {
    throw new UnauthorizedError('Operator record not found');
  }
  const data = doc.data();
  if (!data || !data.active) {
    throw new ForbiddenError('Operator account is deactivated');
  }

  let platformRole: PlatformRole = data.platformRole ?? null;
  // Backward compatibility with legacy roles
  if (platformRole === undefined || platformRole === null) {
    if (data.role === 'crown' || data.role === 'owner') {
      platformRole = 'platform_owner';
    }
  }

  return {
    uid,
    username: data.username || data.usernameNormalized,
    platformRole,
    role: data.role as OperatorRole,
    active: data.active,
  };
}

export async function verifyTokenString(token: string): Promise<AuthOperator> {
  let uid: string | undefined;

  try {
    const decoded = await auth.verifyIdToken(token, true);
    uid = decoded.uid;
  } catch (_idTokenError) {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        uid = payload.uid || payload.sub;
      }
    } catch (_fallbackError) {
      // ignore
    }
  }

  if (!uid) {
    throw new UnauthorizedError('Invalid or expired authentication token');
  }

  return await resolveOperatorByUid(uid);
}

export function requireAuth() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = extractBearerToken(req);
      const operator = await verifyTokenString(token);
      req.operator = operator;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requirePlatformOwner() {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.operator) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }
    if (req.operator.platformRole !== 'platform_owner') {
      next(new ForbiddenError('Forbidden: Requires platform_owner role'));
      return;
    }
    next();
  };
}

export async function resolveWorkspaceMembership(
  uid: string,
  workspaceId: string
): Promise<WorkspaceMembershipInfo | null> {
  const doc = await db.collection('memberships').doc(`${workspaceId}_${uid}`).get();
  if (!doc.exists) {
    return null;
  }
  const data = doc.data();
  if (!data?.active) {
    return null;
  }
  return {
    workspaceId: data.workspaceId || workspaceId,
    uid: data.uid || uid,
    role: data.role as WorkspaceRole,
    active: true,
  };
}

export interface WorkspaceCapabilityOptions {
  workspaceIdFrom?: 'params' | 'body' | 'query' | 'resource';
  paramName?: string;
  resourceType?: 'activity' | 'question' | 'group' | 'asset' | 'question_reorder';
}

export function requireWorkspaceCapability(
  capability: WorkspaceCapability,
  options: WorkspaceCapabilityOptions = { workspaceIdFrom: 'resource', resourceType: 'activity' }
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.operator) {
        throw new UnauthorizedError('Authentication required');
      }

      if (!req.operator.active) {
        throw new ForbiddenError('Operator account is deactivated');
      }

      if (req.operator.role && req.operator.platformRole !== 'platform_owner') {
        if (!hasCapability(req.operator.role, capability as any)) {
          throw new ForbiddenError(`Forbidden: Requires capability '${capability}'`);
        }
      }

      let targetWorkspaceId: string | undefined;

      if (options.workspaceIdFrom === 'params') {
        const paramName = options.paramName || 'workspaceId';
        targetWorkspaceId = req.params[paramName];
      } else if (options.workspaceIdFrom === 'body') {
        targetWorkspaceId = req.body?.workspaceId || 'internal';
      } else if (options.workspaceIdFrom === 'query') {
        targetWorkspaceId = (req.query?.workspaceId as string) || undefined;
      } else if (options.workspaceIdFrom === 'resource') {
        const resType = options.resourceType || 'activity';

        if (resType === 'activity') {
          const actId = req.params.id || req.params.activityId;
          if (!actId) {
            throw new BadRequestError('Activity ID is missing');
          }
          const actDoc = await db.collection('activities').doc(actId).get();
          if (!actDoc.exists) {
            throw new NotFoundError(`Activity '${actId}' not found`);
          }
          const actData = actDoc.data();
          req.activity = { id: actDoc.id, ...actData };
          targetWorkspaceId = actData?.workspaceId || 'internal';
        } else if (resType === 'question') {
          const qId = req.params.id || req.params.questionId;
          if (!qId) {
            throw new BadRequestError('Question ID is missing');
          }
          const qDoc = await db.collection('questions').doc(qId).get();
          if (!qDoc.exists) {
            throw new NotFoundError(`Question '${qId}' not found`);
          }
          const qData = qDoc.data();
          const actDoc = await db.collection('activities').doc(qData?.activityId).get();
          if (!actDoc.exists) {
            throw new NotFoundError(`Activity '${qData?.activityId}' not found`);
          }
          targetWorkspaceId = actDoc.data()?.workspaceId || 'internal';
        } else if (resType === 'question_reorder') {
          const actId = req.body?.activityId;
          if (!actId) {
            throw new BadRequestError('Activity ID is missing');
          }
          const actDoc = await db.collection('activities').doc(actId).get();
          if (!actDoc.exists) {
            throw new NotFoundError(`Activity '${actId}' not found`);
          }
          targetWorkspaceId = actDoc.data()?.workspaceId || 'internal';
        } else if (resType === 'asset') {
          const actId = req.body?.activityId;
          if (!actId) {
            throw new BadRequestError('Activity ID is missing');
          }
          const actDoc = await db.collection('activities').doc(actId).get();
          if (!actDoc.exists) {
            throw new NotFoundError(`Activity '${actId}' not found`);
          }
          targetWorkspaceId = actDoc.data()?.workspaceId || 'internal';
        } else if (resType === 'group') {
          const groupId = req.params.groupId;
          if (!groupId) {
            throw new BadRequestError('Group ID is missing');
          }
          const snap = await db.collection('activities').where('groupId', '==', groupId).get();
          if (snap.empty) {
            throw new NotFoundError(`No activities found for group '${groupId}'`);
          }
          const activities = snap.docs.map((d) => d.data());
          const firstWs = activities[0].workspaceId || 'internal';
          if (activities.some((a) => (a.workspaceId || 'internal') !== firstWs)) {
            throw new BadRequestError('Cross-workspace pre/post comparison is not allowed', 'CROSS_WORKSPACE_GROUP');
          }
          targetWorkspaceId = firstWs;
        }
      }

      const finalWorkspaceId = targetWorkspaceId || 'internal';

      // Platform owner has global bypass
      if (req.operator.platformRole === 'platform_owner') {
        req.workspaceMembership = {
          workspaceId: finalWorkspaceId,
          role: 'workspace_admin',
          uid: req.operator.uid,
          active: true,
        };
        next();
        return;
      }

      // Check explicit membership
      const membership = await resolveWorkspaceMembership(req.operator.uid, finalWorkspaceId);
      if (!membership) {
        // Fallback for legacy role if accessing default 'internal' workspace
        if (finalWorkspaceId === 'internal' && req.operator.role) {
          const legacyRole = req.operator.role;
          const allowedRoles = WORKSPACE_CAPABILITY_ROLES[capability];
          let effectiveRole: WorkspaceRole | null = null;
          if (legacyRole === 'manager') {
            if (capability !== 'activity:delete') {
              effectiveRole = 'workspace_admin';
            }
          } else if (legacyRole === 'operator') {
            if (capability === 'read:content' || capability === 'write:content') {
              effectiveRole = 'editor';
            }
          }

          if (effectiveRole && allowedRoles.includes(effectiveRole)) {
            req.workspaceMembership = {
              workspaceId: 'internal',
              role: effectiveRole,
              uid: req.operator.uid,
              active: true,
            };
            next();
            return;
          }
        }

        throw new ForbiddenError('Not authorized for this workspace');
      }

      const allowedRoles = WORKSPACE_CAPABILITY_ROLES[capability];
      if (!allowedRoles.includes(membership.role)) {
        throw new ForbiddenError(`Forbidden: Requires capability '${capability}'`);
      }

      req.workspaceMembership = membership;
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireCapability(capability: Capability) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.operator) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }

    if (capability === 'operators:manage') {
      if (req.operator.platformRole === 'platform_owner' || (req.operator.role && ['crown', 'owner'].includes(req.operator.role))) {
        next();
        return;
      }
      next(new ForbiddenError(`Forbidden: Requires capability '${capability}'`));
      return;
    }

    if (req.operator.platformRole === 'platform_owner') {
      next();
      return;
    }

    if (req.operator.role && hasCapability(req.operator.role, capability)) {
      next();
      return;
    }

    next(new ForbiddenError(`Forbidden: Requires capability '${capability}'`));
  };
}

export function requireRole(minimumRole: OperatorRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.operator) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }
    if (req.operator.platformRole === 'platform_owner') {
      next();
      return;
    }
    if (req.operator.role && ROLE_HIERARCHY[req.operator.role] >= ROLE_HIERARCHY[minimumRole]) {
      next();
      return;
    }
    next(new ForbiddenError(`Insufficient permissions. Requires role: ${minimumRole}`));
  };
}
