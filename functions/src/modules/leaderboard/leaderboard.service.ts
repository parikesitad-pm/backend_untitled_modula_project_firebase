import { db } from '../../config/firebase';
import { ForbiddenError } from '../../lib/errors';
import { activitiesService } from '../activities/activities.service';
import { participantsService } from '../participants/participants.service';
import { AuthOperator } from '../../middleware/auth.middleware';
import { LeaderboardResponse, LeaderboardEntry } from './leaderboard.schema';
import { compareLeaderboardEntries } from '../../lib/scoring';
import { getClock } from '../../lib/clock';

export class LeaderboardService {
  private attemptsCol = db.collection('attempts');
  private snapshotsCol = db.collection('leaderboardSnapshots');

  async rebuildLeaderboardSnapshot(activityId: string): Promise<LeaderboardResponse> {
    const activity = await activitiesService.getById(activityId);

    const attemptsSnap = await this.attemptsCol
      .where('activityId', '==', activityId)
      .where('status', '==', 'completed')
      .get();

    const attempts = attemptsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
    attempts.sort(compareLeaderboardEntries);

    const entries: LeaderboardEntry[] = [];
    for (let i = 0; i < attempts.length; i++) {
      const att = attempts[i];
      let displayName = 'Anonymous';
      try {
        const p = await participantsService.getById(att.participantId);
        displayName = p.name;
      } catch (_e) {
        // fallback
      }

      entries.push({
        rank: i + 1,
        displayName,
        finalScore: att.finalScore,
        leaderboardPoints: att.leaderboardPoints,
        durationMs: att.durationMs,
        completedAt: att.completedAt,
      });
    }

    const response: LeaderboardResponse = {
      activityId: activity.id,
      activityTitle: activity.title,
      slug: activity.slug,
      top5: entries.slice(0, 5),
      others: entries.slice(5),
      totalCompleted: entries.length,
      updatedAt: getClock().nowIso(),
    };

    await this.snapshotsCol.doc(activity.id).set({
      ...response,
      status: activity.status,
      hideLeaderboardFromParticipants: !!activity.settings?.hideLeaderboardFromParticipants,
    });
    return response;
  }

  async getLeaderboard(slug: string, operator?: AuthOperator, limit?: number): Promise<LeaderboardResponse> {
    const activity = await activitiesService.getBySlug(slug);

    if (activity.settings?.hideLeaderboardFromParticipants && !operator) {
      throw new ForbiddenError('Leaderboard is hidden by the organizer', 'LEADERBOARD_HIDDEN');
    }

    const snapshotDoc = await this.snapshotsCol.doc(activity.id).get();
    let response: LeaderboardResponse;

    if (snapshotDoc.exists) {
      const data = snapshotDoc.data()!;
      response = {
        activityId: data.activityId,
        activityTitle: data.activityTitle,
        slug: data.slug,
        top5: data.top5 || [],
        others: data.others || [],
        totalCompleted: data.totalCompleted || 0,
        updatedAt: data.updatedAt,
      };
    } else {
      response = await this.rebuildLeaderboardSnapshot(activity.id);
    }

    if (limit && limit > 0) {
      const allEntries = [...response.top5, ...response.others].slice(0, limit);
      return {
        ...response,
        top5: allEntries.slice(0, 5),
        others: allEntries.slice(5),
      };
    }

    return response;
  }
}

export const leaderboardService = new LeaderboardService();
