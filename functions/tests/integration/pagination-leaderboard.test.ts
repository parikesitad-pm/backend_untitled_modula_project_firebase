import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { db } from '../../src/config/firebase';
import { seedTestOperators, clearCollection, TestAuthTokens } from '../test-helper';

describe('Pagination & Leaderboard Privacy Integration Tests', () => {
  let tokens: TestAuthTokens;
  let testActId: string;
  let testSlug = 'pagination-leaderboard-act';
  let hiddenActId: string;
  let hiddenSlug = 'hidden-leaderboard-act';

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

    // 1. Create standard activity
    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        title: 'Pagination Activity',
        slug: testSlug,
        mode: 'quiz',
        opensAt: '2026-01-01T00:00:00Z',
        closesAt: '2027-01-01T00:00:00Z',
      });
    testActId = actRes.body.data.id;

    // Add question
    const qRes = await request(app)
      .post(`/api/activities/${testActId}/questions`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        body: 'Simple Q',
        weight: 1,
        choices: [
          { body: '1', isCorrect: true },
          { body: '2', isCorrect: false },
        ],
      });
    const choiceId = qRes.body.data.choices[0].id;

    await request(app)
      .post(`/api/activities/${testActId}/publish`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);

    // Seed 5 participants and completed attempts
    for (let i = 1; i <= 5; i++) {
      const startRes = await request(app)
        .post(`/api/public/${testSlug}/start`)
        .send({
          name: `Participant ${i}`,
          participantCode: `EMP-00${i}`,
          email: `participant${i}@company.secret`,
          division: 'Confidential R&D',
        });
      const attemptId = startRes.body.data.attempt.id;
      const token = startRes.body.data.attemptToken;

      await request(app)
        .post(`/api/attempts/${attemptId}/answers`)
        .set('X-Attempt-Token', token)
        .send({
          questionId: qRes.body.data.id,
          selectedChoiceIds: [choiceId],
        });

      await request(app)
        .post(`/api/attempts/${attemptId}/finish`)
        .set('X-Attempt-Token', token);
    }

    // 2. Create activity with hideLeaderboardFromParticipants: true
    const hiddenActRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        title: 'Hidden Leaderboard Activity',
        slug: hiddenSlug,
        mode: 'quiz',
        opensAt: '2026-01-01T00:00:00Z',
        closesAt: '2027-01-01T00:00:00Z',
        settings: {
          hideLeaderboardFromParticipants: true,
        },
      });
    hiddenActId = hiddenActRes.body.data.id;

    await request(app)
      .post(`/api/activities/${hiddenActId}/questions`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        body: 'Hidden Q',
        choices: [
          { body: 'A', isCorrect: true },
          { body: 'B', isCorrect: false },
        ],
      });

    await request(app)
      .post(`/api/activities/${hiddenActId}/publish`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);
  });

  it('paginates participants across multiple pages with nextCursor ending in null', async () => {
    // Request page 1 with limit=2
    const page1Res = await request(app)
      .get(`/api/activities/${testActId}/participants?limit=2`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);

    expect(page1Res.status).toBe(200);
    expect(page1Res.body.data.length).toBe(2);
    expect(page1Res.body.meta).toBeDefined();
    expect(page1Res.body.meta.limit).toBe(2);
    expect(page1Res.body.meta.nextCursor).toBeTruthy();

    const cursor1 = page1Res.body.meta.nextCursor;

    // Request page 2 with cursor1 and limit=2
    const page2Res = await request(app)
      .get(`/api/activities/${testActId}/participants?limit=2&cursor=${cursor1}`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);

    expect(page2Res.status).toBe(200);
    expect(page2Res.body.data.length).toBe(2);
    expect(page2Res.body.meta.nextCursor).toBeTruthy();

    const cursor2 = page2Res.body.meta.nextCursor;

    // Request page 3 (remaining 1 item)
    const page3Res = await request(app)
      .get(`/api/activities/${testActId}/participants?limit=2&cursor=${cursor2}`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);

    expect(page3Res.status).toBe(200);
    expect(page3Res.body.data.length).toBe(1);
    // At the end, nextCursor must be null
    expect(page3Res.body.meta.nextCursor).toBeNull();
  });

  it('blocks public access to hidden leaderboard (403), but permits operators (200)', async () => {
    // Public unauthenticated request -> 403 Forbidden
    const publicRes = await request(app).get(`/api/leaderboards/${hiddenSlug}`);
    expect(publicRes.status).toBe(403);
    expect(publicRes.body.error.code).toBe('LEADERBOARD_HIDDEN');

    // Operator request -> 200 OK
    const opRes = await request(app)
      .get(`/api/leaderboards/${hiddenSlug}`)
      .set('Authorization', `Bearer ${tokens.operatorToken}`);
    expect(opRes.status).toBe(200);
    expect(opRes.body.data.activityTitle).toBe('Hidden Leaderboard Activity');
  });

  it('guarantees leaderboard snapshot document contains zero PII', async () => {
    const metaDoc = await db.collection('leaderboardSnapshots').doc(testActId).get();
    expect(metaDoc.exists).toBe(true);
    const metaData = metaDoc.data()!;
    expect(metaData).not.toHaveProperty('participantCode');
    expect(metaData).not.toHaveProperty('email');
    expect(metaData).not.toHaveProperty('division');

    const entriesSnap = await db.collection('leaderboardSnapshots').doc(testActId).collection('entries').get();
    expect(entriesSnap.size).toBeGreaterThan(0);

    for (const doc of entriesSnap.docs) {
      const entry = doc.data();
      expect(entry).not.toHaveProperty('participantCode');
      expect(entry).not.toHaveProperty('email');
      expect(entry).not.toHaveProperty('division');
      expect(entry).not.toHaveProperty('customFields');
      expect(entry).toHaveProperty('displayName');
      expect(entry).toHaveProperty('leaderboardPoints');
      expect(entry).toHaveProperty('scorePercent');
      expect(entry).toHaveProperty('durationMs');
    }
  });
});
