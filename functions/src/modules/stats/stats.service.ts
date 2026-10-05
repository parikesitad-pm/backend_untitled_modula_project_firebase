import { db } from '../../config/firebase';
import { NotFoundError } from '../../lib/errors';
import { activitiesService } from '../activities/activities.service';
import { questionsService } from '../questions/questions.service';
import { normalizeParticipantCode } from '../participants/participants.schema';
import { ActivityStatsSummary, QuestionStat, PrePostComparison, PrePostParticipantComparison } from './stats.schema';
import { getClock } from '../../lib/clock';
import { leaderboardService } from '../leaderboard/leaderboard.service';

export class StatsService {
  private attemptsCol = db.collection('attempts');
  private answersCol = db.collection('answers');
  private participantsCol = db.collection('participants');
  private snapshotsCol = db.collection('statsSnapshots');
  private attemptSnapshotsCol = db.collection('attemptSnapshots');

  async getActivityStats(activityId: string): Promise<ActivityStatsSummary> {
    const activity = await activitiesService.getById(activityId);
    if (activitiesService.isEffectiveClosed(activity)) {
      await leaderboardService.finalizeActivity(activityId);
    }

    const [participantsSnap, attemptsSnap] = await Promise.all([
      this.participantsCol.where('activityId', '==', activityId).get(),
      this.attemptsCol.where('activityId', '==', activityId).get(),
    ]);

    const totalParticipants = participantsSnap.size;
    const totalAttempts = attemptsSnap.size;
    const completedList = attemptsSnap.docs
      .map((d) => d.data())
      .filter((a) => a.status === 'completed');

    const completedAttempts = completedList.length;
    const incompleteAttempts = totalAttempts - completedAttempts;
    const completionRate = totalAttempts > 0 ? Number(((completedAttempts / totalAttempts) * 100).toFixed(2)) : 0;

    let totalScore = 0;
    let highest = 0;
    let lowest = completedAttempts > 0 ? 100 : 0;
    let totalDurationMs = 0;
    let fastestDurationMs = completedAttempts > 0 ? Infinity : 0;

    for (const a of completedList) {
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
      updatedAt: getClock().nowIso(),
    };

    await this.snapshotsCol.doc(activityId).set(summary);
    return summary;
  }

