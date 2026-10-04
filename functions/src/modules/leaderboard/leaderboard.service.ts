import { db } from '../../config/firebase';
import { ForbiddenError } from '../../lib/errors';
import { activitiesService, ActivityDocument } from '../activities/activities.service';
import { participantsService } from '../participants/participants.service';
import { AuthOperator } from '../../middleware/auth.middleware';
import { LeaderboardResponse, LeaderboardEntry } from './leaderboard.schema';
import { compareLeaderboardEntries, LeaderboardRankable } from '../../lib/scoring';
import { getClock } from '../../lib/clock';

export interface LeaderboardEntryDocument extends LeaderboardRankable {
  attemptId: string;
  participantId: string;
  participantCode: string | null;
  displayName: string;
  status: 'in_progress' | 'completed';
  locked: boolean;
  leaderboardPoints: number;
  scorePercent: number;
  finalScore: number;
  answeredCount: number;
  totalQuestions: number;
  durationMs: number;
  rankTimeAt: string;
  lastAnswerAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export class LeaderboardService {
  private attemptsCol = db.collection('attempts');
  private snapshotsCol = db.collection('leaderboardSnapshots');

  getEntriesCol(activityId: string) {
    return this.snapshotsCol.doc(activityId).collection('entries');
  }

  async finalizeActivity(activityId: string): Promise<void> {
    const activity = await activitiesService.getById(activityId);
    if (!activitiesService.isEffectiveClosed(activity)) {
      return;
    }

    const inProgressSnap = await this.attemptsCol
      .where('activityId', '==', activityId)
      .where('status', '==', 'in_progress')
      .get();

    const now = getClock().nowIso();
    const batch = db.batch();

    for (const doc of inProgressSnap.docs) {
      batch.update(doc.ref, {
        status: 'expired',
        updatedAt: now,
      });
      // Exclude expired attempt from ranked leaderboard entries
      const entryRef = this.getEntriesCol(activityId).doc(doc.id);
      batch.delete(entryRef);
    }

    await batch.commit();

    const metaRef = this.snapshotsCol.doc(activityId);
    const metaDoc = await metaRef.get();
    if (metaDoc.exists) {
      await metaRef.update({
        state: 'final',
        status: activity.status === 'archived' ? 'archived' : 'closed',
        updatedAt: now,
      });
    } else {
      await metaRef.set({
        activityId,
        activityTitle: activity.title,
        slug: activity.slug,
        state: 'final',
        status: activity.status === 'archived' ? 'archived' : 'closed',
        visibleToParticipants: !activity.settings?.hideLeaderboardFromParticipants,
        hideLeaderboardFromParticipants: !!activity.settings?.hideLeaderboardFromParticipants,
        updatedAt: now,
      });
    }
  }

  async recordEntry(
    activityId: string,
    entry: Omit<LeaderboardEntryDocument, 'updatedAt'>
  ): Promise<void> {
    const activity = await activitiesService.getById(activityId);
    const now = getClock().nowIso();
    const entryData: LeaderboardEntryDocument = {
      ...entry,
      updatedAt: now,
    };

    // Requirement L: Handle maxAttempts > 1 best-attempt projection
    if (entry.participantCode) {
      const existingEntriesSnap = await this.getEntriesCol(activityId)
        .where('participantCode', '==', entry.participantCode)
        .get();

      if (!existingEntriesSnap.empty) {
        const toDelete: FirebaseFirestore.DocumentReference[] = [];

        for (const existingDoc of existingEntriesSnap.docs) {
          if (existingDoc.id === entry.attemptId) {
            continue;
          }
          const existingData = existingDoc.data() as LeaderboardEntryDocument;
          const cmp = compareLeaderboardEntries(entryData, existingData);
          if (cmp < 0) {
            // New attempt is strictly better than existing
            toDelete.push(existingDoc.ref);
          } else {
            // Existing attempt is better or equal
            return;
          }
        }

        const batch = db.batch();
        toDelete.forEach((ref) => batch.delete(ref));
        batch.set(this.getEntriesCol(activityId).doc(entry.attemptId), entryData);
        await batch.commit();
        await this.touchMetaDoc(activity);
        return;
      }
    }

    await this.getEntriesCol(activityId).doc(entry.attemptId).set(entryData);
    await this.touchMetaDoc(activity);
  }

  private async touchMetaDoc(activity: ActivityDocument): Promise<void> {
    const isClosed = activitiesService.isEffectiveClosed(activity);
    const state = isClosed ? 'final' : 'live';
    const now = getClock().nowIso();

    await this.snapshotsCol.doc(activity.id).set(
      {
        activityId: activity.id,
        activityTitle: activity.title,
        slug: activity.slug,
        state,
        status: activity.status,
        visibleToParticipants: !activity.settings?.hideLeaderboardFromParticipants,
        hideLeaderboardFromParticipants: !!activity.settings?.hideLeaderboardFromParticipants,
        updatedAt: now,
      },
      { merge: true }
    );
  }

  async rebuildLeaderboardSnapshot(activityId: string): Promise<LeaderboardResponse> {
    const activity = await activitiesService.getById(activityId);
    const isClosed = activitiesService.isEffectiveClosed(activity);
    if (isClosed) {
      await this.finalizeActivity(activityId);
    }

    const attemptsSnap = await this.attemptsCol
      .where('activityId', '==', activityId)
      .get();

    // Filter eligible attempts: in_progress or completed (never expired or abandoned)
    const eligibleAttempts = attemptsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .filter((a) => a.status === 'completed' || a.status === 'in_progress');

    // Group by participantCode for best-attempt projection
    const attemptsByCode = new Map<string, any[]>();
    const unkeyedAttempts: any[] = [];

    for (const att of eligibleAttempts) {
      let participantCode: string | null = null;
      let displayName = 'Anonymous';
      try {
        const p = await participantsService.getById(att.participantId);
        displayName = p.name;
        participantCode = p.participantCode || null;
      } catch (_e) {
        // fallback
      }
      att._displayName = displayName;
      att._participantCode = participantCode;

      if (participantCode) {
        const list = attemptsByCode.get(participantCode) || [];
        list.push(att);
        attemptsByCode.set(participantCode, list);
      } else {
        unkeyedAttempts.push(att);
      }
    }

    const representativeAttempts: any[] = [...unkeyedAttempts];
    attemptsByCode.forEach((list) => {
      list.sort((a, b) => {
        const rA: LeaderboardRankable = {
          attemptId: a.id,
          leaderboardPoints: a.leaderboardPoints || 0,
          scorePercent: a.finalScore || 0,
          durationMs: a.durationMs || 0,
          rankTimeAt: a.status === 'completed' ? (a.completedAt || a.updatedAt) : (a.lastAnswerAt || a.startedAt),
        };
        const rB: LeaderboardRankable = {
          attemptId: b.id,
          leaderboardPoints: b.leaderboardPoints || 0,
          scorePercent: b.finalScore || 0,
          durationMs: b.durationMs || 0,
          rankTimeAt: b.status === 'completed' ? (b.completedAt || b.updatedAt) : (b.lastAnswerAt || b.startedAt),
        };
        return compareLeaderboardEntries(rA, rB);
      });
      representativeAttempts.push(list[0]);
    });

    representativeAttempts.sort((a, b) => {
      const rA: LeaderboardRankable = {
        attemptId: a.id,
        leaderboardPoints: a.leaderboardPoints || 0,
        scorePercent: a.finalScore || 0,
        durationMs: a.durationMs || 0,
        rankTimeAt: a.status === 'completed' ? (a.completedAt || a.updatedAt) : (a.lastAnswerAt || a.startedAt),
      };
      const rB: LeaderboardRankable = {
        attemptId: b.id,
        leaderboardPoints: b.leaderboardPoints || 0,
        scorePercent: b.finalScore || 0,
        durationMs: b.durationMs || 0,
        rankTimeAt: b.status === 'completed' ? (b.completedAt || b.updatedAt) : (b.lastAnswerAt || b.startedAt),
      };
      return compareLeaderboardEntries(rA, rB);
    });

    // Clear existing entries in subcollection
    const existingEntries = await this.getEntriesCol(activityId).get();
    const clearBatch = db.batch();
    existingEntries.docs.forEach((d) => clearBatch.delete(d.ref));
    await clearBatch.commit();

    const writeBatch = db.batch();
    const entries: LeaderboardEntry[] = [];
    const now = getClock().nowIso();

    for (let i = 0; i < representativeAttempts.length; i++) {
      const att = representativeAttempts[i];
      const rankTimeAt = att.status === 'completed' ? (att.completedAt || att.updatedAt || now) : (att.lastAnswerAt || att.startedAt || now);
      const entryDoc: LeaderboardEntryDocument = {
        attemptId: att.id,
        participantId: att.participantId,
        participantCode: att._participantCode || null,
        displayName: att._displayName || 'Anonymous',
        status: att.status,
        locked: att.status === 'completed',
        leaderboardPoints: att.leaderboardPoints || 0,
        scorePercent: att.finalScore || 0,
        finalScore: att.finalScore || 0,
        answeredCount: att.answeredCount || 0,
        totalQuestions: att.totalQuestions || 0,
        durationMs: att.durationMs || 0,
        rankTimeAt,
        lastAnswerAt: att.lastAnswerAt || null,
        completedAt: att.completedAt || null,
        updatedAt: now,
      };

      writeBatch.set(this.getEntriesCol(activityId).doc(att.id), entryDoc);
      entries.push({
        rank: i + 1,
        ...entryDoc,
      });
    }

    await writeBatch.commit();

    const state = isClosed ? 'final' : 'live';
    const totalCompleted = entries.filter((e) => e.status === 'completed').length;

    const response: LeaderboardResponse = {
      activityId: activity.id,
      activityTitle: activity.title,
      slug: activity.slug,
      state,
      top5: entries.slice(0, 5),
      others: entries.slice(5),
      totalCompleted,
      totalEntries: entries.length,
      updatedAt: now,
    };

    await this.snapshotsCol.doc(activity.id).set({
      ...response,
      status: activity.status,
      visibleToParticipants: !activity.settings?.hideLeaderboardFromParticipants,
      hideLeaderboardFromParticipants: !!activity.settings?.hideLeaderboardFromParticipants,
    });

    return response;
  }

  async getLeaderboard(
    slug: string,
    operator?: AuthOperator,
    limit?: number
  ): Promise<LeaderboardResponse> {
    const activity = await activitiesService.getBySlug(slug);

    if (activity.settings?.hideLeaderboardFromParticipants && !operator) {
      throw new ForbiddenError('Leaderboard is hidden by the organizer', 'LEADERBOARD_HIDDEN');
    }

    if (activitiesService.isEffectiveClosed(activity)) {
      await this.finalizeActivity(activity.id);
    }

    const metaDoc = await this.snapshotsCol.doc(activity.id).get();
    let state: 'live' | 'final' = activitiesService.isEffectiveClosed(activity) ? 'final' : 'live';

    if (metaDoc.exists) {
      const meta = metaDoc.data()!;
      if (meta.state) state = meta.state;
    }

    const entriesSnap = await this.getEntriesCol(activity.id).get();
    let entriesDocs = entriesSnap.docs.map((d) => d.data() as LeaderboardEntryDocument);

    if (entriesDocs.length === 0) {
      // Rebuild if no subcollection entries exist yet
      return this.rebuildLeaderboardSnapshot(activity.id);
    }

    entriesDocs.sort((a, b) => compareLeaderboardEntries(a, b));

    const entries: LeaderboardEntry[] = entriesDocs.map((doc, idx) => ({
      rank: idx + 1,
      attemptId: doc.attemptId,
      displayName: doc.displayName,
      status: doc.status,
      locked: doc.locked,
      leaderboardPoints: doc.leaderboardPoints,
      scorePercent: doc.scorePercent,
      finalScore: doc.finalScore ?? doc.scorePercent,
      answeredCount: doc.answeredCount,
      totalQuestions: doc.totalQuestions,
      durationMs: doc.durationMs,
      rankTimeAt: doc.rankTimeAt,
      lastAnswerAt: doc.lastAnswerAt,
      completedAt: doc.completedAt,
    }));

    const totalCompleted = entries.filter((e) => e.status === 'completed').length;
    let finalEntries = entries;
    if (limit && limit > 0) {
      finalEntries = entries.slice(0, limit);
    }

    return {
      activityId: activity.id,
      activityTitle: activity.title,
      slug: activity.slug,
      state,
      top5: finalEntries.slice(0, 5),
      others: finalEntries.slice(5),
      totalCompleted,
      totalEntries: entries.length,
      updatedAt: metaDoc.exists ? metaDoc.data()!.updatedAt || getClock().nowIso() : getClock().nowIso(),
    };
  }
}

export const leaderboardService = new LeaderboardService();
