import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { seedTestOperators, clearCollection } from '../test-helper';

describe('Auth & Activities Integration Tests', () => {
  let ownerToken: string;
  let operatorToken: string;

  beforeAll(async () => {
    await clearCollection('operators');
    await clearCollection('activities');
    await clearCollection('questions');
    await clearCollection('choices');
    const tokens = await seedTestOperators();
    ownerToken = tokens.ownerToken;
    operatorToken = tokens.operatorToken;
  });

  // 1. operator login success/failure
  it('1. handles operator login success and failure', async () => {
    const failRes = await request(app).post('/api/auth/login').send({
      username: 'owner',
      accessCode: 'wrong-pass',
    });
    expect(failRes.status).toBe(401);
    expect(failRes.body.success).toBe(false);

    const successRes = await request(app).post('/api/auth/login').send({
      username: 'owner',
      accessCode: 'owner-secret-2026',
    });
    expect(successRes.status).toBe(200);
    expect(successRes.body.success).toBe(true);
    expect(successRes.body.data.token).toBeDefined();
    expect(successRes.body.data.operator.role).toBe('owner');
  });

  // 2. unauthorized protected route
  it('2. blocks unauthorized requests to protected routes', async () => {
    const res = await request(app).get('/api/activities');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // 3. role authorization
  it('3. respects operator token on protected routes', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('operator');
  });

  // 4. unique slug
  it('4. enforces unique slug across activities', async () => {
    const payload = {
      title: 'Activity 1',
      slug: 'test-slug-unique',
      mode: 'quiz',
      opensAt: '2026-01-01T00:00:00Z',
      closesAt: '2026-01-02T00:00:00Z',
    };

    const first = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(payload);
    expect(first.status).toBe(201);

    const duplicate = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(payload);
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('CONFLICT');
  });

  // 5. question 255-char validation
  it('5. enforces question prompt 255-char limit', async () => {
    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Activity For Questions',
        slug: 'slug-for-q',
        mode: 'quiz',
        opensAt: '2026-01-01T00:00:00Z',
        closesAt: '2026-01-02T00:00:00Z',
      });
    const actId = actRes.body.data.id;

    const longBody = 'A'.repeat(256);
    const failRes = await request(app)
      .post(`/api/activities/${actId}/questions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        body: longBody,
        choices: [
          { body: 'Choice A', isCorrect: true },
          { body: 'Choice B', isCorrect: false },
        ],
      });
    expect(failRes.status).toBe(400);

    const validBody = 'A'.repeat(255);
    const okRes = await request(app)
      .post(`/api/activities/${actId}/questions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        body: validBody,
        choices: [
          { body: 'Choice A', isCorrect: true },
          { body: 'Choice B', isCorrect: false },
        ],
      });
    expect(okRes.status).toBe(201);
  });

  // 6. invalid schedule
  it('6. rejects invalid schedule where opensAt is after closesAt', async () => {
    const res = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Invalid Schedule Act',
        slug: 'invalid-sched',
        mode: 'quiz',
        opensAt: '2026-05-10T12:00:00Z',
        closesAt: '2026-05-10T10:00:00Z',
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  // 7. unpublished activity blocked
  it('7. blocks public access to unpublished/draft activities', async () => {
    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Draft Activity',
        slug: 'draft-act-slug',
        mode: 'quiz',
        opensAt: '2026-01-01T00:00:00Z',
        closesAt: '2027-01-01T00:00:00Z',
      });
    expect(actRes.body.data.status).toBe('draft');

    const pubRes = await request(app).get('/api/public/draft-act-slug');
    expect(pubRes.status).toBe(400);
    expect(pubRes.body.error.code).toBe('ACTIVITY_NOT_PUBLISHED');
  });

  // 8. activity before open time blocked
  it('8. blocks public access before open time', async () => {
    const futureOpen = new Date(Date.now() + 86400000).toISOString();
    const futureClose = new Date(Date.now() + 172800000).toISOString();

    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Future Activity',
        slug: 'future-act-slug',
        mode: 'quiz',
        opensAt: futureOpen,
        closesAt: futureClose,
      });

    await request(app)
      .post(`/api/activities/${actRes.body.data.id}/publish`)
      .set('Authorization', `Bearer ${ownerToken}`);

    const pubRes = await request(app).get('/api/public/future-act-slug');
    expect(pubRes.status).toBe(400);
    expect(pubRes.body.error.code).toBe('ACTIVITY_NOT_STARTED');
  });

  // 9. activity after close time blocked
  it('9. blocks public access after close time', async () => {
    const pastOpen = new Date(Date.now() - 172800000).toISOString();
    const pastClose = new Date(Date.now() - 86400000).toISOString();

    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Expired Activity',
        slug: 'expired-act-slug',
        mode: 'quiz',
        opensAt: pastOpen,
        closesAt: pastClose,
      });

    await request(app)
      .post(`/api/activities/${actRes.body.data.id}/publish`)
      .set('Authorization', `Bearer ${ownerToken}`);

    const pubRes = await request(app).get('/api/public/expired-act-slug');
    expect(pubRes.status).toBe(400);
    expect(pubRes.body.error.code).toBe('ACTIVITY_CLOSED');
  });

  // 19. correct answers not leaked publicly
  it('19. never leaks correct answers in public endpoints', async () => {
    const nowOpen = new Date(Date.now() - 3600000).toISOString();
    const nowClose = new Date(Date.now() + 3600000).toISOString();

    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Public Active Activity',
        slug: 'public-active-act',
        mode: 'quiz',
        opensAt: nowOpen,
        closesAt: nowClose,
      });
    const actId = actRes.body.data.id;

    await request(app)
      .post(`/api/activities/${actId}/questions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        body: 'Is this leaked?',
        choices: [
          { body: 'Correct Answer', isCorrect: true },
          { body: 'Wrong Answer', isCorrect: false },
        ],
      });

    await request(app)
      .post(`/api/activities/${actId}/publish`)
      .set('Authorization', `Bearer ${ownerToken}`);

    const pubRes = await request(app).get('/api/public/public-active-act');
    expect(pubRes.status).toBe(200);

    const questions = pubRes.body.data.questions;
    expect(questions.length).toBe(1);
    for (const choice of questions[0].choices) {
      expect(choice).not.toHaveProperty('isCorrect');
    }
  });
});
