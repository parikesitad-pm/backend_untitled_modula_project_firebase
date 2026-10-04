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
  let attempt1Token: string;

  it('10. allows participant to start attempt and returns attemptToken', async () => {
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
    expect(res.body.data.attemptToken).toBeDefined();

    attempt1Id = res.body.data.attempt.id;
    attempt1Token = res.body.data.attemptToken;
  });

  // 11. submit correct answer
  it('11. submits correct answer with X-Attempt-Token header', async () => {
    const res = await request(app)
      .post(`/api/attempts/${attempt1Id}/answers`)
      .set('X-Attempt-Token', attempt1Token)
      .send({
        questionId: q1Id,
        selectedChoiceIds: [q1CorrectChoiceId],
        enteredAt: '2026-01-01T00:00:00Z',
        answeredAt: '2026-01-01T00:00:05Z',
      });

    expect(res.status).toBe(200);
    expect(res.body.data.recorded).toBe(true);
  });

  // 12. submit wrong answer & custom question weight & final score
  it('12, 13 & 15. submits answers and computes final score with weights', async () => {
    // Participant 1 submits correct for question 2 as well
    await request(app)
      .post(`/api/attempts/${attempt1Id}/answers`)
      .set('X-Attempt-Token', attempt1Token)
      .send({
        questionId: q2Id,
        selectedChoiceIds: [q2CorrectChoiceId],
        enteredAt: '2026-01-01T00:00:00Z',
        answeredAt: '2026-01-01T00:00:10Z',
      });

    const finishRes = await request(app)
      .post(`/api/attempts/${attempt1Id}/finish`)
      .set('X-Attempt-Token', attempt1Token);
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
    const attempt2Token = start2.body.data.attemptToken;

    // Wrong answer on q1
    await request(app)
      .post(`/api/attempts/${attempt2Id}/answers`)
      .set('X-Attempt-Token', attempt2Token)
      .send({
        questionId: q1Id,
        selectedChoiceIds: [q1WrongChoiceId],
      });

    // Correct answer on q2 (weight 3)
    await request(app)
      .post(`/api/attempts/${attempt2Id}/answers`)
      .set('X-Attempt-Token', attempt2Token)
      .send({
        questionId: q2Id,
        selectedChoiceIds: [q2CorrectChoiceId],
      });

    const finish2 = await request(app)
      .post(`/api/attempts/${attempt2Id}/finish`)
      .set('X-Attempt-Token', attempt2Token);
    expect(finish2.status).toBe(200);
    // 3 out of 4 -> 75%
    expect(finish2.body.data.summary.finalScore).toBe(75);
    expect(finish2.body.data.summary.correctCount).toBe(1);
  });

  // 16. leaderboard ordering
  it('16. orders leaderboard by leaderboard points and duration without PII', async () => {
    const lbRes = await request(app).get(`/api/leaderboards/${testSlug}`);
    expect(lbRes.status).toBe(200);
    expect(lbRes.body.data.top5.length).toBe(2);
    // Alice (100% + speed bonus) should be rank 1
    expect(lbRes.body.data.top5[0].displayName).toBe('Alice Wonder');
    expect(lbRes.body.data.top5[0].rank).toBe(1);
    // Bob should be rank 2
    expect(lbRes.body.data.top5[1].displayName).toBe('Bob Builder');
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
  it('18. compares pre and post activities with matched, only-pre, and only-post participants', async () => {
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

    // Alice (EMP-01) completes Post test -> Matched!
    const alicePost = await request(app)
      .post('/api/public/math-posttest/start')
      .send({ name: 'Alice Wonder', participantCode: 'emp-01' }); // lowercase normalized
    const aliceAttemptId = alicePost.body.data.attempt.id;
    const aliceToken = alicePost.body.data.attemptToken;

    await request(app)
      .post(`/api/attempts/${aliceAttemptId}/answers`)
      .set('X-Attempt-Token', aliceToken)
      .send({
        questionId: qPost.body.data.id,
        selectedChoiceIds: [qPostCorrect],
      });

    await request(app)
      .post(`/api/attempts/${aliceAttemptId}/finish`)
      .set('X-Attempt-Token', aliceToken);

    // Charlie (EMP-03) completes Post test only -> Only-post!
    const charliePost = await request(app)
      .post('/api/public/math-posttest/start')
      .send({ name: 'Charlie', participantCode: 'EMP-03' });
    const charlieAttemptId = charliePost.body.data.attempt.id;
    const charlieToken = charliePost.body.data.attemptToken;

    await request(app)
      .post(`/api/attempts/${charlieAttemptId}/answers`)
      .set('X-Attempt-Token', charlieToken)
      .send({
        questionId: qPost.body.data.id,
        selectedChoiceIds: [qPostCorrect],
      });

    await request(app)
      .post(`/api/attempts/${charlieAttemptId}/finish`)
      .set('X-Attempt-Token', charlieToken);

    // Fetch pre/post comparison
    const compRes = await request(app)
      .get('/api/groups/math-group-2026/comparison')
      .set('Authorization', `Bearer ${ownerToken}`);

    expect(compRes.status).toBe(200);
    const data = compRes.body.data;
    expect(data.preActivity.title).toBe('Math Challenge');
    expect(data.postActivity.title).toBe('Math Post-Test');
    expect(data.matchedCount).toBe(1); // Alice (EMP-01)
    expect(data.unmatchedCount).toBe(2); // Bob (only-pre) + Charlie (only-post)

    // Check Alice (matched)
    const aliceMatch = data.participants.find((p: any) => p.participantCode === 'EMP-01');
    expect(aliceMatch.matched).toBe(true);
    expect(aliceMatch.preScore).toBe(100);
    expect(aliceMatch.postScore).toBe(100);
    expect(aliceMatch.delta).toBe(0);

    // Check Bob (only-pre)
    const bobMatch = data.participants.find((p: any) => p.participantCode === 'EMP-02');
    expect(bobMatch.matched).toBe(false);
    expect(bobMatch.preScore).toBe(75);
    expect(bobMatch.postScore).toBeNull();
    expect(bobMatch.delta).toBeNull();

    // Check Charlie (only-post)
    const charlieMatch = data.participants.find((p: any) => p.participantCode === 'EMP-03');
    expect(charlieMatch.matched).toBe(false);
    expect(charlieMatch.preScore).toBeNull();
    expect(charlieMatch.postScore).toBe(100);
    expect(charlieMatch.delta).toBeNull();
  });
});
