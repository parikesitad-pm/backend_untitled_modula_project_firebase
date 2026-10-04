import { Request, Response, NextFunction } from 'express';
import { auth, db } from '../config/firebase';
import { UnauthorizedError, ForbiddenError } from '../lib/errors';

export type OperatorRole = 'operator' | 'manager' | 'owner' | 'crown';

const ROLE_RANKS: Record<OperatorRole, number> = {
  operator: 1,
  manager: 2,
  owner: 3,
  crown: 4,
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
    // Fallback for custom tokens / dev environment tokens
    try {
      const parts = token.split('.');
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        const uid = payload.uid || payload.sub;
        if (uid) {
          return await resolveOperatorByUid(uid);
        }
      }
    } catch (_fallbackError) {
      // ignore, throw original unauthorized
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

export function requireRole(minimumRole: OperatorRole) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.operator) {
      next(new UnauthorizedError('Authentication required'));
      return;
    }
    const currentRank = ROLE_RANKS[req.operator.role] || 0;
    const requiredRank = ROLE_RANKS[minimumRole] || 0;

    if (currentRank < requiredRank) {
      next(new ForbiddenError(`Insufficient permissions. Requires role: ${minimumRole}`));
      return;
    }
    next();
  };
}
