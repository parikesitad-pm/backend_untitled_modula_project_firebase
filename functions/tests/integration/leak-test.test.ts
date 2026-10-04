import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { seedTestOperators, clearCollection, TestAuthTokens } from '../test-helper';

function findForbiddenKeys(
  obj: any,
  forbidden = ['isCorrect', 'correctChoiceIds', 'accessCodeHash', 'password', 'accessCode']
): string[] {
  const leaks: string[] = [];

  function recurse(current: any, path: string) {
    if (!current || typeof current !== 'object') return;
    if (Array.isArray(current)) {
      current.forEach((item, idx) => recurse(item, `${path}[${idx}]`));
      return;
    }
    for (const key of Object.keys(current)) {
      const fullPath = path ? `${path}.${key}` : key;
      if (forbidden.includes(key)) {
        leaks.push(fullPath);
      }
      recurse(current[key], fullPath);
    }
  }

  recurse(obj, '');
  return leaks;
}

describe('Deep Leak Test - Public Endpoints', () => {
  let tokens: TestAuthTokens;
  let testSlug = 'leak-audit-act';
  let actId: string;
  let q1Id: string;
  let q1Choice1Id: string;

  beforeAll(async () => {
    await clearCollection('operators');
    await clearCollection('activities');
    await clearCollection('questions');
    await clearCollection('choices');
    await clearCollection('participants');
    await clearCollection('attempts');
    await clearCollection('answers');
    await clearCollection('leaderboardSnapshots');

    tokens = await seedTestOperators();

    // Create activity
    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        title: 'Leak Audit Activity',
        slug: testSlug,
        mode: 'quiz',
        opensAt: '2026-01-01T00:00:00Z',
        closesAt: '2027-01-01T00:00:00Z',
      });
    actId = actRes.body.data.id;

    // Add question with choices
    const qRes = await request(app)
      .post(`/api/activities/${actId}/questions`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        body: 'What is the secret answer?',
        choices: [
          { body: 'Correct Secret Choice', isCorrect: true },
          { body: 'Distractor Choice', isCorrect: false },
        ],
      });
    q1Id = qRes.body.data.id;
    q1Choice1Id = qRes.body.data.choices[0].id;

    // Publish
    await request(app)
      .post(`/api/activities/${actId}/publish`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);
  });

  it('scans GET /api/public/{slug} for leaked answers or correctness keys', async () => {
    const res = await request(app).get(`/api/public/${testSlug}`);
    expect(res.status).toBe(200);

    const leaks = findForbiddenKeys(res.body);
    expect(leaks).toEqual([]);
  });

  it('scans POST /api/public/{slug}/start for leaked answers or credentials', async () => {
    const res = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({
        name: 'Inquisitive User',
        participantCode: 'INQ-001',
      });
    expect(res.status).toBe(201);

    const leaks = findForbiddenKeys(res.body);
    expect(leaks).toEqual([]);
  });

  it('scans POST /api/attempts/{id}/answers for leaked answer validation before finish', async () => {
    const startRes = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({
        name: 'Active Participant',
        participantCode: 'ACT-002',
      });
    const attemptId = startRes.body.data.attempt.id;
    const token = startRes.body.data.attemptToken;

    const answerRes = await request(app)
      .post(`/api/attempts/${attemptId}/answers`)
      .set('X-Attempt-Token', token)
      .send({
        questionId: q1Id,
        selectedChoiceIds: [q1Choice1Id],
        enteredAt: new Date().toISOString(),
        answeredAt: new Date().toISOString(),
      });
    expect(answerRes.status).toBe(200);

    const leaks = findForbiddenKeys(answerRes.body);
    expect(leaks).toEqual([]);
  });

  it('scans GET /api/attempts/{id} for leaked answer keys while in progress', async () => {
    const startRes = await request(app)
      .post(`/api/public/${testSlug}/start`)
      .send({
        name: 'Ongoing User',
        participantCode: 'ONG-003',
      });
    const attemptId = startRes.body.data.attempt.id;
    const token = startRes.body.data.attemptToken;

    const getAttemptRes = await request(app)
      .get(`/api/attempts/${attemptId}`)
      .set('X-Attempt-Token', token);
    expect(getAttemptRes.status).toBe(200);

    const leaks = findForbiddenKeys(getAttemptRes.body);
    expect(leaks).toEqual([]);
  });

  it('scans GET /api/leaderboards/{slug} for leaked answers or PII', async () => {
    const res = await request(app).get(`/api/leaderboards/${testSlug}`);
    expect(res.status).toBe(200);

    const leaks = findForbiddenKeys(res.body, [
      'isCorrect',
      'correctChoiceIds',
      'accessCodeHash',
      'participantCode',
      'email',
      'division',
    ]);
    expect(leaks).toEqual([]);
  });
});
