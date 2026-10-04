export interface ScoringQuestion {
  id: string;
  weight: number;
  speedBonusEnabled: boolean;
  speedBonusPercent?: number;
  timeReferenceSeconds?: number;
  correctChoiceIds: string[];
}

export interface ScoringAnswerInput {
  questionId: string;
  selectedChoiceIds: string[];
  enteredAt: string | number | Date;
  answeredAt: string | number | Date;
  durationMs?: number;
}

export interface ScoredQuestionResult {
  questionId: string;
  isCorrect: boolean;
  weight: number;
  earnedWeight: number;
  speedBonus: number;
  leaderboardPoints: number;
  durationMs: number;
}

export interface OverallScoreResult {
  totalWeight: number;
  earnedWeight: number;
  finalScore: number;
  totalLeaderboardPoints: number;
  totalDurationMs: number;
  correctCount: number;
  totalQuestions: number;
  perQuestion: ScoredQuestionResult[];
}

export function calculateDurationMs(
  enteredAt: string | number | Date,
  answeredAt: string | number | Date,
  providedDurationMs?: number
): number {
  if (typeof providedDurationMs === 'number' && providedDurationMs >= 0) {
    return Math.floor(providedDurationMs);
  }
  const start = new Date(enteredAt).getTime();
  const end = new Date(answeredAt).getTime();
  return Math.max(0, end - start);
}

export function isAnswerCorrect(selectedChoiceIds: string[], correctChoiceIds: string[]): boolean {
  if (selectedChoiceIds.length !== correctChoiceIds.length) {
    return false;
  }
  const correctSet = new Set(correctChoiceIds);
  return selectedChoiceIds.every((id) => correctSet.has(id));
}

export function calculateQuestionScore(
  question: ScoringQuestion,
  answerInput: ScoringAnswerInput
): ScoredQuestionResult {
  const durationMs = calculateDurationMs(answerInput.enteredAt, answerInput.answeredAt, answerInput.durationMs);
  const correct = isAnswerCorrect(answerInput.selectedChoiceIds, question.correctChoiceIds);
  const weight = question.weight > 0 ? question.weight : 1;

  if (!correct) {
    return {
      questionId: question.id,
      isCorrect: false,
      weight,
      earnedWeight: 0,
      speedBonus: 0,
      leaderboardPoints: 0,
      durationMs,
    };
  }

  let speedBonus = 0;
  const refSeconds = question.timeReferenceSeconds ?? 30;
  const refMs = refSeconds * 1000;

  if (question.speedBonusEnabled && refMs > 0 && durationMs < refMs) {
    const capPercent = Math.max(0, Math.min(100, question.speedBonusPercent ?? 20));
    const speedRatio = Math.max(0, Math.min(1, (refMs - durationMs) / refMs));
    speedBonus = Number((weight * (capPercent / 100) * speedRatio).toFixed(2));
  }

  const leaderboardPoints = Number((weight + speedBonus).toFixed(2));

  return {
    questionId: question.id,
    isCorrect: true,
    weight,
    earnedWeight: weight,
    speedBonus,
    leaderboardPoints,
    durationMs,
  };
}

export function calculateFinalScore(earnedWeight: number, totalWeight: number): number {
  if (totalWeight <= 0) return 0;
  const raw = (earnedWeight / totalWeight) * 100;
  return Number(Math.min(100, Math.max(0, raw)).toFixed(2));
}

export function calculateAttemptScores(
  questions: ScoringQuestion[],
  answers: ScoringAnswerInput[]
): OverallScoreResult {
  const answerMap = new Map<string, ScoringAnswerInput>();
  answers.forEach((ans) => answerMap.set(ans.questionId, ans));

  let totalWeight = 0;
  let earnedWeight = 0;
  let totalLeaderboardPoints = 0;
  let totalDurationMs = 0;
  let correctCount = 0;
  const perQuestion: ScoredQuestionResult[] = [];

  for (const question of questions) {
    const qWeight = question.weight > 0 ? question.weight : 1;
    totalWeight += qWeight;

    const answer = answerMap.get(question.id);
    if (!answer) {
      perQuestion.push({
        questionId: question.id,
        isCorrect: false,
        weight: qWeight,
        earnedWeight: 0,
        speedBonus: 0,
        leaderboardPoints: 0,
        durationMs: 0,
      });
      continue;
    }

    const result = calculateQuestionScore(question, answer);
    perQuestion.push(result);
    totalDurationMs += result.durationMs;

    if (result.isCorrect) {
      correctCount += 1;
      earnedWeight += result.earnedWeight;
      totalLeaderboardPoints = Number((totalLeaderboardPoints + result.leaderboardPoints).toFixed(2));
    }
  }

  const finalScore = calculateFinalScore(earnedWeight, totalWeight);

  return {
    totalWeight,
    earnedWeight,
    finalScore,
    totalLeaderboardPoints,
    totalDurationMs,
    correctCount,
    totalQuestions: questions.length,
    perQuestion,
  };
}
