import { describe, it, expect, beforeAll, beforeEach, vi, afterEach } from 'vitest';
import request from 'supertest';
import { v2 as cloudinary } from 'cloudinary';
import { app } from '../../src/app';
import { db } from '../../src/config/firebase';
import { env } from '../../src/config/env';
import { clearCollection, seedTestOperators, TestAuthTokens } from '../test-helper';
import { getAssetStorageProvider, CloudinaryAssetStorageProvider } from '../../src/modules/assets/providers';

describe('Cloudinary Media Migration Integration Tests', () => {
  let tokens: TestAuthTokens;
  let activityId: string;
  let activity2Id: string;
  let questionId: string;
  let question2Id: string;
  const activitySlug = 'cld-test-act-' + Date.now();

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

    tokens = await seedTestOperators();
  });

  beforeEach(async () => {
    // Seed Activity 1 (created by owner)
    const act1Ref = db.collection('activities').doc('cld-act-1');
    activityId = act1Ref.id;
    await act1Ref.set({
      id: activityId,
      title: 'Cloudinary Test Activity',
      slug: activitySlug,
      mode: 'quiz',
      phase: 'standalone',
      status: 'draft',
      createdBy: 'test-owner-uid',
      opensAt: new Date(Date.now() - 3600000).toISOString(),
      closesAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Question 1 for Activity 1
    const q1Ref = db.collection('questions').doc('cld-q-1');
    questionId = q1Ref.id;
    await q1Ref.set({
      id: questionId,
      activityId,
      body: 'Identify the cloud architectural pattern in the diagram.',
      type: 'multiple_choice',
      position: 0,
      weight: 1,
      speedBonusEnabled: false,
      speedBonusPercent: 20,
      timeReferenceSeconds: 30,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const c1Ref = db.collection('choices').doc('cld-c-1');
    await c1Ref.set({
      id: 'cld-c-1',
      questionId,
      body: 'Event-driven',
      position: 0,
      isCorrect: true,
    });
    const c2Ref = db.collection('choices').doc('cld-c-2');
    await c2Ref.set({
      id: 'cld-c-2',
      questionId,
      body: 'Monolith',
      position: 1,
      isCorrect: false,
    });

    // Seed Activity 2 (created by manager)
    const act2Ref = db.collection('activities').doc('cld-act-2');
    activity2Id = act2Ref.id;
    await act2Ref.set({
      id: activity2Id,
      title: 'Manager Cloudinary Activity',
      slug: activitySlug + '-mgr',
      mode: 'quiz',
      phase: 'standalone',
      status: 'draft',
      createdBy: 'test-mgr-uid',
      opensAt: new Date(Date.now() - 3600000).toISOString(),
      closesAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const q2Ref = db.collection('questions').doc('cld-q-2');
    question2Id = q2Ref.id;
    await q2Ref.set({
      id: question2Id,
      activityId: activity2Id,
      body: 'Manager Question',
      type: 'multiple_choice',
      position: 0,
      weight: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. unauthenticated upload intent -> 401
  it('1. unauthenticated upload intent returns 401 Unauthorized', async () => {
    const res = await request(app)
      .post('/api/assets/upload-intent')
      .send({
        activityId,
        questionId,
        fileName: 'diagram.png',
        mimeType: 'image/png',
        sizeBytes: 120000,
        width: 800,
        height: 600,
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // 2. unauthorized activity/question -> 403
  it('2. unauthorized activity or question returns 403 Forbidden', async () => {
    // 2a. Operator trying to upload for activity owned by manager
    const resForbiddenActivity = await request(app)
      .post('/api/assets/upload-intent')
      .set('Authorization', `Bearer ${tokens.operatorToken}`)
      .send({
        activityId: activity2Id,
        questionId: question2Id,
        fileName: 'diagram.png',
        mimeType: 'image/png',
        sizeBytes: 120000,
        width: 800,
        height: 600,
      });

    expect(resForbiddenActivity.status).toBe(403);
    expect(resForbiddenActivity.body.error.code).toBe('UNAUTHORIZED_ACTIVITY');

    // 2b. Question belongs to activity 2, but request specifies activity 1 (mismatch)
    const resMismatch = await request(app)
      .post('/api/assets/upload-intent')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        activityId,
        questionId: question2Id, // question2 belongs to activity2Id
        fileName: 'diagram.png',
        mimeType: 'image/png',
        sizeBytes: 120000,
        width: 800,
        height: 600,
      });

    expect(resMismatch.status).toBe(403);
    expect(resMismatch.body.error.code).toBe('QUESTION_ACTIVITY_MISMATCH');
  });

  // 3. unsupported MIME -> 422
  it('3. unsupported MIME type returns 422 Unprocessable Entity', async () => {
    const res = await request(app)
      .post('/api/assets/upload-intent')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        activityId,
        questionId,
        fileName: 'diagram.gif',
        mimeType: 'image/gif',
        sizeBytes: 120000,
        width: 800,
        height: 600,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  // 4. >5 MB declared size -> 422
  it('4. declared size > 5 MB returns 422 Unprocessable Entity', async () => {
    const res = await request(app)
      .post('/api/assets/upload-intent')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        activityId,
        questionId,
        fileName: 'huge.png',
        mimeType: 'image/png',
        sizeBytes: 5 * 1024 * 1024 + 1, // 5242881 bytes
        width: 800,
        height: 600,
      });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  // 5. signed intent never contains API secret
  it('5. signed intent response never exposes Cloudinary API secret', async () => {
    const res = await request(app)
      .post('/api/assets/upload-intent')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        activityId,
        questionId,
        fileName: 'diagram.png',
        mimeType: 'image/png',
        sizeBytes: 120000,
        width: 800,
        height: 600,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const data = res.body.data;

    expect(data.provider).toBe('cloudinary');
    expect(data.apiKey).toBeDefined();
    expect(data.signature).toBeDefined();
    expect(data).not.toHaveProperty('apiSecret');
    expect(data).not.toHaveProperty('api_secret');

    // Ensure raw secret string never appears in entire response body
    if (env.CLOUDINARY_API_SECRET) {
      expect(JSON.stringify(res.body)).not.toContain(env.CLOUDINARY_API_SECRET);
    }
  });

  // 6. dynamic asset folder is correct
  it('6. generates correct dynamic asset folder structure', async () => {
    const res = await request(app)
      .post('/api/assets/upload-intent')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        activityId,
        questionId,
        fileName: 'diagram.webp',
        mimeType: 'image/webp',
        sizeBytes: 50000,
        width: 400,
        height: 300,
      });

    expect(res.status).toBe(200);
    const root = env.CLOUDINARY_ROOT_ASSET_FOLDER || 'untitled-modula';
    const expectedFolder = `${root}/workspaces/default/activities/${activityId}/questions/${questionId}`;
    expect(res.body.data.assetFolder).toBe(expectedFolder);
  });

  // 7. public ID is generated server-side
  it('7. public ID is generated server-side and does not use client filename', async () => {
    const clientFileName = 'dangerous_override_name.png';
    const res1 = await request(app)
      .post('/api/assets/upload-intent')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        activityId,
        questionId,
        fileName: clientFileName,
        mimeType: 'image/png',
        sizeBytes: 50000,
        width: 400,
        height: 300,
      });

    const res2 = await request(app)
      .post('/api/assets/upload-intent')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        activityId,
        questionId,
        fileName: clientFileName,
        mimeType: 'image/png',
        sizeBytes: 50000,
        width: 400,
        height: 300,
      });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.data.publicId).not.toContain('dangerous');
    expect(res1.body.data.publicId).not.toContain('.png');
    // Unguessable and distinct across invocations
    expect(res1.body.data.publicId).not.toBe(res2.body.data.publicId);
    expect(res1.body.data.publicId.length).toBeGreaterThanOrEqual(16);
  });

  // 8. confirm rejects unknown/nonexistent Cloudinary asset
  it('8. confirm rejects unknown or nonexistent Cloudinary asset with 422', async () => {
    vi.spyOn(cloudinary.api, 'resource').mockRejectedValueOnce(new Error('Resource not found'));

    const res = await request(app)
      .post('/api/assets/confirm')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        activityId,
        questionId,
        publicId: 'unknown-asset-id',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ASSET_NOT_FOUND');
  });

  // 9. confirm rejects wrong format
  it('9. confirm rejects asset with unsupported format with 422', async () => {
    const root = env.CLOUDINARY_ROOT_ASSET_FOLDER || 'untitled-modula';
    const folder = `${root}/workspaces/default/activities/${activityId}/questions/${questionId}`;

    vi.spyOn(cloudinary.api, 'resource').mockResolvedValueOnce({
      asset_id: 'cld-wrong-format-id',
      public_id: 'test-wrong-format',
      format: 'pdf',
      resource_type: 'image',
      bytes: 100000,
      width: 500,
      height: 500,
      version: 1,
      secure_url: 'https://res.cloudinary.com/test/image/upload/v1/test-wrong-format.pdf',
      asset_folder: folder,
    } as any);

    const res = await request(app)
      .post('/api/assets/confirm')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        activityId,
        questionId,
        publicId: 'test-wrong-format',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_ASSET_FORMAT');
  });

  // 10. confirm rejects oversize asset
  it('10. confirm rejects oversize asset with 422', async () => {
    const root = env.CLOUDINARY_ROOT_ASSET_FOLDER || 'untitled-modula';
    const folder = `${root}/workspaces/default/activities/${activityId}/questions/${questionId}`;

    vi.spyOn(cloudinary.api, 'resource').mockResolvedValueOnce({
      asset_id: 'cld-oversize-id',
      public_id: 'test-oversize',
      format: 'png',
      resource_type: 'image',
      bytes: 6 * 1024 * 1024, // 6 MB > 5 MB
      width: 4000,
      height: 3000,
      version: 1,
      secure_url: 'https://res.cloudinary.com/test/image/upload/v1/test-oversize.png',
      asset_folder: folder,
    } as any);

    const res = await request(app)
      .post('/api/assets/confirm')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        activityId,
        questionId,
        publicId: 'test-oversize',
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ASSET_OVERSIZE');
  });

  // 11. confirm succeeds and persists trusted metadata
  it('11. confirm succeeds and persists trusted Cloudinary metadata on question', async () => {
    const root = env.CLOUDINARY_ROOT_ASSET_FOLDER || 'untitled-modula';
    const folder = `${root}/workspaces/default/activities/${activityId}/questions/${questionId}`;
    const pubId = 'valid-uploaded-pub-id-11';

    vi.spyOn(cloudinary.api, 'resource').mockResolvedValueOnce({
      asset_id: 'cld-asset-11',
      public_id: pubId,
      format: 'png',
      resource_type: 'image',
      bytes: 350000,
      width: 1200,
      height: 800,
      version: 1700000011,
      secure_url: `https://res.cloudinary.com/test/image/upload/v1700000011/${folder}/${pubId}.png`,
      asset_folder: folder,
    } as any);

    const res = await request(app)
      .post('/api/assets/confirm')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({
        activityId,
        questionId,
        publicId: pubId,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.asset).toBeDefined();
    expect(res.body.data.asset.provider).toBe('cloudinary');
    expect(res.body.data.asset.publicId).toBe(pubId);
    expect(res.body.data.asset.bytes).toBe(350000);
    expect(res.body.data.deliveryUrl).toBeDefined();

    // Check Firestore persistence
    const qDoc = await db.collection('questions').doc(questionId).get();
    expect(qDoc.exists).toBe(true);
    const qData = qDoc.data();
    expect(qData?.asset).toBeDefined();
    expect(qData?.asset.publicId).toBe(pubId);
    expect(qData?.asset.provider).toBe('cloudinary');
    expect(qData?.imageUrl).toBe(res.body.data.deliveryUrl);
  });

  // 12. confirm is idempotent
  it('12. confirm is idempotent on repeated calls', async () => {
    const root = env.CLOUDINARY_ROOT_ASSET_FOLDER || 'untitled-modula';
    const folder = `${root}/workspaces/default/activities/${activityId}/questions/${questionId}`;
    const pubId = 'idempotent-pub-id-12';

    vi.spyOn(cloudinary.api, 'resource').mockResolvedValue({
      asset_id: 'cld-asset-12',
      public_id: pubId,
      format: 'webp',
      resource_type: 'image',
      bytes: 200000,
      width: 1000,
      height: 700,
      version: 1700000012,
      secure_url: `https://res.cloudinary.com/test/image/upload/v1700000012/${folder}/${pubId}.webp`,
      asset_folder: folder,
    } as any);

    // Call 1
    const res1 = await request(app)
      .post('/api/assets/confirm')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({ activityId, questionId, publicId: pubId });
    expect(res1.status).toBe(200);

    // Call 2
    const res2 = await request(app)
      .post('/api/assets/confirm')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({ activityId, questionId, publicId: pubId });
    expect(res2.status).toBe(200);
    expect(res2.body.data.asset.publicId).toBe(pubId);
    expect(res2.body.data.deliveryUrl).toBe(res1.body.data.deliveryUrl);
  });

  // 13. participant payload uses trusted Cloudinary delivery URL
  // 13. participant payload uses trusted Cloudinary delivery URL
  it('13. participant payload receives trusted Cloudinary delivery URL', async () => {
    const root = env.CLOUDINARY_ROOT_ASSET_FOLDER || 'untitled-modula';
    const folder = `${root}/workspaces/default/activities/${activityId}/questions/${questionId}`;
    const pubId = 'participant-pub-id-13';

    vi.spyOn(cloudinary.api, 'resource').mockResolvedValueOnce({
      asset_id: 'cld-asset-13',
      public_id: pubId,
      format: 'png',
      resource_type: 'image',
      bytes: 250000,
      width: 1000,
      height: 600,
      version: 1700000013,
      secure_url: `https://res.cloudinary.com/test/image/upload/v1700000013/${folder}/${pubId}.png`,
      asset_folder: folder,
    } as any);

    const resConfirm = await request(app)
      .post('/api/assets/confirm')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({ activityId, questionId, publicId: pubId });
    expect(resConfirm.status).toBe(200);

    // Publish activity
    await request(app)
      .post(`/api/activities/${activityId}/publish`)
      .set('Authorization', `Bearer ${tokens.ownerToken}`);

    // Participant starts attempt
    const resStart = await request(app)
      .post(`/api/public/${activitySlug}/start`)
      .send({
        name: 'Media Participant',
        participantCode: 'MED-001',
        email: 'media@example.com',
      });

    expect(resStart.status).toBe(201);
    const firstQ = resStart.body.data.firstQuestion;
    expect(firstQ).toBeDefined();
    expect(firstQ.id).toBe(questionId);
    expect(firstQ.imageUrl).toBeDefined();
    // Delivery URL contains Cloudinary hostname and no secrets
    expect(firstQ.imageUrl).toContain('res.cloudinary.com');
    expect(firstQ).not.toHaveProperty('asset'); // Internal admin asset metadata not leaked
  });

  // 14. deleting/replacing media does not leave broken Firestore references
  it('14. deleting and replacing media cleans up Cloudinary assets safely', async () => {
    const root = env.CLOUDINARY_ROOT_ASSET_FOLDER || 'untitled-modula';
    const folder = `${root}/workspaces/default/activities/${activityId}/questions/${questionId}`;
    const destroySpy = vi.spyOn(cloudinary.uploader, 'destroy').mockResolvedValue({ result: 'ok' });

    // 14a. Replacement: attach initial asset first
    const initialPubId = 'initial-pub-id-14';
    await db.collection('questions').doc(questionId).update({
      asset: {
        assetId: 'cld-asset-14-initial',
        publicId: initialPubId,
        version: 1700000000,
        resourceType: 'image',
        format: 'png',
        width: 800,
        height: 600,
        bytes: 150000,
        secureUrl: `https://res.cloudinary.com/test/image/upload/v1700000000/${folder}/${initialPubId}.png`,
        assetFolder: folder,
        provider: 'cloudinary',
      },
    });

    const newPubId = 'replaced-pub-id-14';
    vi.spyOn(cloudinary.api, 'resource').mockResolvedValueOnce({
      asset_id: 'cld-asset-14-new',
      public_id: newPubId,
      format: 'png',
      resource_type: 'image',
      bytes: 180000,
      width: 900,
      height: 600,
      version: 1700000014,
      secure_url: `https://res.cloudinary.com/test/image/upload/v1700000014/${folder}/${newPubId}.png`,
      asset_folder: folder,
    } as any);

    const resReplace = await request(app)
      .post('/api/assets/confirm')
      .set('Authorization', `Bearer ${tokens.ownerToken}`)
      .send({ activityId, questionId, publicId: newPubId });

    expect(resReplace.status).toBe(200);
    // Old asset ('initial-pub-id-14') was destroyed
    expect(destroySpy).toHaveBeenCalledWith(initialPubId, { invalidate: true });

    // Question document now points to newPubId
    const qDoc = await db.collection('questions').doc(questionId).get();
    expect(qDoc.data()?.asset.publicId).toBe(newPubId);

    // 14b. Question deletion cleans up media
    const qTempRef = db.collection('questions').doc('cld-q-temp');
    await qTempRef.set({
      id: 'cld-q-temp',
      activityId: activity2Id,
      body: 'Temporary question to be deleted',
      type: 'multiple_choice',
      position: 1,
      weight: 1,
      asset: {
        assetId: 'cld-asset-to-delete',
        publicId: 'cld-pub-to-delete',
        version: 1,
        resourceType: 'image',
        format: 'png',
        width: 100,
        height: 100,
        bytes: 1000,
        secureUrl: 'https://res.cloudinary.com/test/image/upload/v1/cld-pub-to-delete.png',
        assetFolder: folder,
        provider: 'cloudinary',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const provider = getAssetStorageProvider();
    const providerDestroySpy = vi.spyOn(provider, 'deleteAsset').mockResolvedValue();

    // Call delete question through service
    const { questionsService } = await import('../../src/modules/questions/questions.service');
    await questionsService.delete('cld-q-temp');

    expect(providerDestroySpy).toHaveBeenCalledWith('cld-pub-to-delete');
    const qDeletedDoc = await db.collection('questions').doc('cld-q-temp').get();
    expect(qDeletedDoc.exists).toBe(false);
  });
});

