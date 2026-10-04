import { db } from '../../config/firebase';
import { NotFoundError } from '../../lib/errors';
import { activitiesService } from '../activities/activities.service';
import { questionsService } from '../questions/questions.service';
import { ActivityStatsSummary, QuestionStat, PrePostComparison } from './stats.schema';

export class StatsService {
  private attemptsCol = db.collection('attempts');
  private answersCol = db.collection('answers');
  private participantsCol = db.collection('participants');
  private snapshotsCol = db.collection('statsSnapshots');

  async getActivityStats(activityId: string): Promise<ActivityStatsSummary> {
    await activitiesService.getById(activityId);

    const [participantsSnap, attemptsSnap] = await Promise.all([
      this.participantsCol.where('activityId', '==', activityId).get(),
      this.attemptsCol.where('activityId', '==', activityId).get(),
    ]);

    const totalParticipants = participantsSnap.size;
    const totalAttempts = attemptsSnap.size;
    const completedAttemptsList = attemptsSnap.docs
      .map((d) => d.data())
      .filter((a) => a.status === 'completed');

    const completedAttempts = completedAttemptsList.length;
    const incompleteAttempts = totalAttempts - completedAttempts;
    const completionRate = totalAttempts > 0 ? Number(((completedAttempts / totalAttempts) * 100).toFixed(2)) : 0;

    let totalScore = 0;
    let highest = 0;
    let lowest = completedAttempts > 0 ? 100 : 0;
    let totalDurationMs = 0;
    let fastestDurationMs = completedAttempts > 0 ? Infinity : 0;

    for (const a of completedAttemptsList) {
      const score = Number(a.finalScore || 0);
      const duration = Number(a.durationMs || 0);
      totalScore += score;
      if (score > highest) highest = score;
      if (score < lowest) lowest = score;
      totalDurationMs += duration;
      if (duration < fastestDurationMs) fastestDurationMs = duration;
    }

    const averageScore = completedAttempts > 0 ? Number((totalScore / completedAttempts).toFixed(2)) : 0;
    const averageDurationMs = completedAttempts > 0 ? Math.round(totalDurationMs / completedAttempts) : 0;
    const fastest = fastestDurationMs === Infinity ? 0 : fastestDurationMs;

    const summary: ActivityStatsSummary = {
      activityId,
      totalParticipants,
      totalAttempts,
      completedAttempts,
      incompleteAttempts,
      completionRate,
      scores: {
        average: averageScore,
        highest,
        lowest: completedAttempts > 0 ? lowest : 0,
      },
      timing: {
        averageDurationMs,
        fastestDurationMs: fastest,
      },
      updatedAt: new Date().toISOString(),
    };

    await this.snapshotsCol.doc(activityId).set(summary);
    return summary;
  }

  async getActivityParticipants(activityId: string): Promise<any[]> {
    await activitiesService.getById(activityId);

    const [pSnap, aSnap] = await Promise.all([
      this.participantsCol.where('activityId', '==', activityId).get(),
      this.attemptsCol.where('activityId', '==', activityId).get(),
    ]);

    const attemptsByParticipant = new Map<string, any[]>();
    aSnap.docs.forEach((doc) => {
      const d = { id: doc.id, ...doc.data() };
      const arr = attemptsByParticipant.get(doc.data().participantId) || [];
      arr.push(d);
      attemptsByParticipant.set(doc.data().participantId, arr);
    });

    return pSnap.docs.map((doc) => {
      const p = { id: doc.id, ...doc.data() };
      const attempts = attemptsByParticipant.get(doc.id) || [];
      const latestAttempt = attempts[attempts.length - 1];
      return {
        ...p,
        attemptsCount: attempts.length,
        latestScore: latestAttempt ? latestAttempt.finalScore : null,
        latestStatus: latestAttempt ? latestAttempt.status : null,
        attempts,
      };
    });
  }

  async getActivityResponses(activityId: string): Promise<any[]> {
    await activitiesService.getById(activityId);
    const snap = await this.answersCol.where('activityId', '==', activityId).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }

  async getQuestionStats(activityId: string): Promise<QuestionStat[]> {
    const questions = await questionsService.getByActivityId(activityId, false);
    const answersSnap = await this.answersCol.where('activityId', '==', activityId).get();
    const answers = answersSnap.docs.map((d) => d.data());

    return questions.map((q) => {
      const qAnswers = answers.filter((a) => a.questionId === q.id);
      const totalAnswers = qAnswers.length;
      const correctAnswers = qAnswers.filter((a) => a.isCorrect).length;
      const correctPercentage = totalAnswers > 0 ? Number(((correctAnswers / totalAnswers) * 100).toFixed(2)) : 0;
      const totalDuration = qAnswers.reduce((sum, a) => sum + (Number(a.durationMs) || 0), 0);
      const averageDurationMs = totalAnswers > 0 ? Math.round(totalDuration / totalAnswers) : 0;

      return {
        questionId: q.id,
        body: q.body,
        weight: q.weight,
        totalAnswers,
        correctAnswers,
        correctPercentage,
        averageDurationMs,
      };
    });
  }

  async getGroupComparison(groupId: string): Promise<PrePostComparison> {
    const snap = await db.collection('activities').where('groupId', '==', groupId).get();
    if (snap.empty) {
      throw new NotFoundError(`No activities found for group '${groupId}'`);
    }

    const activities = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
    const pre = activities.find((a) => a.phase === 'pre') || null;
    const post = activities.find((a) => a.phase === 'post') || null;

    const [preStats, postStats] = await Promise.all([
      pre ? this.getActivityStats(pre.id) : null,
      post ? this.getActivityStats(post.id) : null,
    ]);

    const preAvg = preStats ? preStats.scores.average : 0;
    const postAvg = postStats ? postStats.scores.average : 0;
    const scoreDelta = Number((postAvg - preAvg).toFixed(2));

    const [preQStats, postQStats] = await Promise.all([
      pre ? this.getQuestionStats(pre.id) : [],
      post ? this.getQuestionStats(post.id) : [],
    ]);

    const maxLen = Math.max(preQStats.length, postQStats.length);
    const questionStatsDelta = [];
    for (let i = 0; i < maxLen; i++) {
      const preQ = preQStats[i];
      const postQ = postQStats[i];
      const prePct = preQ ? preQ.correctPercentage : 0;
      const postPct = postQ ? postQ.correctPercentage : 0;
      questionStatsDelta.push({
        questionIndex: i,
        preCorrectPercentage: prePct,
        postCorrectPercentage: postPct,
        delta: Number((postPct - prePct).toFixed(2)),
      });
    }

    return {
      groupId,
      preActivity: pre ? { id: pre.id, title: pre.title, averageScore: preAvg } : null,
      postActivity: post ? { id: post.id, title: post.title, averageScore: postAvg } : null,
      scoreDelta,
      pairedParticipantsCount: 0,
      pairedAverageDelta: scoreDelta,
      questionStatsDelta,
    };
  }
}

export const statsService = new StatsService();
