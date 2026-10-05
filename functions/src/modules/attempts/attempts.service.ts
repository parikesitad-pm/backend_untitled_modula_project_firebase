import { db, admin } from '../../config/firebase';
import { NotFoundError, BadRequestError, ConflictError, UnauthorizedError } from '../../lib/errors';
import { activitiesService, ActivityDocument } from '../activities/activities.service';
import { questionsService } from '../questions/questions.service';
import { participantsService, ParticipantDocument } from '../participants/participants.service';
import { ParticipantInput } from '../participants/participants.schema';
import { SubmitAnswerInput, SanitizedQuestion } from './attempts.schema';
import { calculateQuestionScore, calculateAttemptScores, ScoringQuestion, calculateFinalScore, compareLeaderboardEntries, LeaderboardRankable } from '../../lib/scoring';
import { generateSecureToken, hashTokenSha256, timingSafeEqualString } from '../../lib/hash';
import { getClock } from '../../lib/clock';

export interface SnapshotChoice {
  id: string;
  body: string;
  position: number;
  isCorrect: boolean;
}

export interface SnapshotQuestion {
  questionId: string;
  position: number;
  body: string;
  bodyText: string;
  type: string;
  imagePath?: string | null;
  comparisonKey?: string | null;
  weight: number;
  speedBonusEnabled: boolean;
  speedBonusPercent: number;
  timeReferenceSeconds: number;
  correctChoiceIds: string[];
  choices: SnapshotChoice[];
}

export interface AttemptSnapshotDocument {
  attemptId: string;
  activityId: string;
  scoringVersion: number;
  questions: SnapshotQuestion[];
  snapshotCreatedAt: string;
}

export interface QuestionStateDocument {
  attemptId: string;
  questionId: string;
  firstEnteredAt: string;
  lastEnteredAt: string;
  enterCount: number;
}

export interface AttemptDocument {
  id: string;
  activityId: string;
  participantId: string;
  participantCode?: string;
  displayName: string;
  status: 'in_progress' | 'completed' | 'abandoned' | 'expired';
  startedAt: string;
  completedAt: string | null;
  lastAnswerAt?: string | null;
  finalScore: number;
  scorePercent?: number;
  leaderboardPoints: number;
  durationMs: number;
  answeredCount: number;
  earnedWeight: number;
  attemptTokenHash: string;
  scoringVersion: number;
  createdAt: string;
  updatedAt: string;
}

export function sanitizeSnapshotQuestion(q: SnapshotQuestion): SanitizedQuestion {
  return {
    id: q.questionId,
    position: q.position,
    body: q.body,
    bodyText: q.bodyText,
    type: q.type,
    imagePath: q.imagePath || null,
    comparisonKey: q.comparisonKey || null,
    choices: (q.choices || []).map(({ id, body, position }) => ({ id, body, position })),
  };
}

export class AttemptsService {
  private col = db.collection('attempts');
  private answersCol = db.collection('answers');
  private snapshotsCol = db.collection('attemptSnapshots');
  private questionStatesCol = db.collection('questionStates');
  private leaderboardMetaCol = db.collection('leaderboardSnapshots');

  verifyToken(attempt: AttemptDocument, token?: string, isOperator = false): void {
    if (isOperator) return;
    if (!token) throw new UnauthorizedError('Missing X-Attempt-Token header', 'UNAUTHORIZED_ATTEMPT');
    const hashed = hashTokenSha256(token);
    if (!timingSafeEqualString(hashed, attempt.attemptTokenHash)) {
      throw new UnauthorizedError('Invalid attempt token', 'UNAUTHORIZED_ATTEMPT');
    }
  }

  private assertActivityAccess(activity: ActivityDocument): void {
    if (activity.status !== 'published') {
      throw new BadRequestError('Activity is not published', 'ACTIVITY_NOT_PUBLISHED');
    }
    const now = getClock().now().getTime();
    if (now < new Date(activity.opensAt).getTime()) {
      throw new BadRequestError('Activity has not opened yet', 'ACTIVITY_NOT_STARTED');
    }
    if (activitiesService.isEffectiveClosed(activity)) {
      throw new BadRequestError('Activity has closed', 'ACTIVITY_CLOSED');
    }
  }

