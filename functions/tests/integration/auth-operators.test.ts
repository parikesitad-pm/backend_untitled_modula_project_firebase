import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { seedTestOperators, clearCollection, TestAuthTokens } from '../test-helper';

describe('Auth & Operators Management Integration Tests', () => {
  let tokens: TestAuthTokens;

  beforeAll(async () => {
    await clearCollection('operators');
    await clearCollection('loginAttempts');
    tokens = await seedTestOperators();
  });

  beforeEach(async () => {
    await clearCollection('loginAttempts');
  });

  it('returns generic "Invalid credentials" error for non-existent username', async () => {
    const res = await request(app).post('/api/auth/login').send({
      username: 'non_existent_user_999',
      accessCode: 'random-access-code',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  it('returns generic "Invalid credentials" error for wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      username: 'owner',
      accessCode: 'wrong-pass-12345',
    });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe('Invalid credentials');
  });

  it('locks out account after 5 failed login attempts and sets Retry-After header', async () => {
    const targetUser = 'opuser';

    // 5 failed attempts
    for (let i = 0; i < 5; i++) {
      const res = await request(app).post('/api/auth/login').send({
        username: targetUser,
        accessCode: 'bad-code',
      });
      expect(res.status).toBe(401);
    }

    // Next attempt is blocked with 429
    const resBlocked = await request(app).post('/api/auth/login').send({
      username: targetUser,
      accessCode: 'bad-code',
    });
    expect(resBlocked.status).toBe(429);
    expect(resBlocked.body.error.code).toBe('RATE_LIMITED');
    expect(resBlocked.headers['retry-after']).toBeDefined();
  });

  it('resets failure counter on successful login', async () => {
    // 2 failed attempts for owner
    for (let i = 0; i < 2; i++) {
      await request(app).post('/api/auth/login').send({
        username: 'owner',
        accessCode: 'wrong-pass',
      });
    }

    // Successful login
    const okRes = await request(app).post('/api/auth/login').send({
      username: 'owner',
      accessCode: 'owner-secret-2026',
    });
    expect(okRes.status).toBe(200);

    // After success, another 4 bad attempts should still be 401, not 429
    for (let i = 0; i < 4; i++) {
      const res = await request(app).post('/api/auth/login').send({
        username: 'owner',
        accessCode: 'wrong-pass',
      });
      expect(res.status).toBe(401);
    }
  });

  it('enforces role hierarchy (owner cannot create another owner or crown)', async () => {
    // Owner cannot create owner
    const failOwnerRes = await request(app)
      .post('/api/operators')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        username: 'new_owner',
        accessCode: 'StrongPass123!45',
        role: 'owner',
      });
    expect(failOwnerRes.status).toBe(403);

    // Crown can create an owner
    const crownCreateRes = await request(app)
      .post('/api/operators')
      .set('Authorization', `Bearer ${tokens.crownToken}`)
      .send({
        username: 'crown_created_owner',
        accessCode: 'StrongPass123!45',
        role: 'owner',
      });
    expect(crownCreateRes.status).toBe(201);
  });

  it('protects last owner from deactivation or demotion (LAST_OWNER_PROTECTION 409)', async () => {
    // Get list of operators to find owners
    const listRes = await request(app)
      .get('/api/operators')
      .set('Authorization', `Bearer ${tokens.crownToken}`);
    const owners = listRes.body.data.filter((o: any) => o.role === 'owner' && o.active);

    // Deactivate all except one
    for (let i = 1; i < owners.length; i++) {
      await request(app)
        .post(`/api/operators/${owners[i].uid}/deactivate`)
        .set('Authorization', `Bearer ${tokens.crownToken}`);
    }

    // Try to deactivate the single remaining active owner
    const lastOwnerId = owners[0].uid;
    const deactRes = await request(app)
      .post(`/api/operators/${lastOwnerId}/deactivate`)
      .set('Authorization', `Bearer ${tokens.crownToken}`);
    expect(deactRes.status).toBe(409);
    expect(deactRes.body.error.code).toBe('LAST_OWNER_PROTECTION');

    // Try to demote the single remaining active owner
    const demoteRes = await request(app)
      .patch(`/api/operators/${lastOwnerId}`)
      .set('Authorization', `Bearer ${tokens.crownToken}`)
      .send({ role: 'operator' });
    expect(demoteRes.status).toBe(409);
    expect(demoteRes.body.error.code).toBe('LAST_OWNER_PROTECTION');
  });

  it('never exposes password hashes in any API response', async () => {
    const listRes = await request(app)
      .get('/api/operators')
      .set('Authorization', `Bearer ${tokens.crownToken}`);
    expect(listRes.status).toBe(200);

    for (const op of listRes.body.data) {
      expect(op).not.toHaveProperty('accessCodeHash');
      expect(op).not.toHaveProperty('password');
      expect(op).not.toHaveProperty('accessCode');
    }
  });

  it('rejects deactivated operator on login and API requests', async () => {
    // Create new operator
    const createRes = await request(app)
      .post('/api/operators')
      .set('Authorization', `Bearer ${tokens.crownToken}`)
      .send({
        username: 'temp_to_deactivate',
        accessCode: 'ValidCode123456!',
        role: 'operator',
      });
    const opId = createRes.body.data.uid;

    // Login while active
    const loginRes = await request(app).post('/api/auth/login').send({
      username: 'temp_to_deactivate',
      accessCode: 'ValidCode123456!',
    });
    expect(loginRes.status).toBe(200);
    const token = loginRes.body.data.token;

    // Deactivate operator
    await request(app)
      .post(`/api/operators/${opId}/deactivate`)
      .set('Authorization', `Bearer ${tokens.crownToken}`);

    // Login attempt while deactivated returns 401 "Invalid credentials"
    const loginDeactRes = await request(app).post('/api/auth/login').send({
      username: 'temp_to_deactivate',
      accessCode: 'ValidCode123456!',
    });
    expect(loginDeactRes.status).toBe(401);
    expect(loginDeactRes.body.error.message).toBe('Invalid credentials');

    // API request with previously minted token is rejected (401 or 403)
    const apiRes = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect([401, 403]).toContain(apiRes.status);
  });
});
