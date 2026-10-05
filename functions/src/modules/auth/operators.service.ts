import { db, auth } from '../../config/firebase';
import { hashAccessCode } from '../../lib/hash';
import { ForbiddenError, NotFoundError, ConflictError } from '../../lib/errors';
import { AuthOperator, OperatorRole, PlatformRole, ROLE_HIERARCHY } from '../../middleware/auth.middleware';
import { CreateOperatorInput, UpdateOperatorInput, OperatorItem } from './operators.schema';

export class OperatorsService {
  private col = db.collection('operators');
  private membershipsCol = db.collection('memberships');
  private workspacesCol = db.collection('workspaces');

  async list(limit = 50, cursor?: string): Promise<{ items: OperatorItem[]; meta: { limit: number; nextCursor: string | null } }> {
    const pageLimit = Math.min(200, Math.max(1, limit));
    let query = this.col.orderBy('createdAt', 'desc').limit(pageLimit + 1);

    if (cursor) {
      const cursorDoc = await this.col.doc(cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snap = await query.get();
    const hasMore = snap.docs.length > pageLimit;
    const docs = hasMore ? snap.docs.slice(0, pageLimit) : snap.docs;
    const nextCursor = hasMore ? docs[docs.length - 1].id : null;

    const items: OperatorItem[] = docs.map((d) => {
      const data = d.data();
      let platformRole: PlatformRole = data.platformRole ?? null;
      if (platformRole === undefined || platformRole === null) {
        if (data.role === 'crown' || data.role === 'owner') {
          platformRole = 'platform_owner';
        }
      }

      return {
        uid: d.id,
        username: data.username || data.usernameNormalized,
        role: data.role as OperatorRole,
        platformRole,
        active: data.active ?? true,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      };
    });

    return { items, meta: { limit: pageLimit, nextCursor } };
  }

  async create(caller: AuthOperator, input: CreateOperatorInput): Promise<OperatorItem> {
    const role = input.role || 'operator';
    if (caller.role && caller.role !== 'crown' && ROLE_HIERARCHY[role] >= ROLE_HIERARCHY[caller.role]) {
      throw new ForbiddenError(`Cannot assign role '${role}' equal to or higher than your own role`);
    }

    const normalized = input.username.trim().toLowerCase();
    const existing = await this.col.where('usernameNormalized', '==', normalized).limit(1).get();
    if (!existing.empty) {
      throw new ConflictError(`Operator with username '${input.username}' already exists`);
    }

    const userRecord = await auth.createUser({
      email: `${normalized}@modula.local`,
      displayName: input.username,
    });

    const uid = userRecord.uid;
    const accessCodeHash = await hashAccessCode(input.accessCode);
    const now = new Date().toISOString();

    let platformRole: PlatformRole = input.platformRole ?? null;
    if (platformRole === undefined || platformRole === null) {
      if (role === 'crown' || role === 'owner') {
        platformRole = 'platform_owner';
      }
    }

    const record = {
      uid,
      username: input.username,
      usernameNormalized: normalized,
      accessCodeHash,
      role,
      platformRole,
      active: true,
      createdAt: now,
      updatedAt: now,
    };

    await this.col.doc(uid).set(record);
    await auth.setCustomUserClaims(uid, { role });

    // Handle optional initial memberships
    if (input.memberships && input.memberships.length > 0) {
      for (const m of input.memberships) {
        const wsDoc = await this.workspacesCol.doc(m.workspaceId).get();
        if (wsDoc.exists) {
          const memId = `${m.workspaceId}_${uid}`;
          await this.membershipsCol.doc(memId).set({
            id: memId,
            workspaceId: m.workspaceId,
            uid,
            role: m.role,
            active: true,
            createdBy: caller.uid,
            createdAt: now,
            updatedAt: now,
          });
        }
      }
    }

    return {
      uid,
      username: input.username,
      role,
      platformRole,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  private async assertNotLastOwner(targetDoc: FirebaseFirestore.DocumentSnapshot): Promise<void> {
    const data = targetDoc.data();
    if (!data?.active) return;

    if (data.role === 'owner' || data.role === 'crown') {
      const activeSameRole = await this.col
        .where('active', '==', true)
        .where('role', '==', data.role)
        .get();
      if (activeSameRole.size <= 1) {
        throw new ConflictError(`Cannot deactivate or demote the last active ${data.role}`, 'LAST_OWNER_PROTECTION');
      }
    }

    const isPlatformOwner =
      data.platformRole === 'platform_owner' || data.role === 'owner' || data.role === 'crown';

    if (isPlatformOwner) {
      const snap = await this.col.where('active', '==', true).get();
      const activeOwners = snap.docs.filter((d) => {
        const dData = d.data();
        return dData.platformRole === 'platform_owner' || dData.role === 'owner' || dData.role === 'crown';
      });
      if (activeOwners.length <= 1) {
        throw new ConflictError('Cannot deactivate or demote the last active platform_owner', 'LAST_OWNER_PROTECTION');
      }
    }
  }

  async update(caller: AuthOperator, targetUid: string, input: UpdateOperatorInput): Promise<OperatorItem> {
    const docRef = this.col.doc(targetUid);
    const doc = await docRef.get();
    if (!doc.exists) throw new NotFoundError('Operator not found');

    if (caller.uid === targetUid && input.role && input.role !== caller.role) {
      throw new ForbiddenError('Cannot change your own role');
    }

    if (input.role && caller.role && caller.role !== 'crown' && ROLE_HIERARCHY[input.role] >= ROLE_HIERARCHY[caller.role]) {
      throw new ForbiddenError(`Cannot assign role '${input.role}' equal to or higher than your own role`);
    }

    const demoting =
      (input.role && !['owner', 'crown'].includes(input.role)) ||
      (input.platformRole === null);

    if (input.active === false || demoting) {
      await this.assertNotLastOwner(doc);
    }

    const updates: Record<string, any> = { updatedAt: new Date().toISOString() };
    if (input.role !== undefined) updates.role = input.role;
    if (input.platformRole !== undefined) updates.platformRole = input.platformRole;
    if (input.active !== undefined) updates.active = input.active;
    if (input.accessCode) updates.accessCodeHash = await hashAccessCode(input.accessCode);

    await docRef.update(updates);

    if (input.role) await auth.setCustomUserClaims(targetUid, { role: input.role });
    if (input.role || input.active !== undefined) {
      try {
        await auth.revokeRefreshTokens(targetUid);
      } catch (_e) {
        // ignore
      }
    }

    const updated = (await docRef.get()).data()!;
    let platformRole: PlatformRole = updated.platformRole ?? null;
    if (platformRole === undefined || platformRole === null) {
      if (updated.role === 'crown' || updated.role === 'owner') {
        platformRole = 'platform_owner';
      }
    }

    return {
      uid: targetUid,
      username: updated.username || updated.usernameNormalized,
      role: updated.role,
      platformRole,
      active: updated.active,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  }
}

export const operatorsService = new OperatorsService();
