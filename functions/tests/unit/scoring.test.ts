import { describe, it, expect } from 'vitest';
import {
  calculateDurationMs,
  isAnswerCorrect,
  calculateQuestionScore,
  calculateFinalScore,
  calculateAttemptScores,
  compareLeaderboardEntries,
  ScoringQuestion,
} from '../../src/lib/scoring';

describe('Scoring Module', () => {
  describe('calculateDurationMs', () => {
    it('uses provided duration if valid', () => {
      const ms = calculateDurationMs('2026-01-01T00:00:00Z', '2026-01-01T00:00:10Z', 5000);
      expect(ms).toBe(5000);
    });

    it('calculates duration between timestamps if not provided', () => {
      const ms = calculateDurationMs('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:04.500Z');
      expect(ms).toBe(4500);
    });

    it('never returns negative duration', () => {
      const ms = calculateDurationMs('2026-01-01T00:00:10Z', '2026-01-01T00:00:00Z');
      expect(ms).toBe(0);
    });
  });

  describe('isAnswerCorrect', () => {
    it('returns true when exact choices match', () => {
      expect(isAnswerCorrect(['c1', 'c2'], ['c2', 'c1'])).toBe(true);
    });

    it('returns false when choice sets differ in length or content', () => {
      expect(isAnswerCorrect(['c1'], ['c1', 'c2'])).toBe(false);
      expect(isAnswerCorrect(['c1', 'c3'], ['c1', 'c2'])).toBe(false);
    });
  });

  describe('calculateQuestionScore', () => {
    const question: ScoringQuestion = {
      id: 'q1',
      weight: 2,
      speedBonusEnabled: true,
      speedBonusPercent: 20,
      timeReferenceSeconds: 10,
      correctChoiceIds: ['c1'],
    };

    it('scores correct answer without speed bonus', () => {
      const qNoSpeed: ScoringQuestion = { ...question, speedBonusEnabled: false };
      const result = calculateQuestionScore(qNoSpeed, {
        questionId: 'q1',
        selectedChoiceIds: ['c1'],
        enteredAt: '2026-01-01T00:00:00Z',
        answeredAt: '2026-01-01T00:00:02Z',
        durationMs: 2000,
      });

      expect(result.isCorrect).toBe(true);
      expect(result.earnedWeight).toBe(2);
      expect(result.speedBonus).toBe(0);
      expect(result.leaderboardPoints).toBe(2);
    });

    it('scores wrong answer with zero points', () => {
      const result = calculateQuestionScore(question, {
        questionId: 'q1',
        selectedChoiceIds: ['wrong'],
        enteredAt: '2026-01-01T00:00:00Z',
        answeredAt: '2026-01-01T00:00:02Z',
        durationMs: 2000,
      });

      expect(result.isCorrect).toBe(false);
      expect(result.earnedWeight).toBe(0);
      expect(result.speedBonus).toBe(0);
      expect(result.leaderboardPoints).toBe(0);
      expect(result.durationMs).toBe(2000);
    });

    it('applies speed bonus when answered fast and speed bonus is enabled', () => {
      // 5 seconds out of 10s -> speedRatio = 0.5. Cap is 20% of weight (2) = 0.4.
      // speedBonus = 2 * 0.20 * 0.5 = 0.20. Leaderboard points = 2 + 0.20 = 2.20
      const result = calculateQuestionScore(question, {
        questionId: 'q1',
        selectedChoiceIds: ['c1'],
        enteredAt: '2026-01-01T00:00:00Z',
        answeredAt: '2026-01-01T00:00:05Z',
        durationMs: 5000,
      });

      expect(result.isCorrect).toBe(true);
      expect(result.earnedWeight).toBe(2);
      expect(result.speedBonus).toBe(0.2);
      expect(result.leaderboardPoints).toBe(2.2);
    });

    it('awards 0 speed bonus if answered after time reference', () => {
      const result = calculateQuestionScore(question, {
        questionId: 'q1',
        selectedChoiceIds: ['c1'],
        enteredAt: '2026-01-01T00:00:00Z',
        answeredAt: '2026-01-01T00:00:15Z',
        durationMs: 15000,
      });

      expect(result.isCorrect).toBe(true);
      expect(result.earnedWeight).toBe(2);
      expect(result.speedBonus).toBe(0);
      expect(result.leaderboardPoints).toBe(2);
    });
  });

  describe('calculateFinalScore', () => {
    it('computes percentage correctly', () => {
      expect(calculateFinalScore(8, 10)).toBe(80);
      expect(calculateFinalScore(1, 3)).toBe(33.33);
      expect(calculateFinalScore(0, 10)).toBe(0);
      expect(calculateFinalScore(5, 0)).toBe(0);
    });
  });

  describe('calculateAttemptScores - Split Tests', () => {
    it('calculates score for correct answers', () => {
      const questions: ScoringQuestion[] = [
        { id: 'q1', weight: 1, correctChoiceIds: ['c1'] },
      ];
      const answers = [
        { questionId: 'q1', selectedChoiceIds: ['c1'], durationMs: 2000 },
      ];
      const outcome = calculateAttemptScores(questions, answers);
      expect(outcome.correctCount).toBe(1);
      expect(outcome.earnedWeight).toBe(1);
      expect(outcome.finalScore).toBe(100);
    });

    it('calculates score for wrong answers', () => {
      const questions: ScoringQuestion[] = [
        { id: 'q1', weight: 1, correctChoiceIds: ['c1'] },
      ];
      const answers = [
        { questionId: 'q1', selectedChoiceIds: ['c2'], durationMs: 2000 },
      ];
      const outcome = calculateAttemptScores(questions, answers);
      expect(outcome.correctCount).toBe(0);
      expect(outcome.earnedWeight).toBe(0);
      expect(outcome.finalScore).toBe(0);
    });

    it('calculates custom weight contribution correctly', () => {
      const questions: ScoringQuestion[] = [
        { id: 'q1', weight: 1, correctChoiceIds: ['c1'] },
        { id: 'q2', weight: 4, correctChoiceIds: ['c2'] },
      ];
      const answers = [
        { questionId: 'q1', selectedChoiceIds: ['c1'], durationMs: 1000 }, // 1 earned
        { questionId: 'q2', selectedChoiceIds: ['wrong'], durationMs: 1000 }, // 0 earned
      ];
      const outcome = calculateAttemptScores(questions, answers);
      expect(outcome.totalWeight).toBe(5);
      expect(outcome.earnedWeight).toBe(1);
      expect(outcome.finalScore).toBe(20); // 1/5 = 20%
    });

    it('calculates speed bonus contribution into leaderboard points', () => {
      const questions: ScoringQuestion[] = [
        {
          id: 'q1',
          weight: 2,
          speedBonusEnabled: true,
          speedBonusPercent: 20,
          timeReferenceSeconds: 10,
          correctChoiceIds: ['c1'],
        },
      ];
      const answers = [
        { questionId: 'q1', selectedChoiceIds: ['c1'], durationMs: 0 }, // instant -> max bonus (0.4)
      ];
      const outcome = calculateAttemptScores(questions, answers);
      expect(outcome.totalLeaderboardPoints).toBe(2.4);
    });

    it('calculates total attempt duration as sum of question durations', () => {
      const questions: ScoringQuestion[] = [
        { id: 'q1', weight: 1, correctChoiceIds: ['c1'] },
        { id: 'q2', weight: 1, correctChoiceIds: ['c2'] },
      ];
      const answers = [
        { questionId: 'q1', selectedChoiceIds: ['c1'], durationMs: 3500 },
        { questionId: 'q2', selectedChoiceIds: ['c2'], durationMs: 4500 },
      ];
      const outcome = calculateAttemptScores(questions, answers);
      expect(outcome.totalDurationMs).toBe(8000);
    });
  });

  describe('compareLeaderboardEntries - Comparator Ties', () => {
    it('breaks ties using points desc, finalScore desc, duration asc, completedAt asc, attemptId asc', () => {
      const base = {
        attemptId: 'att-b',
        finalScore: 100,
        leaderboardPoints: 10,
        durationMs: 5000,
        completedAt: '2026-01-01T00:00:00Z',
      };

      // 1. Points difference (higher points is better -> should come before, negative diff)
      const higherPoints = { ...base, attemptId: 'att-a', leaderboardPoints: 12 };
      expect(compareLeaderboardEntries(higherPoints, base)).toBeLessThan(0);

      // 2. Points equal, finalScore difference
      const higherScore = { ...base, attemptId: 'att-c', leaderboardPoints: 10, finalScore: 90 };
      expect(compareLeaderboardEntries(base, higherScore)).toBeLessThan(0);

      // 3. Score equal, duration difference (lower duration is better)
      const faster = { ...base, attemptId: 'att-d', durationMs: 4000 };
      expect(compareLeaderboardEntries(faster, base)).toBeLessThan(0);

      // 4. Duration equal, earlier completion date is better
      const earlier = { ...base, attemptId: 'att-e', completedAt: '2025-12-31T23:59:59Z' };
      expect(compareLeaderboardEntries(earlier, base)).toBeLessThan(0);

      // 5. Complete tie broken by attemptId asc
      const attA = { ...base, attemptId: 'att-1' };
      const attB = { ...base, attemptId: 'att-2' };
      expect(compareLeaderboardEntries(attA, attB)).toBeLessThan(0);
    });

    it('handles scorePercent and in_progress lastAnswerAt correctly', () => {
      const liveEntry1 = {
        attemptId: 'live-1',
        leaderboardPoints: 5,
        scorePercent: 50,
        status: 'in_progress',
        durationMs: 3000,
        lastAnswerAt: '2026-01-01T10:00:00Z',
        completedAt: null,
      };

      const liveEntry2 = {
        attemptId: 'live-2',
        leaderboardPoints: 5,
        scorePercent: 40,
        status: 'in_progress',
        durationMs: 3000,
        lastAnswerAt: '2026-01-01T10:00:00Z',
        completedAt: null,
      };

      // Higher scorePercent ranks first
      expect(compareLeaderboardEntries(liveEntry1, liveEntry2)).toBeLessThan(0);

      // Same scorePercent, earlier lastAnswerAt ranks first
      const liveEntry3 = {
        ...liveEntry1,
        attemptId: 'live-3',
        lastAnswerAt: '2026-01-01T09:59:00Z',
      };
      expect(compareLeaderboardEntries(liveEntry3, liveEntry1)).toBeLessThan(0);

      // Completed entry uses completedAt
      const completedEntry = {
        attemptId: 'comp-1',
        leaderboardPoints: 5,
        scorePercent: 50,
        status: 'completed',
        durationMs: 3000,
        lastAnswerAt: '2026-01-01T08:00:00Z',
        completedAt: '2026-01-01T10:05:00Z',
      };
      // liveEntry1 lastAnswerAt 10:00 is earlier than completedEntry completedAt 10:05
      expect(compareLeaderboardEntries(liveEntry1, completedEntry)).toBeLessThan(0);
    });
  });
});
