import { db } from '../../config/firebase';
import { NotFoundError, BadRequestError, ConflictError, UnauthorizedError } from '../../lib/errors';
import { activitiesService, ActivityDocument } from '../activities/activities.service';
import { questionsService } from '../questions/questions.service';
import { participantsService, ParticipantDocument } from '../participants/participants.service';
import { ParticipantInput } from '../participants/participants.schema';
import { SubmitAnswerInput, SanitizedQuestion } from './attempts.schema';
import { calculateQuestionScore, calculateAttemptScores, ScoringQuestion, calculateFinalScore } from '../../lib/scoring';
import { generateSecureToken, hashTokenSha256, timingSafeEqualString } from '../../lib/hash';
import { getClock } from '../../lib/clock';
import { leaderboardService } from '../leaderboard/leaderboard.service';

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

export interface QuestionSnapshot {
  questionId: string;
  weight: number;
  type: string;
  speedBonusEnabled: boolean;
  speedBonusPercent: number;
  timeReferenceSeconds: number;
  correctChoiceIds: string[];
  choiceIds: string[];
}

export interface AttemptDocument {
  id: string;
  activityId: string;
  participantId: string;
  status: 'in_progress' | 'completed' | 'abandoned' | 'expired';
  startedAt: string;
  completedAt: string | null;
  lastAnswerAt?: string | null;
  finalScore: number;
  leaderboardPoints: number;
  durationMs: number;
  attemptTokenHash: string;
  scoringVersion: number;
  questionSnapshots?: QuestionSnapshot[];
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

    // Build QuestionSnapshots
    const legacySnapshots: QuestionSnapshot[] = liveQuestions.map((q) => ({
      questionId: q.id,
      weight: q.weight,
      type: q.type,
      speedBonusEnabled: q.speedBonusEnabled,
      speedBonusPercent: q.speedBonusPercent,
      timeReferenceSeconds: q.timeReferenceSeconds,
      correctChoiceIds: q.choices.filter((c) => c.isCorrect).map((c) => c.id),
      choiceIds: q.choices.map((c) => c.id),
    }));