  async getActivityParticipants(
    activityId: string,
    limit = 50,
    cursor?: string
  ): Promise<{ items: any[]; meta: { limit: number; nextCursor: string | null } }> {
    await activitiesService.getById(activityId);
    const pageLimit = Math.min(200, Math.max(1, limit));

    let query = this.participantsCol.where('activityId', '==', activityId).orderBy('createdAt', 'asc').limit(pageLimit + 1);
    if (cursor) {
      const cursorDoc = await this.participantsCol.doc(cursor).get();
      if (cursorDoc.exists) query = query.startAfter(cursorDoc);
    }

    const [pSnap, aSnap] = await Promise.all([
      query.get(),
      this.attemptsCol.where('activityId', '==', activityId).get(),
    ]);

    const hasMore = pSnap.docs.length > pageLimit;
    const pDocs = hasMore ? pSnap.docs.slice(0, pageLimit) : pSnap.docs;
    const nextCursor = hasMore ? pDocs[pDocs.length - 1].id : null;

    const attemptsByParticipant = new Map<string, any[]>();
    aSnap.docs.forEach((doc) => {
      const d = { id: doc.id, ...doc.data() };
      const arr = attemptsByParticipant.get(doc.data().participantId) || [];
      arr.push(d);
      attemptsByParticipant.set(doc.data().participantId, arr);
    });

    const items = pDocs.map((doc) => {
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

    return { items, meta: { limit: pageLimit, nextCursor } };
  }

  async getActivityResponses(
    activityId: string,
    limit = 50,
    cursor?: string
  ): Promise<{ items: any[]; meta: { limit: number; nextCursor: string | null } }> {
    await activitiesService.getById(activityId);
    const pageLimit = Math.min(200, Math.max(1, limit));

    let query = this.answersCol.where('activityId', '==', activityId).orderBy('serverReceivedAt', 'asc').limit(pageLimit + 1);
    if (cursor) {
      const cursorDoc = await this.answersCol.doc(cursor).get();
      if (cursorDoc.exists) query = query.startAfter(cursorDoc);
    }

    const snap = await query.get();
    const hasMore = snap.docs.length > pageLimit;
    const docs = hasMore ? snap.docs.slice(0, pageLimit) : snap.docs;
    const nextCursor = hasMore ? docs[docs.length - 1].id : null;

    const items = await Promise.all(
      docs.map(async (d) => {
        const data = d.data();
        let questionBody = data.questionBody;
        let selectedChoiceBodies = data.selectedChoiceBodies;
        if (!questionBody) {
          const sDoc = await this.attemptSnapshotsCol.doc(data.attemptId).get();
          if (sDoc.exists) {
            const q = sDoc.data()?.questions?.find((sq: any) => sq.questionId === data.questionId);
            if (q) {
              questionBody = q.body;
              selectedChoiceBodies = q.choices
                ?.filter((c: any) => (data.selectedChoiceIds || []).includes(c.id))
                .map((c: any) => c.body);
            }
          }
        }
        return {
          id: d.id,
          ...data,
          questionBody: questionBody || data.body || '',
          selectedChoiceBodies: selectedChoiceBodies || [],
        };
      })
    );

    return { items, meta: { limit: pageLimit, nextCursor } };
  }

  async getParticipantDetail(activityId: string, participantId: string): Promise<any> {
    await activitiesService.getById(activityId);
    const pDoc = await this.participantsCol.doc(participantId).get();
    if (!pDoc.exists) throw new NotFoundError('Participant not found');
    const participant = { id: pDoc.id, ...pDoc.data() };

    const attemptsSnap = await this.attemptsCol
      .where('activityId', '==', activityId)
      .where('participantId', '==', participantId)
      .orderBy('startedAt', 'asc')
      .get();

    const attempts = await Promise.all(
      attemptsSnap.docs.map(async (attDoc) => {
        const attData = { id: attDoc.id, ...attDoc.data() };
        const snapDoc = await this.attemptSnapshotsCol.doc(attDoc.id).get();
        const snapshotQuestions = snapDoc.exists ? snapDoc.data()?.questions || [] : [];

        const answersSnap = await this.answersCol
          .where('attemptId', '==', attDoc.id)
          .orderBy('serverReceivedAt', 'asc')
          .get();

        const answers = answersSnap.docs.map((aDoc) => {
          const a = aDoc.data();
          const qSnap = snapshotQuestions.find((sq: any) => sq.questionId === a.questionId);
          return {
            id: aDoc.id,
            ...a,
            questionBody: qSnap ? qSnap.body : a.questionBody,
            choices: qSnap ? qSnap.choices : [],
          };
        });

        return {
          ...attData,
          answers,
        };
      })
    );

    return {
      ...participant,
      attempts,
    };
  }

  async getQuestionStats(activityId: string): Promise<QuestionStat[]> {
    const activity = await activitiesService.getById(activityId);
    if (activitiesService.isEffectiveClosed(activity)) {
      await leaderboardService.finalizeActivity(activityId);
    }

    const questions = await questionsService.getByActivityId(activityId, false);
    const answersSnap = await this.answersCol.where('activityId', '==', activityId).get();
    const answers = answersSnap.docs.map((d) => d.data());

    // Check attempt snapshots to compute textVariants
    const attemptsSnap = await this.attemptsCol.where('activityId', '==', activityId).get();
    const snapshotDocs = await Promise.all(
      attemptsSnap.docs.map((d) => this.attemptSnapshotsCol.doc(d.id).get())
    );

    return questions.map((q) => {
      const qAnswers = answers.filter((a) => a.questionId === q.id);
      const totalAnswers = qAnswers.length;
      const correctAnswers = qAnswers.filter((a) => a.isCorrect).length;
      const correctPercentage = totalAnswers > 0 ? Number(((correctAnswers / totalAnswers) * 100).toFixed(2)) : 0;
      const totalDuration = qAnswers.reduce((sum, a) => sum + (Number(a.durationMs) || 0), 0);
      const averageDurationMs = totalAnswers > 0 ? Math.round(totalDuration / totalAnswers) : 0;

      const bodyVariants = new Set<string>();
      bodyVariants.add(q.body);

      snapshotDocs.forEach((sDoc) => {
        if (sDoc.exists) {
          const sQuestions = sDoc.data()?.questions || [];
          const matchedQ = sQuestions.find((sq: any) => sq.questionId === q.id);
          if (matchedQ?.body) {
            bodyVariants.add(matchedQ.body);
          }
        }
      });

      return {
        questionId: q.id,
        body: q.body,
        weight: q.weight,
        totalAnswers,
        correctAnswers,
        correctPercentage,
        averageDurationMs,
        textVariants: bodyVariants.size,
        comparisonKey: q.comparisonKey || null,
      };
    });
  }

  async getGroupComparison(groupId: string): Promise<PrePostComparison> {
    const snap = await db.collection('activities').where('groupId', '==', groupId).get();
    if (snap.empty) throw new NotFoundError(`No activities found for group '${groupId}'`);

    const activities = snap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
    const pre = activities.find((a) => a.phase === 'pre') || null;
    const post = activities.find((a) => a.phase === 'post') || null;

    const [preStats, postStats] = await Promise.all([
      pre ? this.getActivityStats(pre.id) : null,
      post ? this.getActivityStats(post.id) : null,
    ]);

    const preAvg = preStats ? preStats.scores.average : 0;
    const postAvg = postStats ? postStats.scores.average : 0;
    const overallDelta = Number((postAvg - preAvg).toFixed(2));

    const [preParts, postParts, preAttempts, postAttempts] = await Promise.all([
      pre ? this.participantsCol.where('activityId', '==', pre.id).get() : { docs: [] },
      post ? this.participantsCol.where('activityId', '==', post.id).get() : { docs: [] },
      pre ? this.attemptsCol.where('activityId', '==', pre.id).where('status', '==', 'completed').get() : { docs: [] },
      post ? this.attemptsCol.where('activityId', '==', post.id).where('status', '==', 'completed').get() : { docs: [] },
    ]);

    const preScoreByPartId = new Map<string, number>();
    preAttempts.docs.forEach((d) => preScoreByPartId.set(d.data().participantId, d.data().finalScore));
    const postScoreByPartId = new Map<string, number>();
    postAttempts.docs.forEach((d) => postScoreByPartId.set(d.data().participantId, d.data().finalScore));

    const participantMap = new Map<string, { name: string; preScore: number | null; postScore: number | null }>();
    preParts.docs.forEach((d) => {
      const code = normalizeParticipantCode(d.data().participantCode);
      const score = preScoreByPartId.get(d.id) ?? null;
      participantMap.set(code, { name: d.data().name, preScore: score, postScore: null });
    });

    postParts.docs.forEach((d) => {
      const code = normalizeParticipantCode(d.data().participantCode);
      const score = postScoreByPartId.get(d.id) ?? null;
      const existing = participantMap.get(code);
      if (existing) {
        existing.postScore = score;
      } else {
        participantMap.set(code, { name: d.data().name, preScore: null, postScore: score });
      }
    });

    const participantsList: PrePostParticipantComparison[] = [];
    let matchedDeltaSum = 0;
    let matchedCount = 0;
    let unmatchedCount = 0;

    participantMap.forEach((val, code) => {
      const isMatched = val.preScore !== null && val.postScore !== null;
      const delta = isMatched ? Number((val.postScore! - val.preScore!).toFixed(2)) : null;

      if (isMatched) {
        matchedCount++;
        matchedDeltaSum += delta!;
      } else {
        unmatchedCount++;
      }

      participantsList.push({
        participantCode: code,
        name: val.name,
        preScore: val.preScore,
        postScore: val.postScore,
        scoreDelta: delta,
        delta,
        matched: isMatched,
      });
    });

    const matchedAverageDelta = matchedCount > 0 ? Number((matchedDeltaSum / matchedCount).toFixed(2)) : 0;

    // Pre/Post Question Delta pairing using snapshotted comparisonKey (Requirement K2)
    const [preAnswersSnap, postAnswersSnap] = await Promise.all([
      pre ? this.answersCol.where('activityId', '==', pre.id).get() : { docs: [] },
      post ? this.answersCol.where('activityId', '==', post.id).get() : { docs: [] },
    ]);

    // Build question answer stats keyed by attempt's snapshot question comparisonKey
    const preSnapshotDocs = await Promise.all(
      preAttempts.docs.map((d) => this.attemptSnapshotsCol.doc(d.id).get())
    );
    const postSnapshotDocs = await Promise.all(
      postAttempts.docs.map((d) => this.attemptSnapshotsCol.doc(d.id).get())
    );

    // Map attemptId_questionId -> snapshotted comparisonKey
    const preKeyByAttemptQuestion = new Map<string, string | null>();
    preSnapshotDocs.forEach((sDoc) => {
      if (sDoc.exists) {
        const questions = sDoc.data()?.questions || [];
        questions.forEach((q: any) => {
          preKeyByAttemptQuestion.set(`${sDoc.id}_${q.questionId}`, q.comparisonKey || null);
        });
      }
    });

    const postKeyByAttemptQuestion = new Map<string, string | null>();
    postSnapshotDocs.forEach((sDoc) => {
      if (sDoc.exists) {
        const questions = sDoc.data()?.questions || [];
        questions.forEach((q: any) => {
          postKeyByAttemptQuestion.set(`${sDoc.id}_${q.questionId}`, q.comparisonKey || null);
        });
      }
    });

    // Check if comparisonKeys exist in snapshots or live questions
    const preQuestions = pre ? await questionsService.getByActivityId(pre.id, false) : [];
    const postQuestions = post ? await questionsService.getByActivityId(post.id, false) : [];

    const hasComparisonKeys =
      preKeyByAttemptQuestion.size > 0 ||
      postKeyByAttemptQuestion.size > 0 ||
      preQuestions.some((q) => !!q.comparisonKey) ||
      postQuestions.some((q) => !!q.comparisonKey);

    const questionStatsDelta: any[] = [];

    if (hasComparisonKeys) {
      // Gather all distinct comparisonKeys from pre and post
      const allKeys = new Set<string>();
      preQuestions.forEach((q) => { if (q.comparisonKey) allKeys.add(q.comparisonKey); });
      postQuestions.forEach((q) => { if (q.comparisonKey) allKeys.add(q.comparisonKey); });
      preKeyByAttemptQuestion.forEach((k) => { if (k) allKeys.add(k); });
      postKeyByAttemptQuestion.forEach((k) => { if (k) allKeys.add(k); });

      // Calculate stats per key
      const preCountsByKey = new Map<string, { total: number; correct: number }>();
      preAnswersSnap.docs.forEach((d) => {
        const a = d.data();
        const key = preKeyByAttemptQuestion.has(`${a.attemptId}_${a.questionId}`)
          ? preKeyByAttemptQuestion.get(`${a.attemptId}_${a.questionId}`)
          : preQuestions.find((q) => q.id === a.questionId)?.comparisonKey;
        if (key) {
          const cur = preCountsByKey.get(key) || { total: 0, correct: 0 };
          cur.total++;
          if (a.isCorrect) cur.correct++;
          preCountsByKey.set(key, cur);
        }
      });

      const postCountsByKey = new Map<string, { total: number; correct: number }>();
      postAnswersSnap.docs.forEach((d) => {
        const a = d.data();
        const key = postKeyByAttemptQuestion.has(`${a.attemptId}_${a.questionId}`)
          ? postKeyByAttemptQuestion.get(`${a.attemptId}_${a.questionId}`)
          : postQuestions.find((q) => q.id === a.questionId)?.comparisonKey;
        if (key) {
          const cur = postCountsByKey.get(key) || { total: 0, correct: 0 };
          cur.total++;
          if (a.isCorrect) cur.correct++;
          postCountsByKey.set(key, cur);
        }
      });

      let idx = 0;
      allKeys.forEach((key) => {
        const preData = preCountsByKey.get(key);
        const postData = postCountsByKey.get(key);
        const inPre = preData !== undefined || preQuestions.some((q) => q.comparisonKey === key);
        const inPost = postData !== undefined || postQuestions.some((q) => q.comparisonKey === key);
        const matched = inPre && inPost;

        const prePct = preData && preData.total > 0
          ? Number(((preData.correct / preData.total) * 100).toFixed(2))
          : (inPre ? 0 : null);
        const postPct = postData && postData.total > 0
          ? Number(((postData.correct / postData.total) * 100).toFixed(2))
          : (inPost ? 0 : null);

        const delta = matched && prePct !== null && postPct !== null
          ? Number((postPct - prePct).toFixed(2))
          : null;

        questionStatsDelta.push({
          questionIndex: idx++,
          comparisonKey: key,
          preCorrectPercentage: prePct,
          postCorrectPercentage: postPct,
          delta,
          matched,
        });
      });
    } else {
      // Fallback: match by questionIndex
      const [preQStats, postQStats] = await Promise.all([
        pre ? this.getQuestionStats(pre.id) : [],
        post ? this.getQuestionStats(post.id) : [],
      ]);

      const maxLen = Math.max(preQStats.length, postQStats.length);
      for (let i = 0; i < maxLen; i++) {
        const preQ = preQStats[i];
        const postQ = postQStats[i];
        const prePct = preQ ? preQ.correctPercentage : 0;
        const postPct = postQ ? postQ.correctPercentage : 0;
        questionStatsDelta.push({
          questionIndex: i,
          comparisonKey: null,
          preCorrectPercentage: prePct,
          postCorrectPercentage: postPct,
          delta: Number((postPct - prePct).toFixed(2)),
          matched: !!(preQ && postQ),
        });
      }
    }

    return {
      groupId,
      preActivity: pre ? { id: pre.id, title: pre.title, averageScore: preAvg } : null,
      postActivity: post ? { id: post.id, title: post.title, averageScore: postAvg } : null,
      scoreDelta: overallDelta,
      matchedCount,
      unmatchedCount,
      totalParticipants: participantMap.size,
      matchedAverageDelta,
      participants: participantsList,
      questionStatsDelta,
    };
  }
}

export const statsService = new StatsService();
