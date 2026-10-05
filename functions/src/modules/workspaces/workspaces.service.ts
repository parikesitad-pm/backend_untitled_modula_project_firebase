import { db } from '../../config/firebase';
import { NotFoundError, ConflictError, BadRequestError, ForbiddenError } from '../../lib/errors';
import { getClock } from '../../lib/clock';
import { AuthOperator } from '../../middleware/auth.middleware';
import {
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  WorkspaceItem,
  CreateMembershipInput,
  UpdateMembershipInput,
  MembershipItem,
} from './workspaces.schema';

export class WorkspacesService {
  private col = db.collection('workspaces');
  private membershipsCol = db.collection('memberships');
  private operatorsCol = db.collection('operators');

  async assertUniqueSlug(slug: string, excludeId?: string): Promise<void> {
    const snap = await this.col.where('slug', '==', slug).limit(1).get();
    if (!snap.empty && snap.docs[0].id !== excludeId) {
      throw new ConflictError(`Workspace with slug '${slug}' already exists`);
    }
  }

  async list(operator: AuthOperator): Promise<WorkspaceItem[]> {
    if (operator.platformRole === 'platform_owner') {
      const snap = await this.col.get();
      return snap.docs.map((d) => ({ id: d.id, ...d.data() } as WorkspaceItem));
    }

    // Normal user: only workspaces where user has active membership
    const memSnap = await this.membershipsCol
      .where('uid', '==', operator.uid)
      .where('active', '==', true)
      .get();

    if (memSnap.empty) {
      return [];
    }

    const workspaceIds = memSnap.docs.map((d) => d.data().workspaceId as string);
    const results: WorkspaceItem[] = [];

    // Fetch workspaces by ID
    for (const wsId of workspaceIds) {
      const doc = await this.col.doc(wsId).get();
      if (doc.exists) {
        results.push({ id: doc.id, ...doc.data() } as WorkspaceItem);
      }
    }

    return results;
  }

  async create(input: CreateWorkspaceInput, creatorUid: string): Promise<WorkspaceItem> {
    const normalizedSlug = input.slug.trim().toLowerCase();
    await this.assertUniqueSlug(normalizedSlug);

    const now = getClock().nowIso();
    const docRef = this.col.doc(normalizedSlug);

    const workspace: WorkspaceItem = {
      id: docRef.id,
      name: input.name.trim(),
      slug: normalizedSlug,
      status: 'active',
      createdBy: creatorUid,
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(workspace);
    return workspace;
  }

  async getById(workspaceId: string, operator: AuthOperator): Promise<WorkspaceItem> {
    const doc = await this.col.doc(workspaceId).get();
    if (!doc.exists) {
      throw new NotFoundError(`Workspace with id '${workspaceId}' not found`);
    }

    const data = { id: doc.id, ...doc.data() } as WorkspaceItem;

    if (operator.platformRole !== 'platform_owner') {
      const memDoc = await this.membershipsCol.doc(`${workspaceId}_${operator.uid}`).get();
      if (!memDoc.exists || !memDoc.data()?.active) {
        throw new ForbiddenError('Not authorized for this workspace');
      }
    }

    return data;
  }

  async update(workspaceId: string, input: UpdateWorkspaceInput): Promise<WorkspaceItem> {
    const current = await this.col.doc(workspaceId).get();
    if (!current.exists) {
      throw new NotFoundError(`Workspace with id '${workspaceId}' not found`);
    }

    const updates: Partial<WorkspaceItem> = {
      updatedAt: getClock().nowIso(),
    };

    if (input.name) {
      updates.name = input.name.trim();
    }
    if (input.slug) {
      const normalizedSlug = input.slug.trim().toLowerCase();
      if (normalizedSlug !== current.data()?.slug) {
        await this.assertUniqueSlug(normalizedSlug, workspaceId);
        updates.slug = normalizedSlug;
      }
    }
    if (input.status) {
      updates.status = input.status;
    }

    await this.col.doc(workspaceId).update(updates);
    const updated = await this.col.doc(workspaceId).get();
    return { id: updated.id, ...updated.data() } as WorkspaceItem;
  }

  async archive(workspaceId: string): Promise<WorkspaceItem> {
    return this.update(workspaceId, { status: 'archived' });
  }

  // Membership Management (Platform Owner only)
  async listMembers(workspaceId: string): Promise<MembershipItem[]> {
    const wsDoc = await this.col.doc(workspaceId).get();
    if (!wsDoc.exists) {
      throw new NotFoundError(`Workspace with id '${workspaceId}' not found`);
    }

    const snap = await this.membershipsCol.where('workspaceId', '==', workspaceId).get();
    const members: MembershipItem[] = [];

    for (const doc of snap.docs) {
      const data = doc.data();
      let username: string | undefined;
      const opDoc = await this.operatorsCol.doc(data.uid).get();
      if (opDoc.exists) {
        username = opDoc.data()?.username;
      }

      members.push({
        id: doc.id,
        workspaceId: data.workspaceId,
        uid: data.uid,
        username,
        role: data.role,
        active: !!data.active,
        createdBy: data.createdBy,
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    }

    return members;
  }

  async addMember(
    workspaceId: string,
    input: CreateMembershipInput,
    creatorUid: string
  ): Promise<MembershipItem> {
    const wsDoc = await this.col.doc(workspaceId).get();
    if (!wsDoc.exists) {
      throw new NotFoundError(`Workspace with id '${workspaceId}' not found`);
    }

    const opDoc = await this.operatorsCol.doc(input.uid).get();
    if (!opDoc.exists) {
      throw new NotFoundError(`Operator '${input.uid}' not found`);
    }
    const opData = opDoc.data();
    if (!opData?.active) {
      throw new BadRequestError('Cannot add deactivated operator to workspace');
    }

    const membershipId = `${workspaceId}_${input.uid}`;
    const now = getClock().nowIso();
    const memRef = this.membershipsCol.doc(membershipId);

    const membership: MembershipItem = {
      id: membershipId,
      workspaceId,
      uid: input.uid,
      username: opData.username,
      role: input.role,
      active: true,
      createdBy: creatorUid,
      createdAt: now,
      updatedAt: now,
    };

    await memRef.set(membership);
    return membership;
  }

  async updateMember(
    workspaceId: string,
    uid: string,
    input: UpdateMembershipInput
  ): Promise<MembershipItem> {
    const membershipId = `${workspaceId}_${uid}`;
    const memRef = this.membershipsCol.doc(membershipId);
    const doc = await memRef.get();
    if (!doc.exists) {
      throw new NotFoundError(`Membership not found for user '${uid}' in workspace '${workspaceId}'`);
    }

    const updates: Record<string, any> = {
      updatedAt: getClock().nowIso(),
    };
    if (input.role) updates.role = input.role;
    if (input.active !== undefined) updates.active = input.active;

    await memRef.update(updates);
    const updated = await memRef.get();
    return { id: updated.id, ...updated.data() } as MembershipItem;
  }

  async removeMember(workspaceId: string, uid: string): Promise<void> {
    const membershipId = `${workspaceId}_${uid}`;
    const memRef = this.membershipsCol.doc(membershipId);
    const doc = await memRef.get();
    if (!doc.exists) {
      throw new NotFoundError(`Membership not found for user '${uid}' in workspace '${workspaceId}'`);
    }

    await memRef.delete();
  }
}

export const workspacesService = new WorkspacesService();