  async startAttempt(
    slug: string,
    input: ParticipantInput
  ): Promise<{
    attemptToken: string;
    attempt: any;
    participant: ParticipantDocument;
    firstQuestion: SanitizedQuestion;
  }> {
    const activity = await activitiesService.getBySlug(slug);
    this.assertActivityAccess(activity);
    const participant = await participantsService.findOrCreate(activity.id, input);

    const maxAttempts = activity.settings?.maxAttempts ?? (activity.settings?.allowMultipleAttempts ? 999 : 1);
    const existingSnap = await this.col
      .where('activityId', '==', activity.id)
      .where('participantId', '==', participant.id)
      .get();

    if (existingSnap.size >= maxAttempts) {
      throw new ConflictError('Maximum attempts limit reached', 'MAX_ATTEMPTS_REACHED');
    }

    const rawToken = generateSecureToken(32);
    const attemptTokenHash = hashTokenSha256(rawToken);

    // Fetch live questions to freeze into attempt snapshot
    const liveQuestions = await questionsService.getByActivityId(activity.id, false);
    if (liveQuestions.length === 0) {
      throw new BadRequestError('Activity has no questions');
    }

    const now = getClock().nowIso();
    const docRef = this.col.doc();
    const attemptId = docRef.id;

    // Build AttemptSnapshotDocument
    const snapshotQuestions: SnapshotQuestion[] = liveQuestions.map((q) => ({
      questionId: q.id,
      position: q.position,
      body: q.body,
      bodyText: q.body,
      type: q.type,
      imagePath: q.imagePath || null,
      comparisonKey: q.comparisonKey || null,
      weight: q.weight > 0 ? q.weight : 1,
      speedBonusEnabled: !!q.speedBonusEnabled,
      speedBonusPercent: q.speedBonusPercent ?? 20,
      timeReferenceSeconds: q.timeReferenceSeconds ?? 30,
      correctChoiceIds: (q.choices || []).filter((c) => c.isCorrect).map((c) => c.id),
      choices: (q.choices || []).map((c) => ({
        id: c.id,
        body: c.body,
        position: c.position,
        isCorrect: !!c.isCorrect,
      })),
    }));

    const attempt: AttemptDocument = {
      id: attemptId,
      activityId: activity.id,
      participantId: participant.id,
      participantCode: participant.participantCode || '',
      displayName: participant.name,
      status: 'in_progress',
      startedAt: now,
      completedAt: null,
      lastAnswerAt: null,
      finalScore: 0,
      scorePercent: 0,
      leaderboardPoints: 0,
      durationMs: 0,
      answeredCount: 0,
      earnedWeight: 0,
      attemptTokenHash,
      scoringVersion: 2,
      createdAt: now,
      updatedAt: now,
    };

    const attemptSnapshot: AttemptSnapshotDocument = {
      attemptId,
      activityId: activity.id,
      scoringVersion: 2,
      questions: snapshotQuestions,
      snapshotCreatedAt: now,
    };

    // First question marker (find question with lowest position)
    const sortedQuestions = [...snapshotQuestions].sort((a, b) => a.position - b.position);
    const firstQ = sortedQuestions[0];
    const firstQMarkerRef = this.questionStatesCol.doc(`${attemptId}_${firstQ.questionId}`);

    const batch = db.batch();
    batch.set(docRef, attempt);
    batch.set(this.snapshotsCol.doc(attemptId), attemptSnapshot);
    batch.set(firstQMarkerRef, {
      attemptId,
      questionId: firstQ.questionId,
      firstEnteredAt: now,
      lastEnteredAt: now,
      enterCount: 1,
    });

    // Update meta doc with participant count increment
    batch.set(
      this.leaderboardMetaCol.doc(activity.id),
      {
        activityId: activity.id,
        slug: activity.slug,
        state: 'live',
        status: activity.status,
        visibleToParticipants: !activity.settings?.hideLeaderboardFromParticipants,
        updatedAt: now,
        participantCount: admin.firestore.FieldValue.increment(1),
      },
      { merge: true }
    );

    await batch.commit();

    return {
      attemptToken: rawToken,
      attempt: sanitizeAttempt(attempt),
      participant,
      firstQuestion: sanitizeSnapshotQuestion(firstQ),
    };
  }

