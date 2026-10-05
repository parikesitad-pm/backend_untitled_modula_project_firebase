import { db } from '../../config/firebase';
import { ForbiddenError } from '../../lib/errors';
import { activitiesService } from '../activities/activities.service';
import { AuthOperator } from '../../middleware/auth.middleware';
import { LeaderboardResponse, LeaderboardEntry } from './leaderboard.schema';
import { compareLeaderboardEntries, LeaderboardRankable, calculateFinalScore } from '../../lib/scoring';
import { getClock } from '../../lib/clock';

export interface LeaderboardEntryDocument extends LeaderboardRankable {
  attemptId: string;
  displayName: string;
  status: 'in_progress' | 'completed';
  locked: boolean;
  leaderboardPoints: number;
  scorePercent: number;
  finalScore?: number;
  answeredCount: number;
  totalQuestions: number;
  durationMs: number;
  lastAnswerAt: string | null;
  completedAt: string | null;
  rankTimeAt: string;
}

export interface LeaderboardMetaDocument {
  activityId: string;
  slug: string;
  state: 'live' | 'final';
  status: 'draft' | 'published' | 'closed' | 'archived';
  visibleToParticipants: boolean;
  updatedAt: string;
  participantCount: number;
}

export class LeaderboardService {
  private attemptsCol = db.collection('attempts');
  private answersCol = db.collection('answers');
  private snapshotsCol = db.collection('leaderboardSnapshots');
  private attemptSnapshotsCol = db.collection('attemptSnapshots');

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
    const isVisible = !activity.settings?.hideLeaderboardFromParticipants;

