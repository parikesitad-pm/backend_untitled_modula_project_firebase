import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { seedTestOperators, clearCollection } from '../test-helper';

describe('Attempts, Scoring, Leaderboard & Stats Integration Tests', () => {
  let ownerToken: string;
  let testSlug = 'math-challenge';
  let activityId: string;
  let q1Id: string;
  let q2Id: string;
  let q1CorrectChoiceId: string;
  let q1WrongChoiceId: string;
  let q2CorrectChoiceId: string;

  beforeAll(async () => {
    await clearCollection('operators');
    await clearCollection('activities');
    await clearCollection('questions');
    await clearCollection('choices');
    await clearCollection('participants');
    await clearCollection('attempts');
    await clearCollection('answers');
    await clearCollection('leaderboardSnapshots');
    await clearCollection('statsSnapshots');

    const tokens = await seedTestOperators();
    ownerToken = tokens.ownerToken;

    // Create activity
    const nowOpen = new Date(Date.now() - 3600000).toISOString();
    const nowClose = new Date(Date.now() + 86400000).toISOString();

    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Math Challenge',
        slug: testSlug,
        mode: 'quiz',
        phase: 'pre',
        groupId: 'math-group-2026',
        opensAt: nowOpen,
        closesAt: nowClose,
      });
    activityId = actRes.body.data.id;

    // Question 1: weight 1, speedBonusEnabled true
    const q1Res = await request(app)
      .post(`/api/activities/${activityId}/questions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        body: 'What is 2 + 2?',
        weight: 1,
        speedBonusEnabled: true,
        speedBonusPercent: 20,
        timeReferenceSeconds: 10,
        choices: [
          { body: '4', isCorrect: true },
          { body: '5', isCorrect: false },
        ],
      });
    q1Id = q1Res.body.data.id;
    q1CorrectChoiceId = q1Res.body.data.choices.find((c: any) => c.isCorrect).id;
    q1WrongChoiceId = q1Res.body.data.choices.find((c: any) => !c.isCorrect).id;

    // Question 2: weight 3, speedBonusEnabled false (custom question weight)
    const q2Res = await request(app)
      .post(`/api/activities/${activityId}/questions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        body: 'What is 10 * 10?',
        weight: 3,
        speedBonusEnabled: false,
        choices: [
          { body: '100', isCorrect: true },
          { body: '1000', isCorrect: false },
        ],
      });
    q2Id = q2Res.body.data.id;
    q2CorrectChoiceId = q2Res.body.data.choices.find((c: any) => c.isCorrect).id;

    // Publish activity
    await request(app)
      .post(`/api/activities/${activityId}/publish`)
      .set('Authorization', `Bearer ${ownerToken}`);
  });

  // 10. start attempt
  let attempt1Id: string;
  it('10. allows participant to start attempt', async () => {
    const res = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({
        name: 'Alice Wonder',
        participantCode: 'EMP-01',
        division: 'Tech',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.attempt.status).toBe('in_progress');
    attempt1Id = res.body.data.attempt.id;
  });

  // 11. submit correct answer & 14. speed bonus calculation
  it('11 & 14. submits correct answer and calculates speed bonus', async () => {
    const res = await request(app)
      .post(`/api/attempts/${attempt1Id}/answers`)
      .send({
        questionId: q1Id,
        selectedChoiceIds: [q1CorrectChoiceId],
        enteredAt: '2026-01-01T00:00:00Z',
        answeredAt: '2026-01-01T00:00:05Z',
        durationMs: 5000,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.recorded).toBe(true);
  });

  // 12. submit wrong answer & 13. custom question weight & 15. final score
  it('12, 13 & 15. submits wrong answer and computes final score with weights', async () => {
    // Participant 1 submits correct for question 2 as well
    await request(app)
      .post(`/api/attempts/${attempt1Id}/answers`)
      .send({
        questionId: q2Id,
        selectedChoiceIds: [q2CorrectChoiceId],
        enteredAt: '2026-01-01T00:00:00Z',
        answeredAt: '2026-01-01T00:00:10Z',
        durationMs: 10000,
      });

    const finishRes = await request(app).post(`/api/attempts/${attempt1Id}/finish`);
    expect(finishRes.status).toBe(200);
    // Weight: q1=1, q2=3. Both correct -> 4/4 * 100 = 100%
    expect(finishRes.body.data.summary.finalScore).toBe(100);
    expect(finishRes.body.data.summary.totalLeaderboardPoints).toBeGreaterThan(4);

    // Participant 2: submits wrong answer for q1, correct for q2
    const start2 = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({
        name: 'Bob Builder',
        participantCode: 'EMP-02',
      });
    const attempt2Id = start2.body.data.attempt.id;

    // Wrong answer on q1
    await request(app)
      .post(`/api/attempts/${attempt2Id}/answers`)
      .send({
        questionId: q1Id,
        selectedChoiceIds: [q1WrongChoiceId],
        enteredAt: '2026-01-01T00:00:00Z',
        answeredAt: '2026-01-01T00:00:02Z',
        durationMs: 2000,
      });

    // Correct answer on q2 (weight 3)
    await request(app)
      .post(`/api/attempts/${attempt2Id}/answers`)
      .send({
        questionId: q2Id,
        selectedChoiceIds: [q2CorrectChoiceId],
        enteredAt: '2026-01-01T00:00:00Z',
        answeredAt: '2026-01-01T00:00:12Z',
        durationMs: 12000,
      });

    const finish2 = await request(app).post(`/api/attempts/${attempt2Id}/finish`);
    expect(finish2.status).toBe(200);
    // 3 out of 4 -> 75%
    expect(finish2.body.data.summary.finalScore).toBe(75);
    expect(finish2.body.data.summary.correctCount).toBe(1);
  });

  // 16. leaderboard ordering
  it('16. orders leaderboard by leaderboard points and duration', async () => {
    const lbRes = await request(app).get(`/api/leaderboards/${testSlug}`);
    expect(lbRes.status).toBe(200);
    expect(lbRes.body.data.top5.length).toBe(2);
    // Alice (100% + speed bonus) should be rank 1
    expect(lbRes.body.data.top5[0].participantName).toBe('Alice Wonder');
    expect(lbRes.body.data.top5[0].rank).toBe(1);
    // Bob should be rank 2
    expect(lbRes.body.data.top5[1].participantName).toBe('Bob Builder');
    expect(lbRes.body.data.top5[1].rank).toBe(2);
  });

  // 17. stats aggregation
  it('17. aggregates activity statistics, participants, and question stats', async () => {
    const statsRes = await request(app)
      .get(`/api/activities/${activityId}/stats`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.data.totalParticipants).toBe(2);
    expect(statsRes.body.data.completedAttempts).toBe(2);
    expect(statsRes.body.data.scores.highest).toBe(100);
    expect(statsRes.body.data.scores.lowest).toBe(75);

    const qStatsRes = await request(app)
      .get(`/api/activities/${activityId}/question-stats`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(qStatsRes.status).toBe(200);
    expect(qStatsRes.body.data.length).toBe(2);
    // q1: 1 correct, 1 wrong -> 50%
    expect(qStatsRes.body.data[0].correctPercentage).toBe(50);
  });

  // 18. pre/post comparison
  it('18. compares pre and post activities within the same group', async () => {
    // Create Post Activity in math-group-2026
    const postAct = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Math Post-Test',
        slug: 'math-posttest',
        mode: 'quiz',
        phase: 'post',
        groupId: 'math-group-2026',
        opensAt: new Date(Date.now() - 3600000).toISOString(),
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });
    const postActId = postAct.body.data.id;

    // Add question
    const qPost = await request(app)
      .post(`/api/activities/${postActId}/questions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        body: 'Post test question 1',
        weight: 1,
        choices: [
          { body: 'Correct', isCorrect: true },
          { body: 'Wrong', isCorrect: false },
        ],
      });
    const qPostCorrect = qPost.body.data.choices.find((c: any) => c.isCorrect).id;

    await request(app)
      .post(`/api/activities/${postActId}/publish`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Complete attempt on post test with 100%
    const pStart = await request(app)
      .post('/api/public/math-posttest/start')
      .send({ name: 'Charlie', participantCode: 'EMP-03' });
    const postAttemptId = pStart.body.data.attempt.id;

    await request(app)
      .post(`/api/attempts/${postAttemptId}/answers`)
      .send({
        questionId: qPost.body.data.id,
        selectedChoiceIds: [qPostCorrect],
        enteredAt: '2026-01-01T00:00:00Z',
        answeredAt: '2026-01-01T00:00:03Z',
      });

    await request(app).post(`/api/attempts/${postAttemptId}/finish`);

    // Fetch comparison
    const compRes = await request(app)
      .get('/api/groups/math-group-2026/comparison')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(compRes.status).toBe(200);
    expect(compRes.body.data.preActivity).toBeDefined();
    expect(compRes.body.data.postActivity).toBeDefined();
    expect(compRes.body.data.scoreDelta).toBeDefined();
  });
});
