import { db } from '../../config/firebase';
import { NotFoundError, ConflictError, BadRequestError, ForbiddenError } from '../../lib/errors';
import { CreateActivityInput, UpdateActivityInput, ActivityQuery } from './activities.schema';
import { getClock } from '../../lib/clock';
import { leaderboardService } from '../leaderboard/leaderboard.service';
import { AuthOperator } from '../../middleware/auth.middleware';

export interface ActivityDocument extends CreateActivityInput {
  id: string;
  workspaceId: string;
  status: 'draft' | 'published' | 'closed' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export class ActivitiesService {
  private col = db.collection('activities');
  private questionsCol = db.collection('questions');
  private choicesCol = db.collection('choices');
  private attemptsCol = db.collection('attempts');
  private phasesCol = db.collection('activityGroupPhases');

  async assertUniqueSlug(slug: string, excludeId?: string): Promise<void> {
    const snap = await this.col.where('slug', '==', slug).limit(1).get();
    if (!snap.empty && snap.docs[0].id !== excludeId) {
      throw new ConflictError(`Activity with slug '${slug}' already exists`);
    }
  }

  isEffectiveClosed(activity: ActivityDocument): boolean {
    if (activity.status === 'closed' || activity.status === 'archived') {
      return true;
    }
    const now = getClock().now().getTime();
    const closesAtMs = new Date(activity.closesAt).getTime();
    const graceMs = (activity.settings?.finishGraceSeconds ?? 120) * 1000;
    return now > closesAtMs + graceMs;
  }

  async create(input: CreateActivityInput, createdBy: string): Promise<ActivityDocument> {
    const workspaceId = input.workspaceId || 'internal';
    const wsDoc = await db.collection('workspaces').doc(workspaceId).get();
    if (!wsDoc.exists) {
      if (workspaceId === 'internal') {
        const now = getClock().nowIso();
        await db.collection('workspaces').doc('internal').set({
          id: 'internal',
          name: 'Internal',
          slug: 'internal',
          status: 'active',
          createdBy: 'system',
          createdAt: now,
          updatedAt: now,
        });
      } else {
        throw new NotFoundError(`Workspace '${workspaceId}' not found`, 'WORKSPACE_NOT_FOUND');
      }
    } else if (wsDoc.data()?.status !== 'active') {
      throw new BadRequestError('Cannot create activity in archived workspace', 'WORKSPACE_ARCHIVED');
    }

    await this.assertUniqueSlug(input.slug);

    if (input.phase === 'pre' || input.phase === 'post') {
      if (!input.groupId) {
        throw new BadRequestError('Linked pre/post activities require a groupId', 'GROUP_ID_REQUIRED');
      }
    }
    if (input.groupId && (!input.phase || input.phase === 'standalone')) {
      throw new BadRequestError('Group activity requires pre or post phase', 'PHASE_REQUIRED');
    }

    if (input.groupId) {
      const existingGroupSnap = await this.col.where('groupId', '==', input.groupId).get();
      for (const doc of existingGroupSnap.docs) {
        const data = doc.data();
        const docWs = data.workspaceId || 'internal';
        if (docWs !== workspaceId) {
          throw new BadRequestError(
            `Group '${input.groupId}' already belongs to workspace '${docWs}'. Cross-workspace grouping is not allowed.`,
            'CROSS_WORKSPACE_GROUP'
          );
        }
      }
    }

    const now = getClock().nowIso();
    const docRef = this.col.doc();

    const activity: ActivityDocument = {
      ...input,
      workspaceId,
      id: docRef.id,
      status: 'draft',
      createdBy,
      createdAt: now,
      updatedAt: now,
    };

    if (input.groupId && (input.phase === 'pre' || input.phase === 'post')) {
      const resRef = this.phasesCol.doc(`${workspaceId}_${input.groupId}_${input.phase}`);
      await db.runTransaction(async (t) => {
        const existingRes = await t.get(resRef);
        if (existingRes.exists && existingRes.data()?.activityId !== docRef.id) {
          throw new ConflictError(
            `A '${input.phase}' activity already exists for group '${input.groupId}'`,
            'DUPLICATE_GROUP_PHASE'
          );
        }
        t.set(resRef, {
          workspaceId,
          groupId: input.groupId,
          phase: input.phase,
          activityId: docRef.id,
          createdAt: now,
        });
        t.set(docRef, activity);
      });
      return activity;
    }

    await docRef.set(activity);
    return activity;
  }

  async list(
    filter: ActivityQuery,
    operator?: AuthOperator,
    limit = 50,
    cursor?: string
  ): Promise<{ items: ActivityDocument[]; meta: { limit: number; nextCursor: string | null } }> {
    const pageLimit = Math.min(200, Math.max(1, limit));
    let query: FirebaseFirestore.Query = this.col;

    if (filter.status) {
      query = query.where('status', '==', filter.status);
    }
    if (filter.mode) query = query.where('mode', '==', filter.mode);
    if (filter.groupId) query = query.where('groupId', '==', filter.groupId);

    // Enforce workspace access permissions if caller is not platform_owner
    let allowedWorkspaceIds: string[] | null = null;
    if (operator && operator.platformRole !== 'platform_owner') {
      if (filter.workspaceId) {
        const memDoc = await db.collection('memberships').doc(`${filter.workspaceId}_${operator.uid}`).get();
        if (!memDoc.exists || !memDoc.data()?.active) {
          if (filter.workspaceId === 'internal' && operator.role) {
            allowedWorkspaceIds = ['internal'];
          } else {
            throw new ForbiddenError('Not authorized for this workspace', 'UNAUTHORIZED_WORKSPACE');
          }
        } else {
          allowedWorkspaceIds = [filter.workspaceId];
        }
      } else {
        const memSnap = await db.collection('memberships')
          .where('uid', '==', operator.uid)
          .where('active', '==', true)
          .get();
        allowedWorkspaceIds = memSnap.docs.map((d) => d.data().workspaceId as string);
        if (operator.role && !allowedWorkspaceIds.includes('internal')) {
          allowedWorkspaceIds.push('internal');
        }
      }
    } else if (filter.workspaceId) {
      allowedWorkspaceIds = [filter.workspaceId];
    }

    query = query.orderBy('createdAt', 'desc').limit(pageLimit + 100);

    if (cursor) {
      const cursorDoc = await this.col.doc(cursor).get();
      if (cursorDoc.exists) {
        query = query.startAfter(cursorDoc);
      }
    }

    const snap = await query.get();
    let docs = snap.docs;

    if (!filter.status) {
      docs = docs.filter((d) => d.data().status !== 'archived');
    }

    if (allowedWorkspaceIds !== null) {
      docs = docs.filter((d) => allowedWorkspaceIds!.includes(d.data().workspaceId || 'internal'));
    }

    const hasMore = docs.length > pageLimit;
    const finalDocs = hasMore ? docs.slice(0, pageLimit) : docs;
    const nextCursor = hasMore ? finalDocs[finalDocs.length - 1].id : null;

    const items = finalDocs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        workspaceId: data.workspaceId || 'internal',
        ...data,
      } as ActivityDocument;
    });

    return { items, meta: { limit: pageLimit, nextCursor } };
  }

  async getById(id: string): Promise<ActivityDocument> {
    const doc = await this.col.doc(id).get();
    if (!doc.exists) {
      throw new NotFoundError(`Activity with id '${id}' not found`);
    }
    const data = doc.data()!;
    return {
      id: doc.id,
      workspaceId: data.workspaceId || 'internal',
      ...data,
    } as ActivityDocument;
  }

  async getBySlug(slug: string): Promise<ActivityDocument> {
    const snap = await this.col.where('slug', '==', slug).limit(1).get();
    if (snap.empty) {
      throw new NotFoundError(`Activity with slug '${slug}' not found`);
    }
    const doc = snap.docs[0];
    const data = doc.data();
    return {
      id: doc.id,
      workspaceId: data.workspaceId || 'internal',
      ...data,
    } as ActivityDocument;
  }

  async update(id: string, input: UpdateActivityInput): Promise<ActivityDocument> {
    const current = await this.getById(id);
    const currentWs = current.workspaceId || 'internal';

    if (input.workspaceId && input.workspaceId !== currentWs) {
      throw new ConflictError('Cannot move activity between workspaces', 'IMMUTABLE_WORKSPACE');
    }

    const attemptsSnap = await this.attemptsCol.where('activityId', '==', id).limit(1).get();
    const hasAttempts = !attemptsSnap.empty;
    const isLocked = current.status === 'published' || hasAttempts;

    if (isLocked) {
      if (input.slug && input.slug !== current.slug) {
        throw new ConflictError('Cannot change slug of published activity or activity with attempts', 'IMMUTABLE_FIELD');
      }
      if (input.mode && input.mode !== current.mode) {
        throw new ConflictError('Cannot change mode of published activity or activity with attempts', 'IMMUTABLE_FIELD');
      }
      if (input.groupId && input.groupId !== current.groupId) {
        throw new ConflictError('Cannot change groupId of published activity or activity with attempts', 'IMMUTABLE_FIELD');
      }
      if (current.phase === 'pre' || current.phase === 'post') {
        const codeField = input.participantFields?.find((f) => f.key === 'participantCode');
        if (codeField && !codeField.required) {
          throw new ConflictError(
            'Cannot make participantCode optional for published pre/post activity',
            'IMMUTABLE_FIELD'
          );
        }
      }
    }

    if (input.slug && input.slug !== current.slug) {
      await this.assertUniqueSlug(input.slug, id);
    }

    const opens = input.opensAt || current.opensAt;
    const closes = input.closesAt || current.closesAt;
    if (new Date(opens).getTime() >= new Date(closes).getTime()) {
      throw new BadRequestError('opensAt must be earlier than closesAt');
    }

    const updatedAt = getClock().nowIso();
    const newPhase = input.phase !== undefined ? input.phase : current.phase;
    const newGroupId = input.groupId !== undefined ? input.groupId : current.groupId;

    if (newPhase === 'pre' || newPhase === 'post') {
      if (!newGroupId) {
        throw new BadRequestError('Linked pre/post activities require a groupId', 'GROUP_ID_REQUIRED');
      }
    }

    if (newGroupId && newGroupId !== current.groupId) {
      const existingGroupSnap = await this.col.where('groupId', '==', newGroupId).get();
      for (const doc of existingGroupSnap.docs) {
        if (doc.id !== id) {
          const docWs = doc.data().workspaceId || 'internal';
          if (docWs !== currentWs) {
            throw new BadRequestError(
              `Group '${newGroupId}' already belongs to workspace '${docWs}'. Cross-workspace grouping is not allowed.`,
              'CROSS_WORKSPACE_GROUP'
            );
          }
        }
      }
    }

    const phaseChanged = newPhase !== current.phase || newGroupId !== current.groupId;
    if (phaseChanged) {
      const oldResRef = current.groupId && (current.phase === 'pre' || current.phase === 'post')
        ? this.phasesCol.doc(`${currentWs}_${current.groupId}_${current.phase}`)
        : null;
      const newResRef = newGroupId && (newPhase === 'pre' || newPhase === 'post')
        ? this.phasesCol.doc(`${currentWs}_${newGroupId}_${newPhase}`)
        : null;

      await db.runTransaction(async (t) => {
        if (newResRef) {
          const existingRes = await t.get(newResRef);
          if (existingRes.exists && existingRes.data()?.activityId !== id) {
            throw new ConflictError(
              `A '${newPhase}' activity already exists for group '${newGroupId}'`,
              'DUPLICATE_GROUP_PHASE'
            );
          }
          t.set(newResRef, {
            workspaceId: currentWs,
            groupId: newGroupId,
            phase: newPhase,
            activityId: id,
            updatedAt,
          });
        }
        if (oldResRef && (!newResRef || oldResRef.id !== newResRef.id)) {
          t.delete(oldResRef);
        }
        t.update(this.col.doc(id), { ...input, updatedAt });
      });
      return this.getById(id);
    }

    await this.col.doc(id).update({ ...input, updatedAt });
    return this.getById(id);
  }

  async delete(id: string): Promise<void> {
    const activity = await this.getById(id);
    const attemptsSnap = await this.attemptsCol.where('activityId', '==', id).limit(1).get();

    if (activity.status !== 'draft' || !attemptsSnap.empty) {
      throw new ConflictError('Cannot delete activity with data or non-draft status. Please archive instead.', 'ACTIVITY_HAS_DATA');
    }

    const qSnap = await this.questionsCol.where('activityId', '==', id).get();
    const batch = db.batch();
    for (const qDoc of qSnap.docs) {
      const cSnap = await this.choicesCol.where('questionId', '==', qDoc.id).get();
      cSnap.docs.forEach((c) => batch.delete(c.ref));
      batch.delete(qDoc.ref);
    }
    const currentWs = activity.workspaceId || 'internal';
    if (activity.groupId && (activity.phase === 'pre' || activity.phase === 'post')) {
      const resRef = this.phasesCol.doc(`${currentWs}_${activity.groupId}_${activity.phase}`);
      batch.delete(resRef);
    }
    batch.delete(this.col.doc(id));
    await batch.commit();
  }

  async publish(id: string): Promise<ActivityDocument> {
    const activity = await this.getById(id);
    const qSnap = await this.questionsCol.where('activityId', '==', id).get();
    if (qSnap.empty) {
      throw new BadRequestError('Cannot publish an activity without questions');
    }

    for (const qDoc of qSnap.docs) {
      const cSnap = await this.choicesCol.where('questionId', '==', qDoc.id).where('isCorrect', '==', true).limit(1).get();
      if (cSnap.empty) {
        throw new BadRequestError(`Question '${qDoc.id}' has no correct choice`);
      }
    }

    const now = getClock().now().getTime();
    if (new Date(activity.closesAt).getTime() <= now) {
      throw new BadRequestError('Cannot publish an activity whose closing time has already passed');
    }

    const publishedAt = getClock().nowIso();
    const currentWs = activity.workspaceId || 'internal';
    if (activity.phase === 'pre' || activity.phase === 'post') {
      if (!activity.groupId) {
        throw new BadRequestError('Linked pre/post activities require a groupId', 'GROUP_ID_REQUIRED');
      }
      const codeField = (activity.participantFields || []).find((f: any) => f.key === 'participantCode');
      const requiresCode = codeField?.required === true;
      if (!requiresCode) {
        throw new BadRequestError(
          'Participant code is required for linked pre/post activities',
          'PARTICIPANT_CODE_REQUIRED_FOR_LINKED_ACTIVITY'
        );
      }
      const resRef = this.phasesCol.doc(`${currentWs}_${activity.groupId}_${activity.phase}`);
      await db.runTransaction(async (t) => {
        const existingRes = await t.get(resRef);
        if (existingRes.exists && existingRes.data()?.activityId !== activity.id) {
          throw new ConflictError(
            `A '${activity.phase}' activity already exists for group '${activity.groupId}'`,
            'DUPLICATE_GROUP_PHASE'
          );
        }
        t.set(resRef, {
          workspaceId: currentWs,
          groupId: activity.groupId,
          phase: activity.phase,
          activityId: activity.id,
          publishedAt,
        });
        t.update(this.col.doc(id), { status: 'published', updatedAt: publishedAt });
      });
    } else {
      await this.col.doc(id).update({ status: 'published', updatedAt: publishedAt });
    }

    // Initialize leaderboard meta document
    await db.collection('leaderboardSnapshots').doc(id).set(
      {
        activityId: id,
        slug: activity.slug,
        state: 'live',
        status: 'published',
        visibleToParticipants: !activity.settings?.hideLeaderboardFromParticipants,
        updatedAt: publishedAt,
        participantCount: 0,
      },
      { merge: true }
    );

    return this.getById(id);
  }

  async close(id: string): Promise<ActivityDocument> {
    const activity = await this.getById(id);
    if (activity.status !== 'published') {
      throw new BadRequestError('Only published activities can be closed');
    }
    const updatedAt = getClock().nowIso();
    await this.col.doc(id).update({ status: 'closed', updatedAt });
    await leaderboardService.finalizeActivity(id);
    return this.getById(id);
  }

  async archive(id: string): Promise<ActivityDocument> {
    const activity = await this.getById(id);
    if (activity.status !== 'closed') {
      throw new BadRequestError('Only closed activities can be archived');
    }
    const updatedAt = getClock().nowIso();
    await this.col.doc(id).update({ status: 'archived', updatedAt });
    return this.getById(id);
  }
}

export const activitiesService = new ActivitiesService();