    if (metaDoc.exists) {
      await metaRef.update({
        state: 'final',
        status: activity.status === 'archived' ? 'archived' : 'closed',
        visibleToParticipants: isVisible,
        updatedAt: now,
      });
    } else {
      await metaRef.set({
        activityId,
        slug: activity.slug,
        state: 'final',
        status: activity.status === 'archived' ? 'archived' : 'closed',
        visibleToParticipants: isVisible,
        updatedAt: now,
        participantCount: 0,
      });
    }
  }

  async rebuildLeaderboardSnapshot(activityId: string): Promise<LeaderboardResponse> {
    const activity = await activitiesService.getById(activityId);
    if (activitiesService.isEffectiveClosed(activity)) {
      await this.finalizeActivity(activityId);
    }

    const attemptsSnap = await this.attemptsCol
      .where('activityId', '==', activityId)
      .get();

    // Eligible for ranking: in_progress or completed (never expired or abandoned)
    const eligibleAttempts = attemptsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as any))
      .filter((a) => a.status === 'completed' || a.status === 'in_progress');

    // Clear existing entries in subcollection
    const existingEntriesSnap = await this.getEntriesCol(activityId).get();
    const clearBatch = db.batch();
    existingEntriesSnap.docs.forEach((d) => clearBatch.delete(d.ref));
    await clearBatch.commit();

    const writeBatch = db.batch();
    const now = getClock().nowIso();

    interface CandidateEntry {
      att: any;
      entryDoc: LeaderboardEntryDocument;
      rankable: LeaderboardRankable;
    }
    const candidates: CandidateEntry[] = [];

    // Reconstruct entries from raw attempts and answers
    for (const att of eligibleAttempts) {
      const snapDoc = await this.attemptSnapshotsCol.doc(att.id).get();
      let totalQuestions = 0;
      let totalAvailableWeight = 0;

      if (snapDoc.exists) {
        const questions = snapDoc.data()?.questions || [];
        totalQuestions = questions.length;
        totalAvailableWeight = questions.reduce((sum: number, q: any) => sum + (q.weight > 0 ? q.weight : 1), 0);
      } else if (att.questionSnapshots) {
        totalQuestions = att.questionSnapshots.length;
        totalAvailableWeight = att.questionSnapshots.reduce((sum: number, q: any) => sum + (q.weight > 0 ? q.weight : 1), 0);
      }

      const answersSnap = await this.answersCol.where('attemptId', '==', att.id).get();
      let points = 0;
      let earnedWeight = 0;
      let durationMs = 0;
      let lastAnswerAt: string | null = null;

      answersSnap.docs.forEach((aDoc) => {
        const a = aDoc.data();
        points = Number((points + (Number(a.leaderboardPoints) || 0)).toFixed(2));
        earnedWeight += Number(a.earnedWeight) || 0;
        durationMs += Number(a.durationMs) || 0;
        if (a.serverReceivedAt) {
          if (!lastAnswerAt || new Date(a.serverReceivedAt).getTime() > new Date(lastAnswerAt).getTime()) {
            lastAnswerAt = a.serverReceivedAt;
          }
        }
      });

      const scorePercent = calculateFinalScore(earnedWeight, totalAvailableWeight || 1);
      const isCompleted = att.status === 'completed';
      const completedAt = isCompleted ? (att.completedAt || now) : null;
      const rankTimeAt = (isCompleted ? completedAt : (lastAnswerAt || att.startedAt || now)) as string;

      const entryDoc: LeaderboardEntryDocument = {
        attemptId: att.id,
        displayName: att.displayName || 'Anonymous',
        status: isCompleted ? 'completed' : 'in_progress',
        locked: isCompleted,
        leaderboardPoints: points,
        scorePercent,
        finalScore: scorePercent,
        answeredCount: answersSnap.size,
        totalQuestions,
        durationMs,
        lastAnswerAt: lastAnswerAt || rankTimeAt,
        completedAt,
        rankTimeAt,
      };

      const rankable: LeaderboardRankable = {
        attemptId: att.id,
        leaderboardPoints: points,
        scorePercent,
        durationMs,
        status: entryDoc.status,
        rankTimeAt,
      };

      candidates.push({ att, entryDoc, rankable });
    }

    // Best-attempt projection when participantCode is present
    const bestByParticipant = new Map<string, CandidateEntry>();
    const unkeyedEntries: CandidateEntry[] = [];

    for (const c of candidates) {
      const code = c.att.participantCode;
      if (code) {
        const existing = bestByParticipant.get(code);
        if (!existing || compareLeaderboardEntries(c.rankable, existing.rankable) < 0) {
          bestByParticipant.set(code, c);
        }
      } else {
        unkeyedEntries.push(c);
      }
    }

    const finalEntriesToWrite = [...bestByParticipant.values(), ...unkeyedEntries];
    for (const item of finalEntriesToWrite) {
      writeBatch.set(this.getEntriesCol(activityId).doc(item.att.id), item.entryDoc);
    }

    await writeBatch.commit();

    return this.getLeaderboard(activity.slug);
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

    const metaRef = this.snapshotsCol.doc(activity.id);
    const metaDoc = await metaRef.get();
    let state: 'live' | 'final' = activitiesService.isEffectiveClosed(activity) ? 'final' : 'live';

    if (metaDoc.exists) {
      const meta = metaDoc.data()!;
      if (meta.state) state = meta.state;
    } else {
      await metaRef.set({
        activityId: activity.id,
        slug: activity.slug,
        state,
        status: activity.status,
        visibleToParticipants: !activity.settings?.hideLeaderboardFromParticipants,
        updatedAt: getClock().nowIso(),
        participantCount: 0,
      });
    }

    const entriesSnap = await this.getEntriesCol(activity.id)
      .orderBy('leaderboardPoints', 'desc')
      .orderBy('scorePercent', 'desc')
      .orderBy('durationMs', 'asc')
      .orderBy('rankTimeAt', 'asc')
      .orderBy('attemptId', 'asc')
      .get();
    const entriesDocs = entriesSnap.docs.map((d) => d.data() as LeaderboardEntryDocument);

    entriesDocs.sort((a, b) => compareLeaderboardEntries(a, b));

    const rankedEntries: LeaderboardEntry[] = entriesDocs.map((doc, idx) => ({
      rank: idx + 1,
      attemptId: doc.attemptId,
      displayName: doc.displayName,
      status: doc.status,
      locked: doc.locked,
      leaderboardPoints: doc.leaderboardPoints,
      scorePercent: doc.scorePercent,
      finalScore: doc.scorePercent,
      answeredCount: doc.answeredCount,
      totalQuestions: doc.totalQuestions,
      durationMs: doc.durationMs,
      lastAnswerAt: doc.lastAnswerAt,
      completedAt: doc.completedAt,
      rankTimeAt: doc.rankTimeAt,
    }));

    const totalCompleted = rankedEntries.filter((e) => e.status === 'completed').length;
    let finalEntries = rankedEntries;
    if (limit && limit > 0) {
      finalEntries = rankedEntries.slice(0, limit);
    }

    return {
      activityId: activity.id,
      activityTitle: activity.title,
      slug: activity.slug,
      state,
      top5: finalEntries.slice(0, 5),
      others: finalEntries.slice(5),
      entries: finalEntries,
      totalCompleted,
      totalEntries: rankedEntries.length,
      updatedAt: metaDoc.exists ? metaDoc.data()!.updatedAt || getClock().nowIso() : getClock().nowIso(),
    };
  }
}

export const leaderboardService = new LeaderboardService();
