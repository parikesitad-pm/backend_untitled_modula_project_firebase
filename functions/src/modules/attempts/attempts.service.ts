import { db } from '../../config/firebase';
import { NotFoundError, BadRequestError } from '../../lib/errors';
import { activitiesService } from '../activities/activities.service';
import { questionsService } from '../questions/questions.service';
import { participantsService, ParticipantDocument } from '../participants/participants.service';
import { ParticipantInput } from '../participants/participants.schema';
import { SubmitAnswerInput } from './attempts.schema';
import { calculateQuestionScore, calculateAttemptScores, ScoringQuestion } from '../../lib/scoring';

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
}

export class AttemptsService {
  private col = db.collection('attempts');
  private answersCol = db.collection('answers');

  private assertActivityAccess(activity: any): void {
    if (activity.status !== 'published') {
      throw new BadRequestError('Activity is not published', 'ACTIVITY_NOT_PUBLISHED');
    }
    const now = Date.now();
    const opens = new Date(activity.opensAt).getTime();
    const closes = new Date(activity.closesAt).getTime();

    if (now < opens) {
      throw new BadRequestError('Activity has not opened yet', 'ACTIVITY_NOT_STARTED');
    }
    if (now > closes) {
      throw new BadRequestError('Activity has closed', 'ACTIVITY_CLOSED');
    }
  }

  async startAttempt(slug: string, input: ParticipantInput): Promise<{ attempt: AttemptDocument; participant: ParticipantDocument }> {
    const activity = await activitiesService.getBySlug(slug);
    this.assertActivityAccess(activity);

    const participant = await participantsService.findOrCreate(activity.id, input);

    if (!activity.settings?.allowMultipleAttempts) {
      const existing = await this.col
        .where('activityId', '==', activity.id)
        .where('participantId', '==', participant.id)
        .get();

      const completed = existing.docs.find((d) => d.data().status === 'completed');
      if (completed) {
        throw new BadRequestError('Multiple attempts are not allowed for this activity', 'ATTEMPT_LIMIT_REACHED');
      }
      const inProgress = existing.docs.find((d) => d.data().status === 'in_progress');
      if (inProgress) {
        return { attempt: { id: inProgress.id, ...inProgress.data() } as AttemptDocument, participant };
      }
    }

    const docRef = this.col.doc();
    const attempt: AttemptDocument = {
      id: docRef.id,
      activityId: activity.id,
      participantId: participant.id,
      status: 'in_progress',
      startedAt: new Date().toISOString(),
      completedAt: null,
      finalScore: 0,
      leaderboardPoints: 0,
      durationMs: 0,
    };

    await docRef.set(attempt);
    return { attempt, participant };
  }

  async submitAnswer(attemptId: string, input: SubmitAnswerInput): Promise<{ recorded: boolean; questionId: string }> {
    const attemptDoc = await this.col.doc(attemptId).get();
    if (!attemptDoc.exists) throw new NotFoundError(`Attempt '${attemptId}' not found`);
    const attempt = attemptDoc.data() as AttemptDocument;

    if (attempt.status !== 'in_progress') {
      throw new BadRequestError('Attempt is not in progress', 'ATTEMPT_NOT_IN_PROGRESS');
    }

    const question = await questionsService.getById(input.questionId, false);
    if (question.activityId !== attempt.activityId) {
      throw new BadRequestError('Question does not belong to this activity');
    }

    const correctChoiceIds = question.choices.filter((c) => c.isCorrect).map((c) => c.id);
    const scored = calculateQuestionScore(
      {
        id: question.id,
        weight: question.weight,
        speedBonusEnabled: question.speedBonusEnabled,
        speedBonusPercent: question.speedBonusPercent,
        timeReferenceSeconds: question.timeReferenceSeconds,
        correctChoiceIds,
      },
      input
    );

    const answerId = `${attemptId}_${input.questionId}`;
    await this.answersCol.doc(answerId).set({
      id: answerId,
      attemptId,
      activityId: attempt.activityId,
      questionId: input.questionId,
      selectedChoiceIds: input.selectedChoiceIds,
      isCorrect: scored.isCorrect,
      enteredAt: input.enteredAt,
      answeredAt: input.answeredAt,
      durationMs: scored.durationMs,
      earnedWeight: scored.earnedWeight,
      speedBonus: scored.speedBonus,
      leaderboardPoints: scored.leaderboardPoints,
      changeCount: input.changeCount || 0,
    });

    return { recorded: true, questionId: input.questionId };
  }

  async finishAttempt(attemptId: string): Promise<{ attempt: AttemptDocument; summary: any }> {
    const attemptDoc = await this.col.doc(attemptId).get();
    if (!attemptDoc.exists) throw new NotFoundError(`Attempt '${attemptId}' not found`);
    const attempt = attemptDoc.data() as AttemptDocument;

    if (attempt.status !== 'in_progress') {
      throw new BadRequestError('Attempt is not in progress', 'ATTEMPT_NOT_IN_PROGRESS');
    }

    const questions = await questionsService.getByActivityId(attempt.activityId, false);
    const answersSnap = await this.answersCol.where('attemptId', '==', attemptId).get();
    const answers = answersSnap.docs.map((d) => d.data() as any);

    const scoringQuestions: ScoringQuestion[] = questions.map((q) => ({
      id: q.id,
      weight: q.weight,
      speedBonusEnabled: q.speedBonusEnabled,
      speedBonusPercent: q.speedBonusPercent,
      timeReferenceSeconds: q.timeReferenceSeconds,
      correctChoiceIds: q.choices.filter((c) => c.isCorrect).map((c) => c.id),
    }));

    const outcome = calculateAttemptScores(scoringQuestions, answers);
    const completedAt = new Date().toISOString();

    const updatedData = {
      status: 'completed',
      completedAt,
      finalScore: outcome.finalScore,
      leaderboardPoints: outcome.totalLeaderboardPoints,
      durationMs: outcome.totalDurationMs,
    };

    await this.col.doc(attemptId).update(updatedData);

    const finalAttempt: AttemptDocument = {
      ...attempt,
      ...updatedData,
      status: 'completed',
    };

    return { attempt: finalAttempt, summary: outcome };
  }

  async getById(id: string): Promise<AttemptDocument> {
    const doc = await this.col.doc(id).get();
    if (!doc.exists) throw new NotFoundError(`Attempt '${id}' not found`);
    return { id: doc.id, ...doc.data() } as AttemptDocument;
  }
}

export const attemptsService = new AttemptsService();