    // Build AttemptSnapshotDocument
    const snapshotQuestions: SnapshotQuestion[] = liveQuestions.map((q) => ({
      questionId: q.id,
      position: q.position,
      body: q.body,
      bodyText: q.body,
      type: q.type,
      imagePath: q.imagePath || null,
      comparisonKey: q.comparisonKey || null,
      weight: q.weight,
      speedBonusEnabled: q.speedBonusEnabled,
      speedBonusPercent: q.speedBonusPercent,
      timeReferenceSeconds: q.timeReferenceSeconds,
      correctChoiceIds: q.choices.filter((c) => c.isCorrect).map((c) => c.id),
      choices: q.choices.map((c) => ({
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
      status: 'in_progress',
      startedAt: now,
      completedAt: null,
      lastAnswerAt: null,
      finalScore: 0,
      leaderboardPoints: 0,
      durationMs: 0,
      attemptTokenHash,
      scoringVersion: 2,
      questionSnapshots: legacySnapshots,
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

    // First question marker
    const firstQ = snapshotQuestions[0];
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

    const answerId = `${attemptId}_${input.questionId}`;
    const answerRef = this.answersCol.doc(answerId);

    const existingAns = await answerRef.get();
    if (existingAns.exists) {
      throw new ConflictError('Question has already been answered', 'ALREADY_ANSWERED');
    }

    // Load question from attempt snapshot
    const snapDoc = await this.snapshotsCol.doc(attemptId).get();
    let qSnap: SnapshotQuestion | undefined;
    let totalQuestionsCount = 0;
    let totalAvailableWeight = 0;

    if (snapDoc.exists) {
      const snapData = snapDoc.data() as AttemptSnapshotDocument;
      qSnap = snapData.questions.find((q) => q.questionId === input.questionId);
      totalQuestionsCount = snapData.questions.length;
      totalAvailableWeight = snapData.questions.reduce((sum, q) => sum + (q.weight > 0 ? q.weight : 1), 0);
    } else if (attempt.questionSnapshots) {
      const leg = attempt.questionSnapshots.find((q) => q.questionId === input.questionId);
      if (leg) {
        qSnap = {
          questionId: leg.questionId,
          position: 0,
          body: '',
          bodyText: '',
          type: leg.type,
          weight: leg.weight,
          speedBonusEnabled: leg.speedBonusEnabled,
          speedBonusPercent: leg.speedBonusPercent,
          timeReferenceSeconds: leg.timeReferenceSeconds,
          correctChoiceIds: leg.correctChoiceIds,
          choices: leg.choiceIds.map((id) => ({ id, body: '', position: 0, isCorrect: leg.correctChoiceIds.includes(id) })),
        };
      }
      totalQuestionsCount = attempt.questionSnapshots.length;
      totalAvailableWeight = attempt.questionSnapshots.reduce((sum, q) => sum + (q.weight > 0 ? q.weight : 1), 0);
    }

    if (!qSnap) throw new BadRequestError('Question not part of this attempt');

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

    // Server-authoritative timing via questionStates marker
    const markerDoc = await this.questionStatesCol.doc(`${attemptId}_${input.questionId}`).get();
    const serverReceivedAt = getClock().nowIso();
    const nowMs = new Date(serverReceivedAt).getTime();

    let officialDurationMs = 0;
    let timingSource: 'server_marker' | 'missing_marker' = 'server_marker';

    if (markerDoc.exists) {
      const markerData = markerDoc.data() as QuestionStateDocument;
      const firstEnteredAtMs = new Date(markerData.firstEnteredAt).getTime();
      officialDurationMs = Math.max(0, nowMs - firstEnteredAtMs);
      timingSource = 'server_marker';
    } else {
      // Requirement H4: Answer without reveal marker
      // correctness scored, speed bonus = 0, timingSource = "missing_marker"
      // Do not synthesize a zero duration
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

    const answerData = {
      id: answerId,
      attemptId,
      activityId: attempt.activityId,
      questionId: input.questionId,
      selectedChoiceIds: input.selectedChoiceIds,
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

    await answerRef.set(answerData);

    // Compute running totals for attempt
    const answersSnap = await this.answersCol.where('attemptId', '==', attemptId).get();
    let runningPoints = 0;
    let runningEarnedWeight = 0;
    let runningDurationMs = 0;

    answersSnap.docs.forEach((doc) => {
      const a = doc.data();
      runningPoints = Number((runningPoints + (Number(a.leaderboardPoints) || 0)).toFixed(2));
      runningEarnedWeight += Number(a.earnedWeight) || 0;
      runningDurationMs += Number(a.durationMs) || 0;
    });

    const scorePercent = calculateFinalScore(runningEarnedWeight, totalAvailableWeight || 1);

    await this.col.doc(attemptId).update({
      leaderboardPoints: runningPoints,
      finalScore: scorePercent,
      durationMs: runningDurationMs,
      lastAnswerAt: serverReceivedAt,
      updatedAt: serverReceivedAt,
    });

    // Update live leaderboard entry
    try {
      const participant = await participantsService.getById(attempt.participantId);
      await leaderboardService.recordEntry(attempt.activityId, {
        attemptId,
        participantId: attempt.participantId,
        participantCode: participant.participantCode || null,
        displayName: participant.name,
        status: 'in_progress',
        locked: false,
        leaderboardPoints: runningPoints,
        scorePercent,
        finalScore: scorePercent,
        answeredCount: answersSnap.size,
        totalQuestions: totalQuestionsCount,
        durationMs: runningDurationMs,
        rankTimeAt: serverReceivedAt,
        lastAnswerAt: serverReceivedAt,
        completedAt: null,
      });
    } catch (_e) {
      // Non-fatal if participant lookup fails
    }

    return { recorded: true, questionId: input.questionId };
  }

  async finishAttempt(attemptId: string, token?: string): Promise<{ attempt: any; summary: any }> {
    const attemptDoc = await this.col.doc(attemptId).get();
    if (!attemptDoc.exists) throw new NotFoundError(`Attempt '${attemptId}' not found`);
    const attempt = attemptDoc.data() as AttemptDocument;
    this.verifyToken(attempt, token);

    if (attempt.status === 'completed') {
      return { attempt: sanitizeAttempt(attempt), summary: { finalScore: attempt.finalScore, totalLeaderboardPoints: attempt.leaderboardPoints } };
    }

    const activity = await activitiesService.getById(attempt.activityId);
    const nowMs = getClock().now().getTime();
    const closesAtMs = new Date(activity.closesAt).getTime();
    const graceMs = (activity.settings?.finishGraceSeconds ?? 120) * 1000;

    if (nowMs > closesAtMs + graceMs) {
      throw new BadRequestError('Finish grace window has expired', 'ACTIVITY_CLOSED');
    }

    const answersSnap = await this.answersCol.where('attemptId', '==', attemptId).get();
    const answers = answersSnap.docs.map((d) => d.data() as any);

    // Load from snapshot
    let scoringQuestions: ScoringQuestion[] = [];
    let totalQuestionsCount = 0;

    const snapDoc = await this.snapshotsCol.doc(attemptId).get();
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
    } else if (attempt.questionSnapshots) {
      scoringQuestions = attempt.questionSnapshots.map((q) => ({
        id: q.questionId,
        weight: q.weight,
        speedBonusEnabled: q.speedBonusEnabled,
        speedBonusPercent: q.speedBonusPercent,
        timeReferenceSeconds: q.timeReferenceSeconds,
        correctChoiceIds: q.correctChoiceIds,
      }));
      totalQuestionsCount = attempt.questionSnapshots.length;
    }

    const outcome = calculateAttemptScores(scoringQuestions, answers);
    const completedAt = getClock().nowIso();

    const updatedData = {
      status: 'completed' as const,
      completedAt,
      finalScore: outcome.finalScore,
      leaderboardPoints: outcome.totalLeaderboardPoints,
      durationMs: outcome.totalDurationMs,
      updatedAt: completedAt,
    };

    await this.col.doc(attemptId).update(updatedData);

    try {
      const participant = await participantsService.getById(attempt.participantId);
      await leaderboardService.recordEntry(attempt.activityId, {
        attemptId,
        participantId: attempt.participantId,
        participantCode: participant.participantCode || null,
        displayName: participant.name,
        status: 'completed',
        locked: true,
        leaderboardPoints: outcome.totalLeaderboardPoints,
        scorePercent: outcome.finalScore,
        finalScore: outcome.finalScore,
        answeredCount: answers.length,
        totalQuestions: totalQuestionsCount,
        durationMs: outcome.totalDurationMs,
        rankTimeAt: completedAt,
        lastAnswerAt: attempt.lastAnswerAt || completedAt,
        completedAt,
      });
    } catch (_e) {
      // Non-fatal
    }

    const finalAttempt: AttemptDocument = { ...attempt, ...updatedData };
    return { attempt: sanitizeAttempt(finalAttempt, false), summary: outcome };
  }

  async getById(id: string, token?: string, isOperator = false): Promise<any> {
    const doc = await this.col.doc(id).get();
    if (!doc.exists) throw new NotFoundError(`Attempt '${id}' not found`);
    const attempt = doc.data() as AttemptDocument;
    this.verifyToken(attempt, token, isOperator);
    return sanitizeAttempt({ ...attempt, id: doc.id }, isOperator);
  }
}

export function sanitizeAttempt(attempt: AttemptDocument, isOperator = false): any {
  const { attemptTokenHash, questionSnapshots, ...rest } = attempt;
  const safeSnapshots = (questionSnapshots || []).map((q) => {
    if (isOperator) return q;
    const { correctChoiceIds, ...safeQ } = q;
    return safeQ;
  });
  return {
    ...rest,
    ...(questionSnapshots ? { questionSnapshots: safeSnapshots } : {}),
  };
}

export const attemptsService = new AttemptsService();
