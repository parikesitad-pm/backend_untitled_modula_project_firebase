import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { seedTestOperators, clearCollection, TestAuthTokens } from '../test-helper';

describe('Role Authorization Matrix Tests', () => {
  let tokens: TestAuthTokens;
  let testActId: string;
  let testQuestionId: string;
  let targetOperatorId: string;

  beforeAll(async () => {
    await clearCollection('operators');
    await clearCollection('activities');
    await clearCollection('questions');
    await clearCollection('choices');

    tokens = await seedTestOperators();

    // Create a target operator for testing operator endpoints
    const createOpRes = await request(app)
      .post('/api/operators')
      .set('Authorization', `Bearer ${tokens.crownToken}`)
      .send({
        username: 'target_dummy_user',
        accessCode: 'StrongPass123!@#',
        role: 'operator',
      });
    targetOperatorId = createOpRes.body.data.uid;

    // Create an activity with questions for testing activity and question endpoints
    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        title: 'Matrix Test Activity',
        slug: 'matrix-act-slug',
        mode: 'quiz',
        phase: 'pre',
        groupId: 'matrix-group',
        opensAt: '2026-01-01T00:00:00Z',
        closesAt: '2027-01-01T00:00:00Z',
      });
    testActId = actRes.body.data.id;

    const qRes = await request(app)
      .post(`/api/activities/${testActId}/questions`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        body: 'Question 1',
        choices: [
          { body: 'A', isCorrect: true },
          { body: 'B', isCorrect: false },
        ],
      });
    testQuestionId = qRes.body.data.id;
  });

  type Role = 'crown' | 'owner' | 'manager' | 'operator';

  interface RouteTestDef {
    name: string;
    method: 'get' | 'post' | 'patch' | 'delete';
    path: () => string;
    payload?: () => any;
    allowedRoles: Role[];
    setupBeforeAllowed?: () => Promise<void>;
  }

  const routesToTest: RouteTestDef[] = [
    // 1. GET /api/auth/me (All roles)
    {
      name: 'GET /api/auth/me',
      method: 'get',
      path: () => '/api/auth/me',
      allowedRoles: ['crown', 'owner', 'manager', 'operator'],
    },
    // 2. Operators management (Owner & Crown only)
    {
      name: 'GET /api/operators',
      method: 'get',
      path: () => '/api/operators',
      allowedRoles: ['crown', 'owner'],
    },
    {
      name: 'POST /api/operators',
      method: 'post',
      path: () => '/api/operators',
      payload: () => ({
        username: 'usr_' + Math.random().toString(36).substring(2, 9),
        accessCode: 'ValidCode123!45',
        role: 'operator',
      }),
      allowedRoles: ['crown', 'owner'],
    },
    {
      name: 'PATCH /api/operators/:id',
      method: 'patch',
      path: () => `/api/operators/${targetOperatorId}`,
      payload: () => ({ active: true }),
      allowedRoles: ['crown', 'owner'],
    },
    {
      name: 'POST /api/operators/:id/deactivate',
      method: 'post',
      path: () => `/api/operators/${targetOperatorId}/deactivate`,
      allowedRoles: ['crown', 'owner'],
    },
    {
      name: 'POST /api/operators/:id/reactivate',
      method: 'post',
      path: () => `/api/operators/${targetOperatorId}/reactivate`,
      allowedRoles: ['crown', 'owner'],
    },
    // 3. Read activities (All roles)
    {
      name: 'GET /api/activities',
      method: 'get',
      path: () => '/api/activities',
      allowedRoles: ['crown', 'owner', 'manager', 'operator'],
    },
    {
      name: 'GET /api/activities/:id',
      method: 'get',
      path: () => `/api/activities/${testActId}`,
      allowedRoles: ['crown', 'owner', 'manager', 'operator'],
    },
    // 4. Create / update activities (All roles per Section 4 table)
    {
      name: 'POST /api/activities',
      method: 'post',
      path: () => '/api/activities',
      payload: () => ({
        title: 'New Act',
        slug: 'slug-' + Math.random().toString(36).substring(2, 9),
        mode: 'quiz',
        opensAt: '2026-01-01T00:00:00Z',
        closesAt: '2027-01-01T00:00:00Z',
      }),
      allowedRoles: ['crown', 'owner', 'manager', 'operator'],
    },
    {
      name: 'PATCH /api/activities/:id',
      method: 'patch',
      path: () => `/api/activities/${testActId}`,
      payload: () => ({ title: 'Updated Title ' + Math.random() }),
      allowedRoles: ['crown', 'owner', 'manager', 'operator'],
    },
    // 5. Delete activity (Owner & Crown only)
    {
      name: 'DELETE /api/activities/:id',
      method: 'delete',
      path: () => `/api/activities/${testActId}`,
      allowedRoles: ['crown', 'owner'],
    },
    // 6. Publish, close, archive (Manager, Owner, Crown)
    {
      name: 'POST /api/activities/:id/publish',
      method: 'post',
      path: () => `/api/activities/${testActId}/publish`,
      allowedRoles: ['crown', 'owner', 'manager'],
    },
    {
      name: 'POST /api/activities/:id/close',
      method: 'post',
      path: () => `/api/activities/${testActId}/close`,
      allowedRoles: ['crown', 'owner', 'manager'],
    },
    {
      name: 'POST /api/activities/:id/archive',
      method: 'post',
      path: () => `/api/activities/${testActId}/archive`,
      allowedRoles: ['crown', 'owner', 'manager'],
    },
    // 7. Questions CRUD & Reorder (All roles per Section 4 table)
    {
      name: 'GET /api/activities/:id/questions',
      method: 'get',
      path: () => `/api/activities/${testActId}/questions`,
      allowedRoles: ['crown', 'owner', 'manager', 'operator'],
    },
    {
      name: 'POST /api/activities/:id/questions',
      method: 'post',
      path: () => `/api/activities/${testActId}/questions`,
      payload: () => ({
        body: 'Matrix Q ' + Math.random(),
        choices: [
          { body: '1', isCorrect: true },
          { body: '2', isCorrect: false },
        ],
      }),
      allowedRoles: ['crown', 'owner', 'manager', 'operator'],
    },
    {
      name: 'PATCH /api/questions/:id',
      method: 'patch',
      path: () => `/api/questions/${testQuestionId}`,
      payload: () => ({ body: 'Updated Q ' + Math.random() }),
      allowedRoles: ['crown', 'owner', 'manager', 'operator'],
    },
    {
      name: 'POST /api/questions/reorder',
      method: 'post',
      path: () => '/api/questions/reorder',
      payload: () => ({ items: [] }),
      allowedRoles: ['crown', 'owner', 'manager', 'operator'],
    },
    {
      name: 'DELETE /api/questions/:id',
      method: 'delete',
      path: () => `/api/questions/nonexistent-q-id`,
      allowedRoles: ['crown', 'owner', 'manager', 'operator'],
    },
    // 8. Participants & Responses containing PII (Manager, Owner, Crown only)
    {
      name: 'GET /api/activities/:id/participants',
      method: 'get',
      path: () => `/api/activities/${testActId}/participants`,
      allowedRoles: ['crown', 'owner', 'manager'],
    },
    {
      name: 'GET /api/activities/:id/responses',
      method: 'get',
      path: () => `/api/activities/${testActId}/responses`,
      allowedRoles: ['crown', 'owner', 'manager'],
    },
    // 9. Stats, Question Stats, Comparison (All roles per Section 4 table)
    {
      name: 'GET /api/activities/:id/stats',
      method: 'get',
      path: () => `/api/activities/${testActId}/stats`,
      allowedRoles: ['crown', 'owner', 'manager', 'operator'],
    },
    {
      name: 'GET /api/activities/:id/question-stats',
      method: 'get',
      path: () => `/api/activities/${testActId}/question-stats`,
      allowedRoles: ['crown', 'owner', 'manager', 'operator'],
    },
    {
      name: 'GET /api/groups/:groupId/comparison',
      method: 'get',
      path: () => '/api/groups/matrix-group/comparison',
      allowedRoles: ['crown', 'owner', 'manager', 'operator'],
    },
    // 10. Storage Upload URL (All roles per Section 4 table)
    {
      name: 'POST /api/storage/upload-url',
      method: 'post',
      path: () => '/api/storage/upload-url',
      payload: () => ({ filename: 'sample.png', contentType: 'image/png' }),
      allowedRoles: ['crown', 'owner', 'manager', 'operator'],
    },
  ];

  const allRoles: Role[] = ['crown', 'owner', 'manager', 'operator'];

  for (const route of routesToTest) {
    describe(route.name, () => {
      for (const role of allRoles) {
        const isAllowed = route.allowedRoles.includes(role);
        it(`${role} -> ${isAllowed ? 'ALLOWED' : 'FORBIDDEN (403)'}`, async () => {
          const token =
            role === 'crown'
              ? tokens.crownToken
              : role === 'owner'
                ? tokens.ownerToken
                : role === 'manager'
                  ? tokens.managerToken
                  : tokens.operatorToken;

          let req = request(app)[route.method](route.path()).set('Authorization', `Bearer ${token}`);
          if (route.payload) {
            req = req.send(route.payload());
          }

          const res = await req;
          if (isAllowed) {
            // Should NOT be 403 Forbidden or 401 Unauthorized
            expect(res.status).not.toBe(403);
            expect(res.status).not.toBe(401);
          } else {
            // Must be 403 Forbidden
            expect(res.status).toBe(403);
            expect(res.body.success).toBe(false);
            expect(res.body.error.code).toBe('FORBIDDEN');
          }
        });
      }
    });
  }
});