  async enterQuestion(
    attemptId: string,
    questionId: string,
    token?: string
  ): Promise<{ question: SanitizedQuestion }> {
    const attemptDoc = await this.col.doc(attemptId).get();
    if (!attemptDoc.exists) throw new NotFoundError(`Attempt '${attemptId}' not found`);
    const attempt = attemptDoc.data() as AttemptDocument;
    this.verifyToken(attempt, token);

    if (attempt.status !== 'in_progress') {
      throw new BadRequestError('Attempt is not in progress', 'ATTEMPT_NOT_IN_PROGRESS');
    }

    const activity = await activitiesService.getById(attempt.activityId);
    if (activitiesService.isEffectiveClosed(activity)) {
      throw new BadRequestError('Activity has closed', 'ACTIVITY_CLOSED');
    }

    const snapDoc = await this.snapshotsCol.doc(attemptId).get();
    if (!snapDoc.exists) {
      throw new NotFoundError(`Attempt snapshot not found for attempt '${attemptId}'`);
    }

    const snapshot = snapDoc.data() as AttemptSnapshotDocument;
    const qSnap = snapshot.questions.find((q) => q.questionId === questionId);
    if (!qSnap) {
      throw new BadRequestError('Question not part of this attempt snapshot');
    }

    const markerRef = this.questionStatesCol.doc(`${attemptId}_${questionId}`);
    const now = getClock().nowIso();

    await db.runTransaction(async (t) => {
      const doc = await t.get(markerRef);
      if (!doc.exists) {
        t.set(markerRef, {
          attemptId,
          questionId,
          firstEnteredAt: now,
          lastEnteredAt: now,
          enterCount: 1,
        });
      } else {
        const count = (doc.data()?.enterCount || 1) + 1;
        t.update(markerRef, {
          lastEnteredAt: now,
          enterCount: count,
        });
      }
    });

    return { question: sanitizeSnapshotQuestion(qSnap) };
  }

