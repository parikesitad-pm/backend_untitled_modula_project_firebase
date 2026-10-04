import { describe, it, expect } from 'vitest';
import {
  calculateDurationMs,
  isAnswerCorrect,
  calculateQuestionScore,
  calculateFinalScore,
  calculateAttemptScores,
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

    it('awards 0 earned weight, 0 speed bonus, and 0 leaderboard points for wrong answer', () => {
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

    it('calculates speed bonus when answered fast and speed bonus is enabled', () => {
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

    it('respects speedBonusEnabled=false', () => {
      const noSpeedQ: ScoringQuestion = { ...question, speedBonusEnabled: false };
      const result = calculateQuestionScore(noSpeedQ, {
        questionId: 'q1',
        selectedChoiceIds: ['c1'],
        enteredAt: '2026-01-01T00:00:00Z',
        answeredAt: '2026-01-01T00:00:01Z',
        durationMs: 1000,
      });

      expect(result.isCorrect).toBe(true);
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

  describe('calculateAttemptScores', () => {
    it('aggregates multiple questions with custom weights and speed bonus', () => {
      const questions: ScoringQuestion[] = [
        {
          id: 'q1',
          weight: 1,
          speedBonusEnabled: true,
          speedBonusPercent: 20,
          timeReferenceSeconds: 10,
          correctChoiceIds: ['c1'],
        },
        {
          id: 'q2',
          weight: 3,
          speedBonusEnabled: false,
          correctChoiceIds: ['c3'],
        },
      ];

      const answers = [
        {
          questionId: 'q1',
          selectedChoiceIds: ['c1'],
          enteredAt: '2026-01-01T00:00:00Z',
          answeredAt: '2026-01-01T00:00:05Z',
          durationMs: 5000,
        },
        {
          questionId: 'q2',
          selectedChoiceIds: ['c3'],
          enteredAt: '2026-01-01T00:00:00Z',
          answeredAt: '2026-01-01T00:00:08Z',
          durationMs: 8000,
        },
      ];

      const outcome = calculateAttemptScores(questions, answers);
      expect(outcome.totalWeight).toBe(4);
      expect(outcome.earnedWeight).toBe(4);
      expect(outcome.finalScore).toBe(100);
      expect(outcome.correctCount).toBe(2);
      expect(outcome.totalDurationMs).toBe(13000);
      // q1: 1 + 0.10 speedBonus = 1.10. q2: 3 + 0 = 3. Total points = 4.10
      expect(outcome.totalLeaderboardPoints).toBe(4.1);
    });
  });
});
