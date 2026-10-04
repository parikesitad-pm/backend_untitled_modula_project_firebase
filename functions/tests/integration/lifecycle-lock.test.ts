import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { seedTestOperators, clearCollection, TestAuthTokens } from '../test-helper';

describe('Activity Lifecycle & Data Locking Integration Tests', () => {
  let tokens: TestAuthTokens;

  beforeAll(async () => {
    await clearCollection('operators');
    await clearCollection('activities');
    await clearCollection('questions');
    await clearCollection('choices');
    await clearCollection('participants');
    await clearCollection('attempts');
    tokens = await seedTestOperators();
  });

  it('blocks deletion of published activity (ACTIVITY_HAS_DATA 409)', async () => {
    // Create draft activity
    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        title: 'Publish Test Act',
        slug: 'pub-test-slug',
        mode: 'quiz',
        opensAt: '2026-01-01T00:00:00Z',
        closesAt: '2027-01-01T00:00:00Z',
      });
    const actId = actRes.body.data.id;

    // Add question
    await request(app)
      .post(`/api/activities/${actId}/questions`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        body: 'Q1',
        choices: [
          { body: 'A', isCorrect: true },
          { body: 'B', isCorrect: false },
        ],
      });

    // Publish
    await request(app)
      .post(`/api/activities/${actId}/publish`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);

    // Try deleting published activity
    const delRes = await request(app)
      .delete(`/api/activities/${actId}`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);
    expect(delRes.status).toBe(409);
    expect(delRes.body.error.code).toBe('ACTIVITY_HAS_DATA');
  });

  it('blocks modifying slug, mode, or groupId after publish', async () => {
    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        title: 'Immutable Slug Act',
        slug: 'immutable-slug-act',
        mode: 'quiz',
        opensAt: '2026-01-01T00:00:00Z',
        closesAt: '2027-01-01T00:00:00Z',
      });
    const actId = actRes.body.data.id;

    await request(app)
      .post(`/api/activities/${actId}/questions`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        body: 'Q1',
        choices: [
          { body: 'A', isCorrect: true },
          { body: 'B', isCorrect: false },
        ],
      });

    await request(app)
      .post(`/api/activities/${actId}/publish`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);

    const patchRes = await request(app)
      .patch(`/api/activities/${actId}`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({ slug: 'different-slug' });
    expect(patchRes.status).toBe(409);
    expect(patchRes.body.error.code).toBe('IMMUTABLE_FIELD');
  });

  it('locks question scoring and choices once attempts exist (QUESTION_LOCKED 409)', async () => {
    // Create activity and question
    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        title: 'Locked Question Act',
        slug: 'locked-q-act',
        mode: 'quiz',
        opensAt: '2026-01-01T00:00:00Z',
        closesAt: '2027-01-01T00:00:00Z',
      });
    const actId = actRes.body.data.id;

    const qRes = await request(app)
      .post(`/api/activities/${actId}/questions`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        body: 'Initial Question Body',
        weight: 2,
        choices: [
          { body: 'A', isCorrect: true },
          { body: 'B', isCorrect: false },
        ],
      });
    const questionId = qRes.body.data.id;

    await request(app)
      .post(`/api/activities/${actId}/publish`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);

    // Start an attempt to generate data
    await request(app)
      .post(`/api/public/locked-q-act/start`)
      .send({ name: 'Student', participantCode: 'STU-001' });

    // Modifying cosmetic body is allowed
    const bodyPatchRes = await request(app)
      .patch(`/api/questions/${questionId}`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({ body: 'Cosmetic Edit To Body' });
    expect(bodyPatchRes.status).toBe(200);

    // Modifying weight is locked
    const weightPatchRes = await request(app)
      .patch(`/api/questions/${questionId}`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({ weight: 5 });
    expect(weightPatchRes.status).toBe(409);
    expect(weightPatchRes.body.error.code).toBe('QUESTION_LOCKED');

    // Modifying choices is locked
    const choicesPatchRes = await request(app)
      .patch(`/api/questions/${questionId}`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        choices: [
          { body: 'X', isCorrect: true },
          { body: 'Y', isCorrect: false },
        ],
      });
    expect(choicesPatchRes.status).toBe(409);
    expect(choicesPatchRes.body.error.code).toBe('QUESTION_LOCKED');

    // Deleting question is locked
    const delRes = await request(app)
      .delete(`/api/questions/${questionId}`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);
    expect(delRes.status).toBe(409);
    expect(delRes.body.error.code).toBe('QUESTION_LOCKED');
  });

  it('supports activity archive lifecycle (close -> archive)', async () => {
    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        title: 'To Archive Act',
        slug: 'to-archive-act',
        mode: 'quiz',
        opensAt: '2026-01-01T00:00:00Z',
        closesAt: '2027-01-01T00:00:00Z',
      });
    const actId = actRes.body.data.id;

    await request(app)
      .post(`/api/activities/${actId}/questions`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        body: 'Q1',
        choices: [
          { body: 'A', isCorrect: true },
          { body: 'B', isCorrect: false },
        ],
      });

    await request(app)
      .post(`/api/activities/${actId}/publish`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);

    // Cannot archive while published
    const earlyArchive = await request(app)
      .post(`/api/activities/${actId}/archive`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);
    expect(earlyArchive.status).toBe(400);

    // Close activity
    const closeRes = await request(app)
      .post(`/api/activities/${actId}/close`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe('closed');

    // Archive activity
    const archiveRes = await request(app)
      .post(`/api/activities/${actId}/archive`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);
    expect(archiveRes.status).toBe(200);
    expect(archiveRes.body.data.status).toBe('archived');
  });
});
