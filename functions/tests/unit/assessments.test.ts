import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../../src/app';
import { db } from '../../src/config/firebase';

describe('Assessments API & Security Acceptance Tests', () => {
  let app: any;

  beforeEach(() => {
    vi.restoreAllMocks();
    app = createApp();
  });

  describe('1. Unauthenticated & Authorization Boundaries', () => {
    it('rejects unauthenticated requests to GET /api/assessments with 401', async () => {
      const res = await request(app).get('/api/assessments');
      expect(res.status).toBe(401);
      expect(res.body.error).toBeDefined();
    });

    it('rejects malformed Bearer token with 401', async () => {
      const res = await request(app)
        .get('/api/assessments')
        .set('Authorization', 'Bearer invalid-token-string');
      expect(res.status).toBe(401);
    });

    it('rejects unauthenticated POST /api/assessments with 401', async () => {
      const res = await request(app)
        .post('/api/assessments')
        .send({ title: 'Test Assessment', slug: 'test-slug', mode: 'quiz' });
      expect(res.status).toBe(401);
    });
  });

  describe('2. Public Assessment Endpoint (Sanitization & Leak Prevention)', () => {
    it('returns 404 for non-existent public slug', async () => {
      vi.spyOn(db, 'collection').mockImplementation((name: string) => {
        if (name === 'assessments') {
          return {
            where: () => ({
              limit: () => ({
                get: async () => ({ empty: true, docs: [] }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const res = await request(app).get('/api/public/assessments/non-existent-slug-xyz');
      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    });

    it('strips choice.isCorrect, internal scoring details, and owner metadata from public slug response', async () => {
      // Mock db collection for 'assessments'
      const mockAssessmentDoc = {
        id: 'test-assessment-123',
        slug: 'public-safe-slug',
        title: 'Security Assessment',
        description: 'Test public strip',
        mode: 'quiz',
        presentationMode: 'formal',
        status: 'active',
        timeLimitEnabled: true,
        activityTimeLimitSeconds: 300,
        leaderboardEnabled: true,
        scoreVisible: true,
        rankVisible: true,
        ownerId: 'secret-owner-uid-999',
        createdBy: 'admin-operator',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        participantCount: 15,
        averageScore: 85,
        completionRate: 90,
        blocks: [
          {
            id: 'q-1',
            type: 'choice',
            title: 'Question 1',
            body: 'What is 2+2?',
            points: 10,
            choices: [
              { id: 'c-1', body: '3', isCorrect: false },
              { id: 'c-2', body: '4', isCorrect: true },
            ],
            explanation: 'Internal explanation with answer hints',
          },
        ],
        settings: {
          showLeaderboard: true,
          requireAuth: true,
          internalFlag: 'do-not-leak',
        },
      };

      vi.spyOn(db, 'collection').mockImplementation((name: string) => {
        if (name === 'assessments') {
          return {
            where: (_field: string, _op: string, val: string) => ({
              limit: () => ({
                get: async () => {
                  if (val === 'public-safe-slug') {
                    return {
                      empty: false,
                      docs: [
                        {
                          id: mockAssessmentDoc.id,
                          data: () => mockAssessmentDoc,
                        },
                      ],
                    };
                  }
                  return { empty: true, docs: [] };
                },
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const res = await request(app).get('/api/public/assessments/public-safe-slug');
      expect(res.status).toBe(200);

      const data = res.body.data;
      expect(data.slug).toBe('public-safe-slug');
      expect(data.title).toBe('Security Assessment');

      // VERIFY: ownerId and createdBy are stripped
      expect(data.ownerId).toBeUndefined();
      expect(data.createdBy).toBeUndefined();
      expect(data.averageScore).toBeUndefined();
      expect(data.completionRate).toBeUndefined();

      // VERIFY: isCorrect is strictly stripped from choices
      expect(data.blocks).toBeDefined();
      expect(data.blocks.length).toBe(1);
      const choices = data.blocks[0].choices;
      expect(choices.length).toBe(2);
      expect(choices[0].body).toBe('3');
      expect(choices[0].isCorrect).toBeUndefined();
      expect(choices[1].body).toBe('4');
      expect(choices[1].isCorrect).toBeUndefined();

      // VERIFY: private settings are stripped
      expect(data.settings.requireAuth).toBeUndefined();
      expect(data.settings.internalFlag).toBeUndefined();
      expect(data.settings.showLeaderboard).toBe(true);
    });
  });

  describe('3. Creator Ownership & Slug Integrity', () => {
    // Helper to generate a fake JWT with uid
    const createFakeToken = (uid: string) => {
      const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify({ uid, sub: uid })).toString('base64url');
      return `${header}.${payload}.mockSignature`;
    };

    it('rejects duplicate slug on creation with 409 Conflict', async () => {
      const op1Token = createFakeToken('op-1');

      vi.spyOn(db, 'collection').mockImplementation((name: string) => {
        if (name === 'operators') {
          return {
            doc: (_id: string) => ({
              get: async () => ({
                exists: true,
                data: () => ({ active: true, username: 'operator1', role: 'operator' }),
              }),
            }),
          } as any;
        }
        if (name === 'assessments') {
          return {
            where: (_field: string, _op: string, val: string) => ({
              limit: () => ({
                get: async () => {
                  if (val === 'existing-duplicate-slug') {
                    return { empty: false, docs: [{ id: 'existing-id' }] };
                  }
                  return { empty: true, docs: [] };
                },
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const res = await request(app)
        .post('/api/assessments')
        .set('Authorization', `Bearer ${op1Token}`)
        .send({
          title: 'Duplicate Slug Assessment',
          slug: 'existing-duplicate-slug',
          mode: 'quiz',
        });

      expect(res.status).toBe(409);
      expect(res.body.error.message).toMatch(/already exists/i);
    });

    it('strictly overwrites client-provided ownerId with authenticated uid on create', async () => {
      const op1Token = createFakeToken('op-legit-user');
      let savedDoc: any = null;

      vi.spyOn(db, 'collection').mockImplementation((name: string) => {
        if (name === 'operators') {
          return {
            doc: () => ({
              get: async () => ({
                exists: true,
                data: () => ({ active: true, username: 'legitUser', role: 'operator' }),
              }),
            }),
          } as any;
        }
        if (name === 'assessments') {
          return {
            where: () => ({
              limit: () => ({
                get: async () => ({ empty: true, docs: [] }),
              }),
            }),
            doc: () => ({
              id: 'new-doc-id-123',
              set: async (docData: any) => {
                savedDoc = docData;
              },
            }),
          } as any;
        }
        return {} as any;
      });

      const res = await request(app)
        .post('/api/assessments')
        .set('Authorization', `Bearer ${op1Token}`)
        .send({
          title: 'New Assessment',
          slug: 'new-assessment-unique',
          mode: 'quiz',
          ownerId: 'malicious-hacker-uid', // Tamper attempt
        });

      expect(res.status).toBe(201);
      expect(savedDoc).toBeDefined();
      expect(savedDoc.ownerId).toBe('op-legit-user'); // Strictly overwritten
      expect(savedDoc.ownerId).not.toBe('malicious-hacker-uid');
      expect(savedDoc.createdBy).toBe('legitUser');
    });

    it('forbids an operator from editing another owner\'s assessment with 403 Forbidden', async () => {
      const op2Token = createFakeToken('op-attacker');

      const existingDoc = {
        id: 'doc-owned-by-op1',
        title: 'Original Title',
        slug: 'original-slug',
        ownerId: 'op-legit-user',
        createdBy: 'legitUser',
        settings: {},
      };

      vi.spyOn(db, 'collection').mockImplementation((name: string) => {
        if (name === 'operators') {
          return {
            doc: () => ({
              get: async () => ({
                exists: true,
                data: () => ({ active: true, username: 'attacker', role: 'operator' }),
              }),
            }),
          } as any;
        }
        if (name === 'assessments') {
          return {
            doc: (docId: string) => ({
              get: async () => {
                if (docId === 'doc-owned-by-op1') {
                  return {
                    exists: true,
                    id: 'doc-owned-by-op1',
                    data: () => existingDoc,
                  };
                }
                return { exists: false };
              },
            }),
          } as any;
        }
        return {} as any;
      });

      const res = await request(app)
        .patch('/api/assessments/doc-owned-by-op1')
        .set('Authorization', `Bearer ${op2Token}`)
        .send({ title: 'Hacked Title' });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/forbidden/i);
    });

    it('returns 404 when updating non-existent assessment', async () => {
      const op1Token = createFakeToken('op-1');

      vi.spyOn(db, 'collection').mockImplementation((name: string) => {
        if (name === 'operators') {
          return {
            doc: () => ({
              get: async () => ({
                exists: true,
                data: () => ({ active: true, username: 'operator1', role: 'operator' }),
              }),
            }),
          } as any;
        }
        if (name === 'assessments') {
          return {
            doc: () => ({
              get: async () => ({ exists: false }),
            }),
          } as any;
        }
        return {} as any;
      });

      const res = await request(app)
        .patch('/api/assessments/unknown-id')
        .set('Authorization', `Bearer ${op1Token}`)
        .send({ title: 'New Title' });

      expect(res.status).toBe(404);
    });
  });
});
