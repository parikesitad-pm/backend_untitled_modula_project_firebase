import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { clearCollection, seedTestOperators } from '../test-helper';

const baseUrl = process.env.EMULATOR_HTTP_URL;
// If baseUrl is provided (e.g. http://127.0.0.1:5001/modula-backend-dev/us-central1/api or http://127.0.0.1:5000/api),
// supertest makes real network HTTP requests to the running emulator.
// Otherwise, it falls back to the in-process Express app.
const api = baseUrl ? request(baseUrl) : request(app);

describe('Functions-Emulator Smoke Test Suite', () => {
  let ownerToken: string;
  let testSlug = 'smoke-test-' + Date.now();
  let activityId: string;
  let questionId: string;
  let correctChoiceId: string;
  let attemptId: string;
  let attemptToken: string;

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
    await clearCollection('loginAttempts');

    await seedTestOperators();
  });

  it('1. performs operator login', async () => {
    const res = await api.post('/api/auth/login').send({
      username: 'owner',
      accessCode: 'owner-secret-2026',
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    ownerToken = res.body.data.token;
  });

  it('2. creates activity in draft state', async () => {
    const res = await api
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Smoke Test Assessment',
        description: 'End to end flow verification through emulator',
        slug: testSlug,
        mode: 'quiz',
        phase: 'standalone',
        opensAt: new Date(Date.now() - 3600000).toISOString(),
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('draft');
    activityId = res.body.data.id;
  });

  it('3. adds question to activity', async () => {
    const res = await api
      .post(`/api/activities/${activityId}/questions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        body: 'What is 7 multiplied by 8?',
        weight: 2,
        speedBonusEnabled: true,
        speedBonusPercent: 20,
        timeReferenceSeconds: 30,
        choices: [
          { body: '56', isCorrect: true },
          { body: '54', isCorrect: false },
        ],
      });
    expect(res.status).toBe(201);
    questionId = res.body.data.id;
    correctChoiceId = res.body.data.choices.find((c: any) => c.isCorrect).id;
  });

  it('4. publishes activity', async () => {
    const res = await api
      .post(`/api/activities/${activityId}/publish`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('published');
  });

  it('5. participant inspects public activity without answer leaks', async () => {
    const res = await api.get(`/api/public/${testSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.activity.title).toBe('Smoke Test Assessment');
    expect(res.body.data.questions.length).toBe(1);
    for (const choice of res.body.data.questions[0].choices) {
      expect(choice).not.toHaveProperty('isCorrect');
    }
  });

  it('6. participant starts attempt and receives attemptToken', async () => {
    const res = await api
      .post(`/api/public/${testSlug}/start`)
      .send({
        name: 'Smoke Tester',
        participantCode: 'SMOKE-001',
        email: 'smoke@example.com',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.attempt.status).toBe('in_progress');
    expect(res.body.data.attemptToken).toBeDefined();

    attemptId = res.body.data.attempt.id;
    attemptToken = res.body.data.attemptToken;
  });

  it('7. submits answer with X-Attempt-Token', async () => {
    const res = await api
      .post(`/api/attempts/${attemptId}/answers`)
      .set('X-Attempt-Token', attemptToken)
      .send({
        questionId,
        selectedChoiceIds: [correctChoiceId],
        enteredAt: new Date().toISOString(),
        answeredAt: new Date().toISOString(),
      });
    expect(res.status).toBe(200);
    expect(res.body.data.recorded).toBe(true);
  });

  it('8. finishes attempt with X-Attempt-Token and computes score', async () => {
    const res = await api
      .post(`/api/attempts/${attemptId}/finish`)
      .set('X-Attempt-Token', attemptToken);
    expect(res.status).toBe(200);
    expect(res.body.data.summary.finalScore).toBe(100);
    expect(res.body.data.summary.correctCount).toBe(1);
    expect(res.body.data.summary.totalLeaderboardPoints).toBeGreaterThan(2);
  });

  it('9. retrieves realtime leaderboard rankings', async () => {
    const res = await api.get(`/api/leaderboards/${testSlug}`);
    expect(res.status).toBe(200);
    expect(res.body.data.top5.length).toBe(1);
    expect(res.body.data.top5[0].displayName).toBe('Smoke Tester');
    expect(res.body.data.top5[0].finalScore).toBe(100);
  });

  it('10. organizer inspects stats summary', async () => {
    const res = await api
      .get(`/api/activities/${activityId}/stats`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.totalParticipants).toBe(1);
    expect(res.body.data.completedAttempts).toBe(1);
    expect(res.body.data.scores.highest).toBe(100);
  });
});
