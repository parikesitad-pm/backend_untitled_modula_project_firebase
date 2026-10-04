import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { seedTestOperators, clearCollection, TestAuthTokens } from '../test-helper';
import { MockClock, setSystemClock, SystemClock } from '../../src/lib/clock';

describe('Attempt Security & Server Timing Integration Tests', () => {
  let tokens: TestAuthTokens;
  let activityId: string;
  let testSlug = 'security-test-act';
  let q1Id: string;
  let q1Choice1Id: string;
  let q1Choice2Id: string;
  let mockClock: MockClock;

  beforeAll(async () => {
    mockClock = new MockClock('2026-10-01T10:00:00Z');
    setSystemClock(mockClock);

    await clearCollection('operators');
    await clearCollection('activities');
    await clearCollection('questions');
    await clearCollection('choices');
    await clearCollection('participants');
    await clearCollection('attempts');
    await clearCollection('answers');

    tokens = await seedTestOperators();

    // Create activity open from 10:00 to 12:00 with maxAttempts=1
    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        title: 'Security Activity',
        slug: testSlug,
        mode: 'quiz',
        opensAt: '2026-10-01T10:00:00Z',
        closesAt: '2026-10-01T12:00:00Z',
        settings: {
          maxAttempts: 1,
          allowMultipleAttempts: false,
          finishGraceSeconds: 60,
        },
      });
    activityId = actRes.body.data.id;

    // Add question
    const qRes = await request(app)
      .post(`/api/activities/${activityId}/questions`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        body: 'Security Question 1',
        weight: 10,
        speedBonusEnabled: true,
        speedBonusPercent: 20,
        timeReferenceSeconds: 30,
        choices: [
          { body: 'Correct', isCorrect: true },
          { body: 'Wrong', isCorrect: false },
        ],
      });
    q1Id = qRes.body.data.id;
    q1Choice1Id = qRes.body.data.choices[0].id;
    q1Choice2Id = qRes.body.data.choices[1].id;

    // Publish
    await request(app)
      .post(`/api/activities/${activityId}/publish`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);
  });

  afterAll(() => {
    setSystemClock(new SystemClock());
  });

  it('rejects attempt actions with missing X-Attempt-Token (401)', async () => {
    const startRes = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({ name: 'Bob', participantCode: 'EMP-BOB' });
    const attemptId = startRes.body.data.attempt.id;

    const res = await request(app)
      .post(`/api/attempts/${attemptId}/answers`)
      .send({
        questionId: q1Id,
        selectedChoiceIds: [q1Choice1Id],
      });
    expect(res.status).toBe(401);
  });

  it('rejects attempt actions with wrong X-Attempt-Token (401)', async () => {
    const startRes = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({ name: 'Alice', participantCode: 'EMP-ALICE' });
    const attemptId = startRes.body.data.attempt.id;

    const res = await request(app)
      .post(`/api/attempts/${attemptId}/answers`)
      .set('X-Attempt-Token', 'completely-bogus-token-1234567890123456')
      .send({
        questionId: q1Id,
        selectedChoiceIds: [q1Choice1Id],
      });
    expect(res.status).toBe(401);
  });

  it("rejects attempt actions using another attempt's valid token (401)", async () => {
    // Start attempt for Charlie
    const resA = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({ name: 'Charlie', participantCode: 'EMP-CHARLIE' });
    const attemptAId = resA.body.data.attempt.id;

    // Start attempt for Dave
    const resB = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({ name: 'Dave', participantCode: 'EMP-DAVE' });
    const attemptBToken = resB.body.data.attemptToken;

    // Attempt to submit answer to A using B's token
    const hijackRes = await request(app)
      .post(`/api/attempts/${attemptAId}/answers`)
      .set('X-Attempt-Token', attemptBToken)
      .send({
        questionId: q1Id,
        selectedChoiceIds: [q1Choice1Id],
      });
    expect(hijackRes.status).toBe(401);
  });

  it('rejects duplicate/replayed answers with 409 ALREADY_ANSWERED', async () => {
    const startRes = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({ name: 'Eve', participantCode: 'EMP-EVE' });
    const attemptId = startRes.body.data.attempt.id;
    const token = startRes.body.data.attemptToken;

    // Submit first answer
    const ans1 = await request(app)
      .post(`/api/attempts/${attemptId}/answers`)
      .set('X-Attempt-Token', token)
      .send({
        questionId: q1Id,
        selectedChoiceIds: [q1Choice1Id],
      });
    expect(ans1.status).toBe(200);

    // Replay submission for same question
    const ans2 = await request(app)
      .post(`/api/attempts/${attemptId}/answers`)
      .set('X-Attempt-Token', token)
      .send({
        questionId: q1Id,
        selectedChoiceIds: [q1Choice1Id],
      });
    expect(ans2.status).toBe(409);
    expect(ans2.body.error.code).toBe('ALREADY_ANSWERED');
  });

  it('rejects foreign choice ID that does not belong to the question (400)', async () => {
    const startRes = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({ name: 'Frank', participantCode: 'EMP-FRANK' });
    const attemptId = startRes.body.data.attempt.id;
    const token = startRes.body.data.attemptToken;

    const res = await request(app)
      .post(`/api/attempts/${attemptId}/answers`)
      .set('X-Attempt-Token', token)
      .send({
        questionId: q1Id,
        selectedChoiceIds: ['foreign-choice-id-999'],
      });
    expect(res.status).toBe(400);
  });

  it('rejects answers after finish has been called (400)', async () => {
    const startRes = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({ name: 'Grace', participantCode: 'EMP-GRACE' });
    const attemptId = startRes.body.data.attempt.id;
    const token = startRes.body.data.attemptToken;

    // Finish attempt
    await request(app)
      .post(`/api/attempts/${attemptId}/finish`)
      .set('X-Attempt-Token', token);

    // Try to answer after finish
    const res = await request(app)
      .post(`/api/attempts/${attemptId}/answers`)
      .set('X-Attempt-Token', token)
      .send({
        questionId: q1Id,
        selectedChoiceIds: [q1Choice1Id],
      });
    expect(res.status).toBe(400);
  });

  it('enforces server-authoritative timing (ignores client-sent durationMs)', async () => {
    mockClock.setTime('2026-10-01T10:30:00Z');

    const startRes = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({ name: 'Heidi', participantCode: 'EMP-HEIDI' });
    const attemptId = startRes.body.data.attempt.id;
    const token = startRes.body.data.attemptToken;

    // Advance server clock by exactly 10 seconds
    mockClock.advanceSeconds(10);

    // Client falsely claims it took 1 millisecond
    await request(app)
      .post(`/api/attempts/${attemptId}/answers`)
      .set('X-Attempt-Token', token)
      .send({
        questionId: q1Id,
        selectedChoiceIds: [q1Choice1Id],
        durationMs: 1, // forged client duration
      });

    // Finish attempt
    const finishRes = await request(app)
      .post(`/api/attempts/${attemptId}/finish`)
      .set('X-Attempt-Token', token);

    // Server-computed total duration must be >= 10,000 ms, NOT 1 ms
    expect(finishRes.body.data.summary.totalDurationMs).toBeGreaterThanOrEqual(10000);
  });

  it('blocks starting a second attempt when maxAttempts=1 is reached', async () => {
    // Participant EMP-HEIDI already started an attempt above with maxAttempts=1
    const duplicateStart = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({ name: 'Heidi', participantCode: 'EMP-HEIDI' });
    expect(duplicateStart.status).toBe(409);
    expect(duplicateStart.body.error.code).toBe('MAX_ATTEMPTS_REACHED');
  });

  it('rejects finish when after close time + grace window', async () => {
    mockClock.setTime('2026-10-01T11:59:00Z'); // close is 12:00:00
    const startRes = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({ name: 'Late', participantCode: 'EMP-LATE' });
    const attemptId = startRes.body.data.attempt.id;
    const token = startRes.body.data.attemptToken;

    // Advance clock past 12:00:00 + 60s grace -> 12:02:00
    mockClock.setTime('2026-10-01T12:02:00Z');

    const finishRes = await request(app)
      .post(`/api/attempts/${attemptId}/finish`)
      .set('X-Attempt-Token', token);
    expect(finishRes.status).toBe(400);
    expect(finishRes.body.error.code).toBe('ACTIVITY_CLOSED');
  });
});
