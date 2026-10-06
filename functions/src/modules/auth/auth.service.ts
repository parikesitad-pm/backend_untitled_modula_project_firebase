import { db, auth } from '../../config/firebase';
import { verifyAccessCode, hashAccessCode, performDummyVerification } from '../../lib/hash';
import { UnauthorizedError, NotFoundError } from '../../lib/errors';
import { LoginRequest, LoginResponse, OperatorResponse } from './auth.schema';
import { OperatorRole } from '../../middleware/auth.middleware';
import { rateLimiterService } from './rate-limiter.service';

export class AuthService {
  private operatorsCol = db.collection('operators');

  async login(input: LoginRequest, clientIp = '127.0.0.1'): Promise<LoginResponse> {
    const normalized = input.username.trim().toLowerCase();
    const userKey = `user_${normalized}`;
    const ipKey = `ip_${clientIp}`;

    await rateLimiterService.checkRateLimit(userKey);
    await rateLimiterService.checkRateLimit(ipKey);

    let snapshot = await this.operatorsCol
      .where('usernameNormalized', '==', normalized)
      .limit(1)
      .get();

    if (snapshot.empty) {
      snapshot = await this.operatorsCol
        .where('email', '==', normalized)
        .limit(1)
        .get();
    }

    if (snapshot.empty) {
      await performDummyVerification(input.accessCode);
      await rateLimiterService.recordFailure(userKey);
      await rateLimiterService.recordFailure(ipKey);
      throw new UnauthorizedError('Invalid credentials');
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    if (!data.active) {
      await performDummyVerification(input.accessCode);
      await rateLimiterService.recordFailure(userKey);
      await rateLimiterService.recordFailure(ipKey);
      throw new UnauthorizedError('Invalid credentials');
    }

    const valid = await verifyAccessCode(input.accessCode, data.accessCodeHash);
    if (!valid) {
      await rateLimiterService.recordFailure(userKey);
      await rateLimiterService.recordFailure(ipKey);
      throw new UnauthorizedError('Invalid credentials');
    }

    await rateLimiterService.reset(userKey);
    await rateLimiterService.reset(ipKey);

    const uid = doc.id;
    const role = (data.role || 'operator') as OperatorRole;

    try {
      await auth.getUser(uid);
    } catch (_err) {
      await auth.createUser({
        uid,
        email: `${normalized}@modula.local`,
        displayName: data.username || normalized,
      });
    }

    await auth.setCustomUserClaims(uid, { role });
    let platformRole = data.platformRole ?? null;
    if (platformRole === undefined || platformRole === null) {
      if (role === 'crown' || role === 'owner') {
        platformRole = 'platform_owner';
      }
    }
    const token = await auth.createCustomToken(uid, { role });

    return {
      token,
      operator: {
        uid,
        username: data.username || normalized,
        role,
        platformRole,
        active: true,
      },
    };
  }

  async getMe(uid: string): Promise<OperatorResponse> {
    const doc = await this.operatorsCol.doc(uid).get();
    if (!doc.exists) {
      throw new NotFoundError('Operator record not found');
    }
    const data = doc.data()!;
    let platformRole = data.platformRole ?? null;
    if (platformRole === undefined || platformRole === null) {
      if (data.role === 'crown' || data.role === 'owner') {
        platformRole = 'platform_owner';
      }
    }

    const memSnap = await db.collection('memberships')
      .where('uid', '==', uid)
      .where('active', '==', true)
      .get();

    const workspaces = memSnap.docs.map((d) => ({
      workspaceId: d.data().workspaceId as string,
      role: d.data().role as any,
    }));

    return {
      uid: doc.id,
      username: data.username || data.usernameNormalized,
      role: data.role,
      platformRole,
      workspaces,
      active: data.active,
    };
  }

  async createOrUpdateOperator(
    uid: string,
    username: string,
    accessCode: string,
    role: OperatorRole
  ): Promise<void> {
    const accessCodeHash = await hashAccessCode(accessCode);
    const now = new Date().toISOString();
    await this.operatorsCol.doc(uid).set(
      {
        uid,
        username,
        usernameNormalized: username.trim().toLowerCase(),
        accessCodeHash,
        role,
        active: true,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true }
    );
  }
}

export const authService = new AuthService();
