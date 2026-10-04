import { db, auth } from '../../config/firebase';
import { verifyAccessCode, hashAccessCode } from '../../lib/hash';
import { UnauthorizedError, NotFoundError } from '../../lib/errors';
import { LoginRequest, LoginResponse, OperatorResponse } from './auth.schema';
import { OperatorRole } from '../../middleware/auth.middleware';

export class AuthService {
  private operatorsCol = db.collection('operators');

  async login(input: LoginRequest): Promise<LoginResponse> {
    const normalized = input.username.trim().toLowerCase();
    const snapshot = await this.operatorsCol
      .where('usernameNormalized', '==', normalized)
      .limit(1)
      .get();

    if (snapshot.empty) {
      throw new UnauthorizedError('Invalid username or access code');
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    if (!data.active) {
      throw new UnauthorizedError('Operator account is deactivated');
    }

    const valid = await verifyAccessCode(input.accessCode, data.accessCodeHash);
    if (!valid) {
      throw new UnauthorizedError('Invalid username or access code');
    }

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
    const token = await auth.createCustomToken(uid, { role });

    return {
      token,
      operator: {
        uid,
        username: data.username || normalized,
        role,
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
    return {
      uid: doc.id,
      username: data.username || data.usernameNormalized,
      role: data.role,
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
