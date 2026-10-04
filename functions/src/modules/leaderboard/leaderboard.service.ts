import { db } from '../../config/firebase';
import { ForbiddenError } from '../../lib/errors';
import { activitiesService } from '../activities/activities.service';
import { participantsService } from '../participants/participants.service';
import { AuthOperator } from '../../middleware/auth.middleware';
import { LeaderboardResponse, LeaderboardEntry } from './leaderboard.schema';

export class LeaderboardService {
  private attemptsCol = db.collection('attempts');
  private snapshotsCol = db.collection('leaderboardSnapshots');

  async getLeaderboard(slug: string, operator?: AuthOperator): Promise<LeaderboardResponse> {
    const activity = await activitiesService.getBySlug(slug);

    if (activity.settings?.hideLeaderboardFromParticipants && !operator) {
      throw new ForbiddenError('Leaderboard is hidden by the organizer', 'LEADERBOARD_HIDDEN');
    }

    const attemptsSnap = await this.attemptsCol
      .where('activityId', '==', activity.id)
      .where('status', '==', 'completed')
      .get();

    const attempts = attemptsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));

    attempts.sort((a, b) => {
      if (b.leaderboardPoints !== a.leaderboardPoints) {
        return b.leaderboardPoints - a.leaderboardPoints;
      }
      if (a.durationMs !== b.durationMs) {
        return a.durationMs - b.durationMs;
      }
      return new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime();
    });

    const entries: LeaderboardEntry[] = [];
    for (let i = 0; i < attempts.length; i++) {
      const att = attempts[i];
      let pName = 'Anonymous';
      let pCode = '';
      let pDivision = null;

      try {
        const p = await participantsService.getById(att.participantId);
        pName = p.name;
        pCode = p.participantCode;
        pDivision = p.division || null;
      } catch (_e) {
        // fallback to placeholder if participant doc missing
      }

      entries.push({
        rank: i + 1,
        attemptId: att.id,
        participantId: att.participantId,
        participantName: pName,
        participantCode: pCode,
        division: pDivision,
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
      updatedAt: new Date().toISOString(),
    };

    // Update derived Firestore snapshot asynchronously
    await this.snapshotsCol.doc(activity.id).set(response);

    return response;
  }
}

export const leaderboardService = new LeaderboardService();
