import { describe, it, expect } from 'vitest';
import { calculateAttemptScores } from '../../src/lib/scoring';
import { attemptsService } from '../../src/modules/attempts/attempts.service';
import { LeaderboardResponseSchema } from '../../src/modules/leaderboard/leaderboard.schema';
import { ActivitySettingsSchema } from '../../src/modules/activities/activities.schema';
import {
  CreateLiveSessionSchema,
  JoinLiveSessionSchema,
  LiveParticipantHeartbeatSchema,
} from '../../src/modules/live-sessions/live-sessions.schema';

describe('Revision 02 Backend Features - Unit Tests', () => {
  describe('1. Activity Settings Schema', () => {
    it('validates activity-level time limits and leaderboard settings', () => {
      const parsed = ActivitySettingsSchema.parse({
        timeLimitEnabled: true,
        activityTimeLimitSeconds: 600,
        leaderboardEnabled: false,
        scoreVisible: true,
        rankVisible: false,
      });

      expect(parsed.timeLimitEnabled).toBe(true);
      expect(parsed.activityTimeLimitSeconds).toBe(600);
      expect(parsed.leaderboardEnabled).toBe(false);
      expect(parsed.scoreVisible).toBe(true);
      expect(parsed.rankVisible).toBe(false);
    });

    it('defaults timeLimitEnabled to false and leaderboardEnabled to true', () => {
      const parsed = ActivitySettingsSchema.parse({});
      expect(parsed.timeLimitEnabled).toBe(false);
      expect(parsed.leaderboardEnabled).toBe(true);
      expect(parsed.scoreVisible).toBe(true);
      expect(parsed.rankVisible).toBe(true);
    });
  });

  describe('2. Attempt Expiry & Authoritative Timing', () => {
    it('correctly detects expired attempts', () => {
      const pastTime = new Date(Date.now() - 10000).toISOString();
      const futureTime = new Date(Date.now() + 10000).toISOString();

      const expiredAttempt: any = {
        status: 'in_progress',
        startedAt: new Date(Date.now() - 20000).toISOString(),
        expiresAt: pastTime,
      };

      const activeAttempt: any = {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        expiresAt: futureTime,
      };

      const noLimitAttempt: any = {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        expiresAt: null,
      };

      expect(attemptsService.isAttemptExpired(expiredAttempt)).toBe(true);
      expect(attemptsService.isAttemptExpired(activeAttempt)).toBe(false);
      expect(attemptsService.isAttemptExpired(noLimitAttempt)).toBe(false);
    });
  });

  describe('3. Leaderboard Disabled Payload Schema', () => {
    it('validates explicit disabled response payload', () => {
      const disabledPayload = {
        disabled: true,
        message: 'Leaderboard is disabled for this activity',
        activityId: 'act-1',
        activityTitle: 'Quiz Test',
        slug: 'quiz-test',
        state: 'live' as const,
        top5: [],
        others: [],
        entries: [],
        totalCompleted: 0,
        totalEntries: 0,
        updatedAt: new Date().toISOString(),
      };

      const parsed = LeaderboardResponseSchema.parse(disabledPayload);
      expect(parsed.disabled).toBe(true);
      expect(parsed.message).toBe('Leaderboard is disabled for this activity');
    });
  });

  describe('4. LiveSession Schemas', () => {
    it('validates live session creation schema', () => {
      const valid = CreateLiveSessionSchema.parse({
        activityId: 'activity-abc-123',
      });
      expect(valid.activityId).toBe('activity-abc-123');
    });

    it('validates participant join schema', () => {
      const valid = JoinLiveSessionSchema.parse({
        displayName: 'John Doe',
        participantCode: 'EMP001',
      });
      expect(valid.displayName).toBe('John Doe');
      expect(valid.participantCode).toBe('EMP001');
    });

    it('validates heartbeat schema', () => {
      const valid = LiveParticipantHeartbeatSchema.parse({
        participantId: 'p-1',
        status: 'active',
      });
      expect(valid.status).toBe('active');
    });
  });
});