  async submitAnswer(
    attemptId: string,
    input: SubmitAnswerInput,
    token?: string
  ): Promise<{ recorded: boolean; questionId: string }> {
    const attemptRef = this.col.doc(attemptId);
    const snapDoc = await this.snapshotsCol.doc(attemptId).get();
    if (!snapDoc.exists) {
      throw new NotFoundError(`Attempt snapshot not found for '${attemptId}'`);
    }

    const snapData = snapDoc.data() as AttemptSnapshotDocument;
    const qSnap = snapData.questions.find((q) => q.questionId === input.questionId);
    if (!qSnap) {
      throw new BadRequestError('Question not part of this attempt');
    }

    const validChoiceIds = new Set(qSnap.choices.map((c) => c.id));
    if (!input.selectedChoiceIds.every((id) => validChoiceIds.has(id))) {
      throw new BadRequestError('Foreign choice id detected');
    }
    if (new Set(input.selectedChoiceIds).size !== input.selectedChoiceIds.length) {
      throw new BadRequestError('Duplicate choice ids selected');
    }
    if (qSnap.type === 'multiple_choice' && qSnap.correctChoiceIds.length <= 1 && input.selectedChoiceIds.length > 1) {
      throw new BadRequestError('Single choice question cannot have multiple selections');
    }

    const totalQuestionsCount = snapData.questions.length;
    const totalAvailableWeight = snapData.questions.reduce((sum, q) => sum + (q.weight > 0 ? q.weight : 1), 0);

    const answerId = `${attemptId}_${input.questionId}`;
    const answerRef = this.answersCol.doc(answerId);
    const markerRef = this.questionStatesCol.doc(`${attemptId}_${input.questionId}`);

    const serverReceivedAt = getClock().nowIso();
    const nowMs = new Date(serverReceivedAt).getTime();

    await db.runTransaction(async (t) => {
      const attemptDoc = await t.get(attemptRef);
      if (!attemptDoc.exists) throw new NotFoundError(`Attempt '${attemptId}' not found`);
      const attempt = attemptDoc.data() as AttemptDocument;
      this.verifyToken(attempt, token);

      if (attempt.status !== 'in_progress') {
        throw new BadRequestError('Attempt is not in progress', 'ATTEMPT_NOT_IN_PROGRESS');
      }

      const activity = await activitiesService.getById(attempt.activityId);
      if (activitiesService.isEffectiveClosed(activity)) {
        throw new BadRequestError('Activity has closed', 'ACTIVITY_CLOSED');
      }

      const existingAns = await t.get(answerRef);
      if (existingAns.exists) {
        throw new ConflictError('Question has already been answered', 'ALREADY_ANSWERED');
      }

      // Read question enter marker
      const markerDoc = await t.get(markerRef);
      let officialDurationMs = 0;
      let timingSource: 'server_marker' | 'missing_marker' = 'server_marker';

      if (markerDoc.exists) {
        const markerData = markerDoc.data() as QuestionStateDocument;
        const firstEnteredAtMs = new Date(markerData.firstEnteredAt).getTime();
        officialDurationMs = Math.max(0, nowMs - firstEnteredAtMs);
        timingSource = 'server_marker';
      } else {
        // Missing marker: speedBonus = 0, timingSource = "missing_marker"
        const startedAtMs = new Date(attempt.startedAt).getTime();
        officialDurationMs = Math.max(0, nowMs - startedAtMs);
        timingSource = 'missing_marker';
      }

      const scored = calculateQuestionScore(
        {
          id: qSnap.questionId,
          weight: qSnap.weight,
          speedBonusEnabled: timingSource === 'server_marker' ? qSnap.speedBonusEnabled : false,
          speedBonusPercent: qSnap.speedBonusPercent,
          timeReferenceSeconds: qSnap.timeReferenceSeconds,
          correctChoiceIds: qSnap.correctChoiceIds,
        },
        {
          questionId: input.questionId,
          selectedChoiceIds: input.selectedChoiceIds,
          enteredAt: input.enteredAt || attempt.startedAt,
          answeredAt: input.answeredAt || serverReceivedAt,
          durationMs: officialDurationMs,
        }
      );

      if (timingSource === 'missing_marker') {
        scored.speedBonus = 0;
        scored.leaderboardPoints = scored.earnedWeight;
      }

      const selectedChoiceBodies = qSnap.choices
        .filter((c) => input.selectedChoiceIds.includes(c.id))
        .map((c) => c.body);

      const answerData = {
        id: answerId,
        attemptId,
        activityId: attempt.activityId,
        questionId: input.questionId,
        questionBody: qSnap.body,
        selectedChoiceIds: input.selectedChoiceIds,
        selectedChoiceBodies,
        isCorrect: scored.isCorrect,
        serverReceivedAt,
        clientEnteredAt: input.enteredAt || null,
        clientAnsweredAt: input.answeredAt || null,
        durationMs: officialDurationMs,
        earnedWeight: scored.earnedWeight,
        speedBonus: scored.speedBonus,
        leaderboardPoints: scored.leaderboardPoints,
        changeCount: input.changeCount || 0,
        timingSource,
      };

      const newAnsweredCount = (attempt.answeredCount || 0) + 1;
      const newEarnedWeight = (attempt.earnedWeight || 0) + scored.earnedWeight;
      const newPoints = Number(((attempt.leaderboardPoints || 0) + scored.leaderboardPoints).toFixed(2));
      const newDurationMs = (attempt.durationMs || 0) + officialDurationMs;
      const newScorePercent = calculateFinalScore(newEarnedWeight, totalAvailableWeight || 1);

      const candidateRankable: LeaderboardRankable = {
        attemptId,
        leaderboardPoints: newPoints,
        scorePercent: newScorePercent,
        durationMs: newDurationMs,
        status: 'in_progress',
        rankTimeAt: serverReceivedAt,
      };

      let shouldUpdateLeaderboard = true;
      let previousEntryIdToDelete: string | null = null;

      if (attempt.participantCode) {
        const siblingAttemptsSnap = await t.get(
          this.col
            .where('activityId', '==', attempt.activityId)
            .where('participantId', '==', attempt.participantId)
        );

        for (const sDoc of siblingAttemptsSnap.docs) {
          if (sDoc.id === attemptId) continue;
          const sData = sDoc.data() as AttemptDocument;
          if (sData.status !== 'completed' && sData.status !== 'in_progress') continue;

          const siblingRankable: LeaderboardRankable = {
            attemptId: sData.id,
            leaderboardPoints: sData.leaderboardPoints || 0,
            scorePercent: sData.scorePercent ?? sData.finalScore ?? 0,
            durationMs: sData.durationMs || 0,
            status: sData.status,
            rankTimeAt: sData.status === 'completed' ? (sData.completedAt || sData.lastAnswerAt) : (sData.lastAnswerAt || sData.startedAt),
          };

          if (compareLeaderboardEntries(siblingRankable, candidateRankable) < 0) {
            shouldUpdateLeaderboard = false;
            break;
          } else {
            previousEntryIdToDelete = sData.id;
          }
        }
      }

      // Write answer doc
      t.set(answerRef, answerData);

      // Update attempt running aggregates
      t.update(attemptRef, {
        answeredCount: newAnsweredCount,
        earnedWeight: newEarnedWeight,
        leaderboardPoints: newPoints,
        durationMs: newDurationMs,
        finalScore: newScorePercent,
        scorePercent: newScorePercent,
        lastAnswerAt: serverReceivedAt,
        updatedAt: serverReceivedAt,
      });

      if (shouldUpdateLeaderboard) {
        if (previousEntryIdToDelete) {
          const oldEntryRef = db
            .collection('leaderboardSnapshots')
            .doc(attempt.activityId)
            .collection('entries')
            .doc(previousEntryIdToDelete);
          t.delete(oldEntryRef);
        }

        // Update leaderboard entry in same transaction
        const entryRef = db
          .collection('leaderboardSnapshots')
          .doc(attempt.activityId)
          .collection('entries')
          .doc(attemptId);

        t.set(entryRef, {
          attemptId,
          displayName: attempt.displayName || 'Anonymous',
          status: 'in_progress',
          locked: false,
          leaderboardPoints: newPoints,
          scorePercent: newScorePercent,
          answeredCount: newAnsweredCount,
          totalQuestions: totalQuestionsCount,
          durationMs: newDurationMs,
          lastAnswerAt: serverReceivedAt,
          completedAt: null,
          rankTimeAt: serverReceivedAt,
        });
      }
    });

    return { recorded: true, questionId: input.questionId };
  }

