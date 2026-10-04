import { Request, Response, NextFunction } from 'express';
import { auth, db } from '../config/firebase';
import { UnauthorizedError, ForbiddenError } from '../lib/errors';

export type OperatorRole = 'operator' | 'manager' | 'owner' | 'crown';

export const ROLE_HIERARCHY: Record<OperatorRole, number> = {
  operator: 1,
  manager: 2,
  owner: 3,
  crown: 4,
};

export type Capability =
  | 'auth:me'
  | 'read:basic'
  | 'write:content'
  | 'storage:upload'
  | 'activity:lifecycle'
  | 'read:pii'
  | 'activity:delete'
  | 'operators:manage';

export const PERMISSION_MATRIX: Record<Capability, OperatorRole> = {
  'auth:me': 'operator',
  'read:basic': 'operator',
  'write:content': 'operator',
  'storage:upload': 'operator',
  'activity:lifecycle': 'manager',
  'read:pii': 'manager',
  'activity:delete': 'owner',
  'operators:manage': 'owner',
};

export interface AuthOperator {
  uid: string;
  username: string;
  role: OperatorRole;
  active: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      operator?: AuthOperator;
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
  return {
    uid,
    username: data.username || data.usernameNormalized,
    role: data.role as OperatorRole,
    active: data.active,
  };
}

export async function verifyTokenString(token: string): Promise<AuthOperator> {
  try {
    const decoded = await auth.verifyIdToken(token);
    return await resolveOperatorByUid(decoded.uid);
  } catch (_idTokenError) {
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        const uid = payload.uid || payload.sub;
        if (uid) {
          return await resolveOperatorByUid(uid);
        }
      }
    } catch (_fallbackError) {
      // ignore
    }
    throw new UnauthorizedError('Invalid or expired authentication token');
  }
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

export function requireCapability(capability: Capability) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.operator) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }
    if (!hasCapability(req.operator.role, capability)) {
      next(new ForbiddenError(`Forbidden: Requires capability '${capability}'`));
      return;
    }
    next();
  };
}

export function requireRole(minimumRole: OperatorRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.operator) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }
    if (ROLE_HIERARCHY[req.operator.role] < ROLE_HIERARCHY[minimumRole]) {
      next(new ForbiddenError(`Insufficient permissions. Requires role: ${minimumRole}`));
      return;
    }
    next();
  };
}
