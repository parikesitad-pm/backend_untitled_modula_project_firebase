import { db } from '../../config/firebase';
import { NotFoundError, BadRequestError, ConflictError, UnauthorizedError } from '../../lib/errors';
import { activitiesService, ActivityDocument } from '../activities/activities.service';
import { questionsService } from '../questions/questions.service';
import { participantsService, ParticipantDocument } from '../participants/participants.service';
import { ParticipantInput } from '../participants/participants.schema';
import { SubmitAnswerInput } from './attempts.schema';
import { calculateQuestionScore, calculateAttemptScores, ScoringQuestion } from '../../lib/scoring';
import { generateSecureToken, hashTokenSha256, timingSafeEqualString } from '../../lib/hash';
import { getClock } from '../../lib/clock';
import { leaderboardService } from '../leaderboard/leaderboard.service';

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
  status: 'in_progress' | 'completed' | 'abandoned';
  startedAt: string;
  completedAt: string | null;
  finalScore: number;
  leaderboardPoints: number;
  durationMs: number;
  attemptTokenHash: string;
  scoringVersion: number;
  questionSnapshots: QuestionSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export class AttemptsService {
  private col = db.collection('attempts');
  private answersCol = db.collection('answers');

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
    if (now > new Date(activity.closesAt).getTime()) {
      throw new BadRequestError('Activity has closed', 'ACTIVITY_CLOSED');
    }
  }

  async startAttempt(
    slug: string,
    input: ParticipantInput
  ): Promise<{ attemptToken: string; attempt: AttemptDocument; participant: ParticipantDocument }> {
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
    const questions = await questionsService.getByActivityId(activity.id, false);
    const questionSnapshots: QuestionSnapshot[] = questions.map((q) => ({
      questionId: q.id,
      weight: q.weight,
      type: q.type,
      speedBonusEnabled: q.speedBonusEnabled,
      speedBonusPercent: q.speedBonusPercent,
      timeReferenceSeconds: q.timeReferenceSeconds,
      correctChoiceIds: q.choices.filter((c) => c.isCorrect).map((c) => c.id),
      choiceIds: q.choices.map((c) => c.id),
    }));

    const now = getClock().nowIso();
    const docRef = this.col.doc();
    const attempt: AttemptDocument = {
      id: docRef.id,
      activityId: activity.id,
      participantId: participant.id,
      status: 'in_progress',
      startedAt: now,
      completedAt: null,
      finalScore: 0,
      leaderboardPoints: 0,
      durationMs: 0,
      attemptTokenHash,
      scoringVersion: 1,
      questionSnapshots,
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(attempt);
    return { attemptToken: rawToken, attempt: sanitizeAttempt(attempt), participant };
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
    const nowMs = getClock().now().getTime();
    if (nowMs > new Date(activity.closesAt).getTime()) {
      throw new BadRequestError('Activity has closed', 'ACTIVITY_CLOSED');
    }

    const answerId = `${attemptId}_${input.questionId}`;
    const answerRef = this.answersCol.doc(answerId);

    const existingAns = await answerRef.get();
    if (existingAns.exists) {
      throw new ConflictError('Question has already been answered', 'ALREADY_ANSWERED');
    }

    const qSnap = attempt.questionSnapshots.find((q) => q.questionId === input.questionId);
    if (!qSnap) throw new BadRequestError('Question not part of this attempt');

    const validChoices = new Set(qSnap.choiceIds);
    if (!input.selectedChoiceIds.every((id) => validChoices.has(id))) {
      throw new BadRequestError('Foreign choice id detected');
    }
    if (new Set(input.selectedChoiceIds).size !== input.selectedChoiceIds.length) {
      throw new BadRequestError('Duplicate choice ids selected');
    }
    if (qSnap.type === 'multiple_choice' && qSnap.correctChoiceIds.length <= 1 && input.selectedChoiceIds.length > 1) {
      throw new BadRequestError('Single choice question cannot have multiple selections');
    }

    // Server-authoritative duration calculation
    const allAnswersSnap = await this.answersCol.where('attemptId', '==', attemptId).get();
    let lastTimeMs = new Date(attempt.startedAt).getTime();
    allAnswersSnap.docs.forEach((d) => {
      const serverTime = new Date(d.data().serverReceivedAt).getTime();
      if (serverTime > lastTimeMs) lastTimeMs = serverTime;
    });

    const officialDurationMs = Math.max(0, nowMs - lastTimeMs);
    const scored = calculateQuestionScore(
      {
        id: qSnap.questionId,
        weight: qSnap.weight,
        speedBonusEnabled: qSnap.speedBonusEnabled,
        speedBonusPercent: qSnap.speedBonusPercent,
        timeReferenceSeconds: qSnap.timeReferenceSeconds,
        correctChoiceIds: qSnap.correctChoiceIds,
      },
      {
        questionId: input.questionId,
        selectedChoiceIds: input.selectedChoiceIds,
        enteredAt: input.enteredAt || attempt.startedAt,
        answeredAt: input.answeredAt || getClock().nowIso(),
        durationMs: officialDurationMs,
      }
    );

    const serverReceivedAt = getClock().nowIso();
    await answerRef.set({
      id: answerId,
      attemptId,
      activityId: attempt.activityId,
      questionId: input.questionId,
      selectedChoiceIds: input.selectedChoiceIds,
      isCorrect: scored.isCorrect,
      serverReceivedAt,
      clientEnteredAt: input.enteredAt,
      clientAnsweredAt: input.answeredAt,
      durationMs: officialDurationMs,
      earnedWeight: scored.earnedWeight,
      speedBonus: scored.speedBonus,
      leaderboardPoints: scored.leaderboardPoints,
      changeCount: input.changeCount || 0,
    });

    return { recorded: true, questionId: input.questionId };
  }

  async finishAttempt(attemptId: string, token?: string): Promise<{ attempt: AttemptDocument; summary: any }> {
    const attemptDoc = await this.col.doc(attemptId).get();
    if (!attemptDoc.exists) throw new NotFoundError(`Attempt '${attemptId}' not found`);
    const attempt = attemptDoc.data() as AttemptDocument;
    this.verifyToken(attempt, token);

    if (attempt.status === 'completed') {
      return { attempt, summary: { finalScore: attempt.finalScore, totalLeaderboardPoints: attempt.leaderboardPoints } };
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
    const scoringQuestions: ScoringQuestion[] = attempt.questionSnapshots.map((q) => ({
      id: q.questionId,
      weight: q.weight,
      speedBonusEnabled: q.speedBonusEnabled,
      speedBonusPercent: q.speedBonusPercent,
      timeReferenceSeconds: q.timeReferenceSeconds,
      correctChoiceIds: q.correctChoiceIds,
    }));

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
    await leaderboardService.rebuildLeaderboardSnapshot(attempt.activityId);
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
    questionSnapshots: safeSnapshots,
  };
}

export const attemptsService = new AttemptsService();