  async finishAttempt(attemptId: string, token?: string): Promise<{ attempt: any; summary: any }> {
    const attemptRef = this.col.doc(attemptId);
    const snapDoc = await this.snapshotsCol.doc(attemptId).get();
    let totalQuestionsCount = 0;
    let scoringQuestions: ScoringQuestion[] = [];

    if (snapDoc.exists) {
      const snapData = snapDoc.data() as AttemptSnapshotDocument;
      scoringQuestions = snapData.questions.map((q) => ({
        id: q.questionId,
        weight: q.weight,
        speedBonusEnabled: q.speedBonusEnabled,
        speedBonusPercent: q.speedBonusPercent,
        timeReferenceSeconds: q.timeReferenceSeconds,
        correctChoiceIds: q.correctChoiceIds,
      }));
      totalQuestionsCount = snapData.questions.length;
    }

    const answersSnap = await this.answersCol.where('attemptId', '==', attemptId).get();
    const answers = answersSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        questionId: d.questionId,
        selectedChoiceIds: d.selectedChoiceIds,
        enteredAt: d.serverReceivedAt,
        answeredAt: d.serverReceivedAt,
        durationMs: d.durationMs,
      };
    });

    const outcome = calculateAttemptScores(scoringQuestions, answers);
    const completedAt = getClock().nowIso();

    let finalAttempt: AttemptDocument | null = null;

    await db.runTransaction(async (t) => {
      const attemptDoc = await t.get(attemptRef);
      if (!attemptDoc.exists) throw new NotFoundError(`Attempt '${attemptId}' not found`);
      const attempt = attemptDoc.data() as AttemptDocument;
      this.verifyToken(attempt, token);

      if (attempt.status !== 'in_progress') {
        throw new BadRequestError('Attempt is not in progress', 'ATTEMPT_NOT_IN_PROGRESS');
      }

      const activity = await activitiesService.getById(attempt.activityId);
      if (activitiesService.isEffectiveClosed(activity)) {
        throw new BadRequestError('Finish grace window has expired', 'ACTIVITY_CLOSED');
      }

      const updatedData = {
        status: 'completed' as const,
        completedAt,
        finalScore: outcome.finalScore,
        scorePercent: outcome.finalScore,
        leaderboardPoints: outcome.totalLeaderboardPoints,
        durationMs: outcome.totalDurationMs,
        lastAnswerAt: completedAt,
        updatedAt: completedAt,
      };

      const candidateRankable: LeaderboardRankable = {
        attemptId,
        leaderboardPoints: outcome.totalLeaderboardPoints,
        scorePercent: outcome.finalScore,
        durationMs: outcome.totalDurationMs,
        status: 'completed',
        rankTimeAt: completedAt,
      };

      let shouldUpdateLeaderboard = true;
      let previousEntryIdToDelete: string | null = null;

      if (attempt.participantCode) {
        const siblingAttemptsSnap = await t.get(
          this.col
            .where('activityId', '==', attempt.activityId)
            .where('participantId', '==', attempt.participantId)
        );

        for (const sDoc of siblingAttemptsSnap.docs) {
          if (sDoc.id === attemptId) continue;
          const sData = sDoc.data() as AttemptDocument;
          if (sData.status !== 'completed' && sData.status !== 'in_progress') continue;

          const siblingRankable: LeaderboardRankable = {
            attemptId: sData.id,
            leaderboardPoints: sData.leaderboardPoints || 0,
            scorePercent: sData.scorePercent ?? sData.finalScore ?? 0,
            durationMs: sData.durationMs || 0,
            status: sData.status,
            rankTimeAt: sData.status === 'completed' ? (sData.completedAt || sData.lastAnswerAt) : (sData.lastAnswerAt || sData.startedAt),
          };

          if (compareLeaderboardEntries(siblingRankable, candidateRankable) < 0) {
            shouldUpdateLeaderboard = false;
            break;
          } else {
            previousEntryIdToDelete = sData.id;
          }
        }
      }

      t.update(attemptRef, updatedData);

      if (shouldUpdateLeaderboard) {
        if (previousEntryIdToDelete) {
          const oldEntryRef = db
            .collection('leaderboardSnapshots')
            .doc(attempt.activityId)
            .collection('entries')
            .doc(previousEntryIdToDelete);
          t.delete(oldEntryRef);
        }

        const entryRef = db
          .collection('leaderboardSnapshots')
          .doc(attempt.activityId)
          .collection('entries')
          .doc(attemptId);

        t.set(
          entryRef,
          {
            attemptId,
            displayName: attempt.displayName || 'Anonymous',
            status: 'completed',
            locked: true,
            leaderboardPoints: outcome.totalLeaderboardPoints,
            scorePercent: outcome.finalScore,
            answeredCount: answers.length,
            totalQuestions: totalQuestionsCount,
            durationMs: outcome.totalDurationMs,
            lastAnswerAt: completedAt,
            completedAt,
            rankTimeAt: completedAt,
          },
          { merge: true }
        );
      }

      finalAttempt = { ...attempt, ...updatedData };
    });

    const publicSummary = {
      totalWeight: outcome.totalWeight,
      earnedWeight: outcome.earnedWeight,
      finalScore: outcome.finalScore,
      totalLeaderboardPoints: outcome.totalLeaderboardPoints,
      totalDurationMs: outcome.totalDurationMs,
      correctCount: outcome.correctCount,
      totalQuestions: outcome.totalQuestions,
    };

    return { attempt: sanitizeAttempt(finalAttempt!, false), summary: publicSummary };
  }

  async getById(id: string, token?: string, isOperator = false): Promise<any> {
    const doc = await this.col.doc(id).get();
    if (!doc.exists) throw new NotFoundError(`Attempt '${id}' not found`);
    const attempt = doc.data() as AttemptDocument;
    this.verifyToken(attempt, token, isOperator);
    return sanitizeAttempt({ ...attempt, id: doc.id }, isOperator);
  }
}

export function sanitizeAttempt(attempt: AttemptDocument, _isOperator = false): any {
  const { attemptTokenHash, ...rest } = attempt;
  return rest;
}

export const attemptsService = new AttemptsService();
