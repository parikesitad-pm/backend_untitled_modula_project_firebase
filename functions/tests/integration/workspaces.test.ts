import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { db, auth } from '../../src/config/firebase';
import { clearCollection, seedTestOperators, TestAuthTokens } from '../test-helper';
import { hashAccessCode } from '../../src/lib/hash';
import { runMigration } from '../../scripts/migrate-workspaces';

describe('Multi-Workspace Isolation & Client Accounts Integration Tests', () => {
  let tokens: TestAuthTokens;
  let ownerToken: string;

  let briAdminToken: string;
  let briEditorToken: string;
  let briViewerToken: string;
  let pelniEditorToken: string;

  let briActId: string;
  let pelniActId: string;
  let briQId: string;

  const briSlug = 'bri-act-' + Date.now();
  const pelniSlug = 'pelni-act-' + Date.now();

  beforeAll(async () => {
    await clearCollection('operators');
    await clearCollection('workspaces');
    await clearCollection('memberships');
    await clearCollection('activities');
    await clearCollection('questions');
    await clearCollection('choices');
    await clearCollection('participants');
    await clearCollection('attempts');
    await clearCollection('answers');
    await clearCollection('leaderboardSnapshots');
    await clearCollection('statsSnapshots');
    await clearCollection('loginAttempts');

    tokens = await seedTestOperators();
    ownerToken = tokens.ownerToken;

    // 1. Create Workspaces: 'bri' and 'pelni'
    const now = new Date().toISOString();
    await db.collection('workspaces').doc('bri').set({
      id: 'bri',
      name: 'Bank Rakyat Indonesia',
      slug: 'bri',
      status: 'active',
      createdBy: 'test-owner-uid',
      createdAt: now,
      updatedAt: now,
    });

    await db.collection('workspaces').doc('pelni').set({
      id: 'pelni',
      name: 'Pelni Shipping',
      slug: 'pelni',
      status: 'active',
      createdBy: 'test-owner-uid',
      createdAt: now,
      updatedAt: now,
    });

    // 2. Create Operators and Memberships
    const hash = await hashAccessCode('SecurePassword123!@#');

    // BRI Admin
    await db.collection('operators').doc('bri-admin-uid').set({
      uid: 'bri-admin-uid',
      username: 'bri_admin',
      usernameNormalized: 'bri_admin',
      accessCodeHash: hash,
      platformRole: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('memberships').doc('bri_bri-admin-uid').set({
      id: 'bri_bri-admin-uid',
      workspaceId: 'bri',
      uid: 'bri-admin-uid',
      role: 'workspace_admin',
      active: true,
      createdBy: 'test-owner-uid',
      createdAt: now,
      updatedAt: now,
    });
    briAdminToken = await auth.createCustomToken('bri-admin-uid');

    // BRI Editor
    await db.collection('operators').doc('bri-editor-uid').set({
      uid: 'bri-editor-uid',
      username: 'bri_editor',
      usernameNormalized: 'bri_editor',
      accessCodeHash: hash,
      platformRole: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('memberships').doc('bri_bri-editor-uid').set({
      id: 'bri_bri-editor-uid',
      workspaceId: 'bri',
      uid: 'bri-editor-uid',
      role: 'editor',
      active: true,
      createdBy: 'test-owner-uid',
      createdAt: now,
      updatedAt: now,
    });
    briEditorToken = await auth.createCustomToken('bri-editor-uid');

    // BRI Viewer
    await db.collection('operators').doc('bri-viewer-uid').set({
      uid: 'bri-viewer-uid',
      username: 'bri_viewer',
      usernameNormalized: 'bri_viewer',
      accessCodeHash: hash,
      platformRole: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('memberships').doc('bri_bri-viewer-uid').set({
      id: 'bri_bri-viewer-uid',
      workspaceId: 'bri',
      uid: 'bri-viewer-uid',
      role: 'viewer',
      active: true,
      createdBy: 'test-owner-uid',
      createdAt: now,
      updatedAt: now,
    });
    briViewerToken = await auth.createCustomToken('bri-viewer-uid');

    // Pelni Editor
    await db.collection('operators').doc('pelni-editor-uid').set({
      uid: 'pelni-editor-uid',
      username: 'pelni_editor',
      usernameNormalized: 'pelni_editor',
      accessCodeHash: hash,
      platformRole: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await db.collection('memberships').doc('pelni_pelni-editor-uid').set({
      id: 'pelni_pelni-editor-uid',
      workspaceId: 'pelni',
      uid: 'pelni-editor-uid',
      role: 'editor',
      active: true,
      createdBy: 'test-owner-uid',
      createdAt: now,
      updatedAt: now,
    });
    pelniEditorToken = await auth.createCustomToken('pelni-editor-uid');

    // 3. Create Activities in BRI and Pelni
    const briActRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'BRI Digital Literacy',
        slug: briSlug,
        mode: 'quiz',
        workspaceId: 'bri',
        opensAt: new Date(Date.now() - 3600000).toISOString(),
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(briActRes.status).toBe(201);
    briActId = briActRes.body.data.id;

    const pelniActRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Pelni Nautical Safety',
        slug: pelniSlug,
        mode: 'quiz',
        workspaceId: 'pelni',
        opensAt: new Date(Date.now() - 3600000).toISOString(),
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(pelniActRes.status).toBe(201);
    pelniActId = pelniActRes.body.data.id;

    // Add a Question to BRI Activity
    const qRes = await request(app)
      .post(`/api/activities/${briActId}/questions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        body: 'What is the primary banking regulation in Indonesia?',
        weight: 1,
        choices: [
          { body: 'UU Perbankan', isCorrect: true },
          { body: 'UU Pangan', isCorrect: false },
        ],
      });
    expect(qRes.status).toBe(201);
    briQId = qRes.body.data.id;
  });

  // 1. platform owner sees all workspaces
  it('1. platform owner sees all workspaces', async () => {
    const res = await request(app).get('/api/workspaces').set('Authorization', `Bearer ${ownerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const slugs = res.body.data.map((w: any) => w.slug);
    expect(slugs).toContain('bri');
    expect(slugs).toContain('pelni');
  });

  // 2. member sees only assigned workspaces
  it('2. member sees only assigned workspaces', async () => {
    const res = await request(app).get('/api/workspaces').set('Authorization', `Bearer ${briEditorToken}`);
    expect(res.status).toBe(200);
    const slugs = res.body.data.map((w: any) => w.slug);
    expect(slugs).toContain('bri');
    expect(slugs).not.toContain('pelni');
  });

  // 3. workspace A editor cannot list/read/update/delete Activity in workspace B
  it('3. workspace A editor cannot list/read/update/delete Activity in workspace B', async () => {
    // List: BRI editor does not see Pelni activity
    const listRes = await request(app).get('/api/activities').set('Authorization', `Bearer ${briEditorToken}`);
    expect(listRes.status).toBe(200);
    const ids = listRes.body.data.map((a: any) => a.id);
    expect(ids).toContain(briActId);
    expect(ids).not.toContain(pelniActId);

    // Read: 403 Forbidden
    const getRes = await request(app)
      .get(`/api/activities/${pelniActId}`)
      .set('Authorization', `Bearer ${briEditorToken}`);
    expect(getRes.status).toBe(403);
    expect(getRes.body.error.code).toBe('FORBIDDEN');

    // Update: 403 Forbidden
    const patchRes = await request(app)
      .patch(`/api/activities/${pelniActId}`)
      .set('Authorization', `Bearer ${briEditorToken}`)
      .send({ title: 'Tampered Title' });
    expect(patchRes.status).toBe(403);

    // Delete: 403 Forbidden
    const delRes = await request(app)
      .delete(`/api/activities/${pelniActId}`)
      .set('Authorization', `Bearer ${briEditorToken}`);
    expect(delRes.status).toBe(403);
  });

  // 4. IDOR using a known workspace-B Activity ID returns 403/404 safely
  it('4. IDOR using a known workspace-B Activity ID returns 403/404 safely', async () => {
    // Known workspace-B ID -> 403 Forbidden
    const res403 = await request(app)
      .get(`/api/activities/${pelniActId}`)
      .set('Authorization', `Bearer ${briEditorToken}`);
    expect(res403.status).toBe(403);
    expect(res403.body.error.code).toBe('FORBIDDEN');

    // Non-existent ID -> 404 Not Found
    const res404 = await request(app)
      .get('/api/activities/non-existent-activity-999')
      .set('Authorization', `Bearer ${briEditorToken}`);
    expect(res404.status).toBe(404);
  });

  // 5. inactive membership loses access immediately
  it('5. inactive membership loses access immediately', async () => {
    // Deactivate BRI editor membership
    await request(app)
      .patch('/api/workspaces/bri/members/bri-editor-uid')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ active: false });

    // BRI editor immediately loses access to briActId
    const resBlocked = await request(app)
      .get(`/api/activities/${briActId}`)
      .set('Authorization', `Bearer ${briEditorToken}`);
    expect(resBlocked.status).toBe(403);

    // Reactivate
    await request(app)
      .patch('/api/workspaces/bri/members/bri-editor-uid')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ active: true });

    // BRI editor regains access
    const resRestored = await request(app)
      .get(`/api/activities/${briActId}`)
      .set('Authorization', `Bearer ${briEditorToken}`);
    expect(resRestored.status).toBe(200);
  });

  // 6. editor can create/edit questions in own workspace
  it('6. editor can create/edit questions in own workspace', async () => {
    const qCreate = await request(app)
      .post(`/api/activities/${briActId}/questions`)
      .set('Authorization', `Bearer ${briEditorToken}`)
      .send({
        body: 'What is OJK?',
        weight: 1,
        choices: [
          { body: 'Otoritas Jasa Keuangan', isCorrect: true },
          { body: 'Organisasi Jual Koin', isCorrect: false },
        ],
      });
    expect(qCreate.status).toBe(201);
    const newQId = qCreate.body.data.id;

    // Edit question
    const qPatch = await request(app)
      .patch(`/api/questions/${newQId}`)
      .set('Authorization', `Bearer ${briEditorToken}`)
      .send({ body: 'What is OJK? (Updated)' });
    expect(qPatch.status).toBe(200);
    expect(qPatch.body.data.body).toBe('What is OJK? (Updated)');
  });

  // 7. editor cannot publish/close
  it('7. editor cannot publish/close', async () => {
    const pubRes = await request(app)
      .post(`/api/activities/${briActId}/publish`)
      .set('Authorization', `Bearer ${briEditorToken}`);
    expect(pubRes.status).toBe(403);
    expect(pubRes.body.error.code).toBe('FORBIDDEN');

    const closeRes = await request(app)
      .post(`/api/activities/${briActId}/close`)
      .set('Authorization', `Bearer ${briEditorToken}`);
    expect(closeRes.status).toBe(403);
  });

  // 8. workspace_admin can publish/close
  it('8. workspace_admin can publish/close', async () => {
    const pubRes = await request(app)
      .post(`/api/activities/${briActId}/publish`)
      .set('Authorization', `Bearer ${briAdminToken}`);
    expect(pubRes.status).toBe(200);
    expect(pubRes.body.data.status).toBe('published');

    const closeRes = await request(app)
      .post(`/api/activities/${briActId}/close`)
      .set('Authorization', `Bearer ${briAdminToken}`);
    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.status).toBe('closed');
  });

  // 9. editor/viewer cannot read participant PII endpoints
  it('9. editor/viewer cannot read participant PII endpoints', async () => {
    // Editor
    const edParts = await request(app)
      .get(`/api/activities/${briActId}/participants`)
      .set('Authorization', `Bearer ${briEditorToken}`);
    expect(edParts.status).toBe(403);

    const edResp = await request(app)
      .get(`/api/activities/${briActId}/responses`)
      .set('Authorization', `Bearer ${briEditorToken}`);
    expect(edResp.status).toBe(403);

    // Viewer
    const vwParts = await request(app)
      .get(`/api/activities/${briActId}/participants`)
      .set('Authorization', `Bearer ${briViewerToken}`);
    expect(vwParts.status).toBe(403);

    const vwResp = await request(app)
      .get(`/api/activities/${briActId}/responses`)
      .set('Authorization', `Bearer ${briViewerToken}`);
    expect(vwResp.status).toBe(403);
  });

  // 10. workspace_admin can read PII in own workspace
  it('10. workspace_admin can read PII in own workspace', async () => {
    const res = await request(app)
      .get(`/api/activities/${briActId}/participants`)
      .set('Authorization', `Bearer ${briAdminToken}`);
    expect(res.status).toBe(200);

    // But cannot read PII in another workspace (Pelni)
    const pelniRes = await request(app)
      .get(`/api/activities/${pelniActId}/participants`)
      .set('Authorization', `Bearer ${briAdminToken}`);
    expect(pelniRes.status).toBe(403);
  });

  // 11. platform_owner can access PII globally
  it('11. platform_owner can access PII globally', async () => {
    const briRes = await request(app)
      .get(`/api/activities/${briActId}/participants`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(briRes.status).toBe(200);

    const pelniRes = await request(app)
      .get(`/api/activities/${pelniActId}/participants`)
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(pelniRes.status).toBe(200);
  });

  // 12. viewer cannot mutate content
  it('12. viewer cannot mutate content', async () => {
    // Cannot create activity
    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${briViewerToken}`)
      .send({
        title: 'Viewer Forbidden Act',
        slug: 'viewer-forbidden-' + Date.now(),
        mode: 'quiz',
        workspaceId: 'bri',
        opensAt: new Date().toISOString(),
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(actRes.status).toBe(403);

    // Cannot update activity
    const patchRes = await request(app)
      .patch(`/api/activities/${briActId}`)
      .set('Authorization', `Bearer ${briViewerToken}`)
      .send({ title: 'Viewer Mod' });
    expect(patchRes.status).toBe(403);

    // Cannot create question
    const qRes = await request(app)
      .post(`/api/activities/${briActId}/questions`)
      .set('Authorization', `Bearer ${briViewerToken}`)
      .send({
        body: 'Viewer Q',
        weight: 1,
        choices: [{ body: 'A', isCorrect: true }],
      });
    expect(qRes.status).toBe(403);
  });

  // 13. new Cloudinary upload intent uses authoritative Activity workspace ID
  it('13. new Cloudinary upload intent uses authoritative Activity workspace ID', async () => {
    const res = await request(app)
      .post('/api/assets/upload-intent')
      .set('Authorization', `Bearer ${briEditorToken}`)
      .send({
        activityId: briActId,
        questionId: briQId,
        fileName: 'bank-diagram.png',
        mimeType: 'image/png',
        sizeBytes: 15000,
        width: 800,
        height: 600,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Asset folder must include /workspaces/bri/activities/
    expect(res.body.data.assetFolder).toContain('/workspaces/bri/activities/');
  });

  // 14. forged workspace ID cannot redirect asset folder
  it('14. forged workspace ID cannot redirect asset folder', async () => {
    const res = await request(app)
      .post('/api/assets/upload-intent')
      .set('Authorization', `Bearer ${briEditorToken}`)
      .send({
        activityId: briActId,
        questionId: briQId,
        workspaceId: 'pelni', // malicious attempt to forge workspace folder
        fileName: 'forged.png',
        mimeType: 'image/png',
        sizeBytes: 15000,
        width: 800,
        height: 600,
      });

    expect(res.status).toBe(200);
    // Server must strictly derive from authoritative Activity record (bri)
    expect(res.body.data.assetFolder).toContain('/workspaces/bri/activities/');
    expect(res.body.data.assetFolder).not.toContain('/workspaces/pelni/');
  });

  // 15. cross-workspace pre/post grouping/comparison is rejected
  it('15. cross-workspace pre/post grouping/comparison is rejected', async () => {
    const groupId = 'shared-cross-group-' + Date.now();

    // Create pre activity in BRI
    const preRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Pre Test BRI',
        slug: 'pre-bri-' + Date.now(),
        mode: 'quiz',
        phase: 'pre',
        groupId,
        workspaceId: 'bri',
        opensAt: new Date().toISOString(),
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(preRes.status).toBe(201);

    // Attempt to create post activity in Pelni with the SAME groupId -> Must be rejected
    const postRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Post Test Pelni (Illegal Cross-Workspace)',
        slug: 'post-pelni-' + Date.now(),
        mode: 'quiz',
        phase: 'post',
        groupId,
        workspaceId: 'pelni',
        opensAt: new Date().toISOString(),
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });
    expect(postRes.status).toBe(400);
    expect(postRes.body.error.code).toBe('CROSS_WORKSPACE_GROUP');
  });

  // 16. public participant/start/enter/answer flow remains functional without workspace membership
  it('16. public participant/start/enter/answer flow remains functional without workspace membership', async () => {
    const pubSlug = 'public-flow-' + Date.now();
    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Public Participant Flow',
        slug: pubSlug,
        mode: 'quiz',
        workspaceId: 'bri',
        opensAt: new Date(Date.now() - 3600000).toISOString(),
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });
    const actId = actRes.body.data.id;

    const qRes = await request(app)
      .post(`/api/activities/${actId}/questions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        body: 'Public Question',
        weight: 1,
        choices: [
          { body: 'Correct', isCorrect: true },
          { body: 'Incorrect', isCorrect: false },
        ],
      });
    const choiceId = qRes.body.data.choices[0].id;

    // Publish
    await request(app)
      .post(`/api/activities/${actId}/publish`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Public start without any token
    const startRes = await request(app)
      .post(`/api/public/${pubSlug}/start`)
      .send({
        name: 'Budi Participant',
        participantCode: 'BUDI-001',
      });
    expect(startRes.status).toBe(201);
    expect(startRes.body.data.attemptToken).toBeDefined();

    const attemptId = startRes.body.data.attempt.id;
    const attemptToken = startRes.body.data.attemptToken;

    // Enter question
    const enterRes = await request(app)
      .post(`/api/attempts/${attemptId}/questions/${qRes.body.data.id}/enter`)
      .set('X-Attempt-Token', attemptToken);
    expect(enterRes.status).toBe(200);

    // Answer
    const answerRes = await request(app)
      .post(`/api/attempts/${attemptId}/answers`)
      .set('X-Attempt-Token', attemptToken)
      .send({
        questionId: qRes.body.data.id,
        selectedChoiceIds: [choiceId],
      });
    expect(answerRes.status).toBe(200);
  });

  // 17. public leaderboard behavior remains unchanged
  it('17. public leaderboard behavior remains unchanged', async () => {
    const lbSlug = 'leaderboard-test-' + Date.now();
    const actRes = await request(app)
      .post('/api/activities')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        title: 'Leaderboard Test',
        slug: lbSlug,
        mode: 'quiz',
        workspaceId: 'bri',
        opensAt: new Date(Date.now() - 3600000).toISOString(),
        closesAt: new Date(Date.now() + 86400000).toISOString(),
      });
    const actId = actRes.body.data.id;

    await request(app)
      .post(`/api/activities/${actId}/questions`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({
        body: 'Leaderboard Q',
        weight: 1,
        choices: [{ body: 'A', isCorrect: true }],
      });

    await request(app)
      .post(`/api/activities/${actId}/publish`)
      .set('Authorization', `Bearer ${ownerToken}`);

    // Public leaderboard route: GET /api/leaderboards/:slug
    const lbRes = await request(app).get(`/api/leaderboards/${lbSlug}`);
    expect(lbRes.status).toBe(200);
    expect(lbRes.body.success).toBe(true);
    expect(lbRes.body.data.entries).toBeDefined();
  });

  // 18. migration script dry-run mutates nothing
  it('18. migration script dry-run mutates nothing', async () => {
    // Seed unmigrated legacy operator
    const legacyUid = 'unmigrated-legacy-user';
    await db.collection('operators').doc(legacyUid).set({
      uid: legacyUid,
      username: 'legacy_user',
      usernameNormalized: 'legacy_user',
      role: 'operator',
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const res = await runMigration({ apply: false });
    expect(res.dryRun).toBe(true);

    // Verify document was not mutated
    const doc = await db.collection('operators').doc(legacyUid).get();
    expect(doc.data()?.platformRole).toBeUndefined();

    // Verify membership was not created
    const memDoc = await db.collection('memberships').doc(`internal_${legacyUid}`).get();
    expect(memDoc.exists).toBe(false);
  });

  // 19. migration script apply is idempotent
  it('19. migration script apply is idempotent', async () => {
    const legacyUid = 'unmigrated-legacy-user';

    // Apply migration
    const res1 = await runMigration({ apply: true });
    expect(res1.dryRun).toBe(false);

    const docAfter = await db.collection('operators').doc(legacyUid).get();
    expect(docAfter.data()?.platformRole).toBe(null);

    const memAfter = await db.collection('memberships').doc(`internal_${legacyUid}`).get();
    expect(memAfter.exists).toBe(true);
    expect(memAfter.data()?.role).toBe('editor');

    // Run again -> Idempotent
    const res2 = await runMigration({ apply: true });
    expect(res2.operatorsUpdated).toBe(0);
    expect(res2.membershipsCreated).toBe(0);
  });
});

