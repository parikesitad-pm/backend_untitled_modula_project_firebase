import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { db } from '../../src/config/firebase';
import { seedTestOperators, clearCollection, TestAuthTokens } from '../test-helper';
import { setSystemClock, MockClock, SystemClock } from '../../src/lib/clock';
import { leaderboardService } from '../../src/modules/leaderboard/leaderboard.service';
import { compareLeaderboardEntries, LeaderboardRankable } from '../../src/lib/scoring';

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

describe('Sprint 1.1 ADDENDUM 2 Tests (Final Corrections)', () => {
  let tokens: TestAuthTokens;
  let mockClock: MockClock;

  beforeAll(async () => {
    mockClock = new MockClock('2026-10-05T10:00:00Z');
    setSystemClock(mockClock);

    await clearCollection('operators');
    await clearCollection('activities');
    await clearCollection('questions');
    await clearCollection('choices');
    await clearCollection('participants');
    await clearCollection('attempts');
    await clearCollection('answers');
    await clearCollection('leaderboardSnapshots');
    await clearCollection('statsSnapshots');
    await clearCollection('questionStates');
    await clearCollection('attemptSnapshots');
    await clearCollection('activityGroupPhases');

    tokens = await seedTestOperators();
  });

  // ==========================================
  // SECTION H: QUESTION REVEAL & ANTI-CHEAT
  // ==========================================
  describe('H. Question Reveal & Timer Anti-Cheat', () => {
    const slug = 'reveal-timing-act';
    let actId: string;
    let q1Id: string;
    let q2Id: string;
    let q1ChoiceId: string;
    let q2ChoiceId: string;

    beforeAll(async () => {
      mockClock.setTime('2026-10-05T10:00:00Z');

      const actRes = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Reveal Timing Activity',
          slug,
          mode: 'quiz',
          opensAt: '2026-10-05T09:00:00Z',
          closesAt: '2026-10-05T12:00:00Z',
          settings: { finishGraceSeconds: 60 },
        });
      actId = actRes.body.data.id;

      const q1Res = await request(app)
        .post(`/api/activities/${actId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Question One Content',
          position: 1,
          weight: 2,
          speedBonusEnabled: true,
          timeReferenceSeconds: 30,
          choices: [
            { body: 'Choice 1A', isCorrect: true },
            { body: 'Choice 1B', isCorrect: false },
          ],
        });
      q1Id = q1Res.body.data.id;
      q1ChoiceId = q1Res.body.data.choices[0].id;

      const q2Res = await request(app)
        .post(`/api/activities/${actId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Question Two Content',
          position: 2,
          weight: 2,
          speedBonusEnabled: true,
          timeReferenceSeconds: 30,
          choices: [
            { body: 'Choice 2A', isCorrect: true },
            { body: 'Choice 2B', isCorrect: false },
          ],
        });
      q2Id = q2Res.body.data.id;
      q2ChoiceId = q2Res.body.data.choices[0].id;

      await request(app)
        .post(`/api/activities/${actId}/publish`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);
    });

    let attemptId: string;
    let attemptToken: string;

    it('H1. GET /api/public/:slug returns metadata only; does not contain question bodies or choices', async () => {
      const res = await request(app).get(`/api/public/${slug}`);
      expect(res.status).toBe(200);
      expect(res.body.data.activity).toBeDefined();
      expect(res.body.data.activity.title).toBe('Reveal Timing Activity');
      expect(res.body.data.questionCount).toBe(2);
      expect(res.body.data.questions).toBeUndefined();
      expect(res.body.data.activity.questions).toBeUndefined();

      // Deep scan to ensure no question text, choices, or answers leaked
      const text = JSON.stringify(res.body);
      expect(text).not.toContain('Question One Content');
      expect(text).not.toContain('Question Two Content');
      expect(text).not.toContain('Choice 1A');
      expect(text).not.toContain('Choice 2A');
      expect(findForbiddenKeys(res.body)).toEqual([]);
    });

    it('H2. /start returns only the first revealed question and atomically starts its timer marker', async () => {
      mockClock.setTime('2026-10-05T10:05:00Z');
      const startRes = await request(app)
        .post(`/api/public/${slug}/start`)
        .send({ name: 'Cheat Tester', participantCode: 'CHEAT-01' });

      expect(startRes.status).toBe(201);
      attemptId = startRes.body.data.attempt.id;
      attemptToken = startRes.body.data.attemptToken;

      // Only first question is returned
      expect(startRes.body.data.firstQuestion).toBeDefined();
      expect(startRes.body.data.firstQuestion.id).toBe(q1Id);
      expect(startRes.body.data.firstQuestion.body).toBe('Question One Content');
      expect(startRes.body.data.firstQuestion.choices.length).toBe(2);
      expect(startRes.body.data.questions).toBeUndefined();

      // Question 2 is NOT revealed in start response
      const startJson = JSON.stringify(startRes.body);
      expect(startJson).not.toContain('Question Two Content');
      expect(findForbiddenKeys(startRes.body)).toEqual([]);

      // First question's server marker exists atomically
      const markerDoc = await db.collection('questionStates').doc(`${attemptId}_${q1Id}`).get();
      expect(markerDoc.exists).toBe(true);
      expect(markerDoc.data()?.firstEnteredAt).toBe('2026-10-05T10:05:00.000Z');
      expect(markerDoc.data()?.enterCount).toBe(1);

      // Question 2 marker does NOT exist yet
      const q2MarkerDoc = await db.collection('questionStates').doc(`${attemptId}_${q2Id}`).get();
      expect(q2MarkerDoc.exists).toBe(false);
    });

    it('H3. /enter returns the requested sanitized snapshot question and creates its marker', async () => {
      mockClock.setTime('2026-10-05T10:06:00Z');

      const enterRes = await request(app)
        .post(`/api/attempts/${attemptId}/questions/${q2Id}/enter`)
        .set('X-Attempt-Token', attemptToken);

      expect(enterRes.status).toBe(200);
      expect(enterRes.body.data.question.id).toBe(q2Id);
      expect(enterRes.body.data.question.body).toBe('Question Two Content');
      expect(enterRes.body.data.question.choices.length).toBe(2);
      expect(findForbiddenKeys(enterRes.body)).toEqual([]);

      const q2MarkerDoc = await db.collection('questionStates').doc(`${attemptId}_${q2Id}`).get();
      expect(q2MarkerDoc.exists).toBe(true);
      expect(q2MarkerDoc.data()?.firstEnteredAt).toBe('2026-10-05T10:06:00.000Z');
      expect(q2MarkerDoc.data()?.enterCount).toBe(1);
    });

    it('H4. Answer without reveal marker scores correctness, gives speed bonus 0, and records timingSource = "missing_marker"', async () => {
      // Create a third question that will NEVER be entered via /enter
      const q3Res = await request(app)
        .post(`/api/activities/${actId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Question Three Secret',
          position: 3,
          weight: 3,
          speedBonusEnabled: true,
          choices: [
            { body: 'Choice 3A', isCorrect: true },
            { body: 'Choice 3B', isCorrect: false },
          ],
        });
      const q3Id = q3Res.body.data.id;
      const q3ChoiceId = q3Res.body.data.choices[0].id;

      // New participant attempt
      const start2 = await request(app)
        .post(`/api/public/${slug}/start`)
        .send({ name: 'Unmarked Participant', participantCode: 'UNMARK-01' });
      const att2Id = start2.body.data.attempt.id;
      const att2Token = start2.body.data.attemptToken;

      // Submit answer for Q3 directly without ever calling /enter
      mockClock.advanceSeconds(10);
      const ansRes = await request(app)
        .post(`/api/attempts/${att2Id}/answers`)
        .set('X-Attempt-Token', att2Token)
        .send({
          questionId: q3Id,
          selectedChoiceIds: [q3ChoiceId],
        });
      expect(ansRes.status).toBe(200);

      const ansDoc = await db.collection('answers').doc(`${att2Id}_${q3Id}`).get();
      const ansData = ansDoc.data()!;
      expect(ansData.isCorrect).toBe(true);
      expect(ansData.earnedWeight).toBe(3);
      expect(ansData.speedBonus).toBe(0);
      expect(ansData.timingSource).toBe('missing_marker');
      expect(ansData.durationMs).toBeGreaterThan(0); // Not synthesized zero
    });
  });

  // ==========================================
  // SECTION I: FIRESTORE LEADERBOARD ORDERING & rankTimeAt
  // ==========================================
  describe('I. Concrete Sortable Field rankTimeAt & Composite Ordering', () => {
    it('uses rankTimeAt: lastAnswerAt while in_progress, completedAt when completed', () => {
      const liveEntry: LeaderboardRankable = {
        attemptId: 'live-att',
        leaderboardPoints: 10,
        scorePercent: 100,
        durationMs: 5000,
        status: 'in_progress',
        lastAnswerAt: '2026-10-05T10:00:00Z',
        completedAt: null,
        rankTimeAt: '2026-10-05T10:00:00Z',
      };

      const completedEntry: LeaderboardRankable = {
        attemptId: 'comp-att',
        leaderboardPoints: 10,
        scorePercent: 100,
        durationMs: 5000,
        status: 'completed',
        lastAnswerAt: '2026-10-05T09:50:00Z',
        completedAt: '2026-10-05T10:05:00Z',
        rankTimeAt: '2026-10-05T10:05:00Z',
      };

      // Both have same points, scorePercent, and durationMs.
      // liveEntry rankTimeAt (10:00) is earlier than completedEntry rankTimeAt (10:05) -> liveEntry ranks ahead
      expect(compareLeaderboardEntries(liveEntry, completedEntry)).toBeLessThan(0);

      // Canonical tie-breaker: points DESC, scorePercent DESC, durationMs ASC, rankTimeAt ASC, attemptId ASC
      const tiedA: LeaderboardRankable = { ...liveEntry, attemptId: 'att-A' };
      const tiedB: LeaderboardRankable = { ...liveEntry, attemptId: 'att-B' };
      expect(compareLeaderboardEntries(tiedA, tiedB)).toBeLessThan(0);
    });
  });

  // ==========================================
  // SECTION J: ACTIVITY CLOSURE & LAZY FINALIZATION
  // ==========================================
  describe('J. Authoritative Schedule Closure & Idempotent Finalization', () => {
    const slug = 'auto-close-act';
    let actId: string;
    let attemptId: string;
    let attemptToken: string;
    let qId: string;
    let choiceId: string;

    beforeAll(async () => {
      mockClock.setTime('2026-10-05T09:00:00Z');

      const actRes = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Auto Close Activity',
          slug,
          mode: 'quiz',
          opensAt: '2026-10-05T09:00:00Z',
          closesAt: '2026-10-05T10:00:00Z',
          settings: { finishGraceSeconds: 60 },
        });
      actId = actRes.body.data.id;

      const qRes = await request(app)
        .post(`/api/activities/${actId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Timed Question',
          weight: 1,
          choices: [
            { body: 'A', isCorrect: true },
            { body: 'B', isCorrect: false },
          ],
        });
      qId = qRes.body.data.id;
      choiceId = qRes.body.data.choices[0].id;

      await request(app)
        .post(`/api/activities/${actId}/publish`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);

      const startRes = await request(app)
        .post(`/api/public/${slug}/start`)
        .send({ name: 'Lingerer', participantCode: 'LINGER-01' });
      attemptId = startRes.body.data.attempt.id;
      attemptToken = startRes.body.data.attemptToken;
    });

    it('J1. automatic effective close transitions leaderboard to final state without manual /close call', async () => {
      // Clock is currently 09:00. Leaderboard state is live
      const lbLive = await request(app).get(`/api/leaderboards/${slug}`);
      expect(lbLive.body.data.state).toBe('live');

      // Advance clock past closesAt (10:00:00) + finishGraceSeconds (60s) -> 10:01:05
      mockClock.setTime('2026-10-05T10:01:05Z');

      // Request leaderboard after grace window -> triggers lazy finalization
      const lbFinal = await request(app).get(`/api/leaderboards/${slug}`);
      expect(lbFinal.status).toBe(200);
      expect(lbFinal.body.data.state).toBe('final');

      // In-progress attempt was lazily marked expired and removed from ranked entries
      const attDoc = await db.collection('attempts').doc(attemptId).get();
      expect(attDoc.data()?.status).toBe('expired');

      const entryDoc = await db.collection('leaderboardSnapshots').doc(actId).collection('entries').doc(attemptId).get();
      expect(entryDoc.exists).toBe(false);

      // Stats shows the expired attempt as incomplete
      const statsRes = await request(app)
        .get(`/api/activities/${actId}/stats`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);
      expect(statsRes.body.data.incompleteAttempts).toBe(1);
    });

    it('J2. repeated lazy finalization has no side effects (idempotent)', async () => {
      // Calling getLeaderboard again or rebuild
      const lbAgain = await request(app).get(`/api/leaderboards/${slug}`);
      expect(lbAgain.status).toBe(200);
      expect(lbAgain.body.data.state).toBe('final');

      await leaderboardService.finalizeActivity(actId);
      const metaDoc = await db.collection('leaderboardSnapshots').doc(actId).get();
      expect(metaDoc.data()?.state).toBe('final');
    });

    it('J3. new attempts and answers after grace window are rejected with ACTIVITY_CLOSED', async () => {
      // Start rejected
      const lateStart = await request(app)
        .post(`/api/public/${slug}/start`)
        .send({ name: 'Too Late', participantCode: 'LATE-01' });
      expect(lateStart.status).toBe(400);
      expect(lateStart.body.error.code).toBe('ACTIVITY_CLOSED');

      // Answer rejected
      const lateAnswer = await request(app)
        .post(`/api/attempts/${attemptId}/answers`)
        .set('X-Attempt-Token', attemptToken)
        .send({
          questionId: qId,
          selectedChoiceIds: [choiceId],
        });
      expect(lateAnswer.status).toBe(400);
      expect(['ATTEMPT_NOT_IN_PROGRESS', 'ACTIVITY_CLOSED']).toContain(lateAnswer.body.error.code);
    });
  });

  // ==========================================
  // SECTION K: PRE/POST CONCURRENCY & COMPARISON SNAPSHOT
  // ==========================================
  describe('K. Pre/Post Phase Concurrency & ComparisonKey Snapshotting', () => {
    it('K1. concurrent duplicate phase creation/publish for the same group is rejected', async () => {
      const concurrentGroupId = 'concurrency-test-group';

      // Concurrently create two 'pre' activities in the same group
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/activities')
          .set('Authorization', `Bearer ${tokens.ownerToken}`)
          .send({
            title: 'Pre Activity Concurrent 1',
            slug: 'pre-conc-1',
            mode: 'quiz',
            phase: 'pre',
            groupId: concurrentGroupId,
            opensAt: '2026-10-05T09:00:00Z',
            closesAt: '2026-10-05T12:00:00Z',
            participantFields: [{ key: 'participantCode', label: 'Code', required: true, type: 'text' }],
          }),
        request(app)
          .post('/api/activities')
          .set('Authorization', `Bearer ${tokens.ownerToken}`)
          .send({
            title: 'Pre Activity Concurrent 2',
            slug: 'pre-conc-2',
            mode: 'quiz',
            phase: 'pre',
            groupId: concurrentGroupId,
            opensAt: '2026-10-05T09:00:00Z',
            closesAt: '2026-10-05T12:00:00Z',
            participantFields: [{ key: 'participantCode', label: 'Code', required: true, type: 'text' }],
          }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one succeeds (201) and the other is rejected with 409 DUPLICATE_GROUP_PHASE
      expect(statuses).toEqual([201, 409]);
      const failed = res1.status === 409 ? res1 : res2;
      expect(failed.body.error.code).toBe('DUPLICATE_GROUP_PHASE');
    });

    it('K2. pre/post comparison uses snapshotted comparisonKey even if live question comparisonKey is edited later', async () => {
      mockClock.setTime('2026-10-05T10:00:00Z');
      const compGroup = 'snap-comp-group';

      // 1. Create and publish Pre activity
      const preRes = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Snapshot Pre Act',
          slug: 'snap-pre-act',
          mode: 'quiz',
          phase: 'pre',
          groupId: compGroup,
          opensAt: '2026-10-05T09:00:00Z',
          closesAt: '2026-10-05T12:00:00Z',
          participantFields: [{ key: 'participantCode', label: 'Code', required: true, type: 'text' }],
        });
      const preId = preRes.body.data.id;

      const preQRes = await request(app)
        .post(`/api/activities/${preId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Pre Test Question Original Key',
          comparisonKey: 'target-key',
          choices: [
            { body: 'Correct', isCorrect: true },
            { body: 'Wrong', isCorrect: false },
          ],
        });
      const preQId = preQRes.body.data.id;
      const preChoiceId = preQRes.body.data.choices[0].id;

      await request(app).post(`/api/activities/${preId}/publish`).set('Authorization', `Bearer ${tokens.ownerToken}`);

      // 2. Participant answers Pre question while comparisonKey is 'target-key'
      const startPre = await request(app)
        .post('/api/public/snap-pre-act/start')
        .send({ name: 'Paired User', participantCode: 'PAIR-01' });
      const preAttId = startPre.body.data.attempt.id;
      const preToken = startPre.body.data.attemptToken;

      await request(app)
        .post(`/api/attempts/${preAttId}/answers`)
        .set('X-Attempt-Token', preToken)
        .send({
          questionId: preQId,
          selectedChoiceIds: [preChoiceId],
        });
      await request(app).post(`/api/attempts/${preAttId}/finish`).set('X-Attempt-Token', preToken);

      // 3. Organizer modifies live question comparisonKey on Pre activity to 'changed-key'
      const patchRes = await request(app)
        .patch(`/api/questions/${preQId}`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          comparisonKey: 'changed-key',
        });
      expect(patchRes.status).toBe(200);

      // 4. Create and publish Post activity with comparisonKey 'target-key'
      const postRes = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Snapshot Post Act',
          slug: 'snap-post-act',
          mode: 'quiz',
          phase: 'post',
          groupId: compGroup,
          opensAt: '2026-10-05T09:00:00Z',
          closesAt: '2026-10-05T12:00:00Z',
          participantFields: [{ key: 'participantCode', label: 'Code', required: true, type: 'text' }],
        });
      const postId = postRes.body.data.id;

      const postQRes = await request(app)
        .post(`/api/activities/${postId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Post Test Question',
          comparisonKey: 'target-key',
          choices: [
            { body: 'Correct Post', isCorrect: true },
            { body: 'Wrong Post', isCorrect: false },
          ],
        });
      const postQId = postQRes.body.data.id;
      const postChoiceId = postQRes.body.data.choices[0].id;

      await request(app).post(`/api/activities/${postId}/publish`).set('Authorization', `Bearer ${tokens.ownerToken}`);

      // 5. Participant answers Post question
      const startPost = await request(app)
        .post('/api/public/snap-post-act/start')
        .send({ name: 'Paired User', participantCode: 'PAIR-01' });
      const postAttId = startPost.body.data.attempt.id;
      const postToken = startPost.body.data.attemptToken;

      await request(app)
        .post(`/api/attempts/${postAttId}/answers`)
        .set('X-Attempt-Token', postToken)
        .send({
          questionId: postQId,
          selectedChoiceIds: [postChoiceId],
        });
      await request(app).post(`/api/attempts/${postAttId}/finish`).set('X-Attempt-Token', postToken);

      // 6. Request comparison: Pre attempt remains matched on 'target-key' from snapshot!
      const compRes = await request(app)
        .get(`/api/groups/${compGroup}/comparison`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);
      expect(compRes.status).toBe(200);

      const deltas = compRes.body.data.questionStatsDelta;
      const targetDelta = deltas.find((d: any) => d.comparisonKey === 'target-key');
      expect(targetDelta).toBeDefined();
      expect(targetDelta.matched).toBe(true);
      expect(targetDelta.preCorrectPercentage).toBe(100);
      expect(targetDelta.postCorrectPercentage).toBe(100);
    });
  });

  // ==========================================
  // SECTION L: LEADERBOARD BEHAVIOR WHEN maxAttempts = 2
  // ==========================================
  describe('L. Leaderboard Best-Attempt Projection (maxAttempts = 2)', () => {
    const slug = 'max-attempts-act';
    let actId: string;
    let q1Id: string;
    let q1ChoiceCorrect: string;
    let q1ChoiceWrong: string;

    beforeAll(async () => {
      mockClock.setTime('2026-10-05T10:00:00Z');

      const actRes = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Max Attempts Activity',
          slug,
          mode: 'quiz',
          opensAt: '2026-10-05T09:00:00Z',
          closesAt: '2026-10-05T12:00:00Z',
          settings: { maxAttempts: 2 },
          participantFields: [{ key: 'participantCode', label: 'Code', required: true, type: 'text' }],
        });
      actId = actRes.body.data.id;

      const qRes = await request(app)
        .post(`/api/activities/${actId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Challenge Question',
          weight: 10,
          speedBonusEnabled: true,
          timeReferenceSeconds: 60,
          choices: [
            { body: 'Right', isCorrect: true },
            { body: 'Wrong', isCorrect: false },
          ],
        });
      q1Id = qRes.body.data.id;
      q1ChoiceCorrect = qRes.body.data.choices[0].id;
      q1ChoiceWrong = qRes.body.data.choices[1].id;

      await request(app).post(`/api/activities/${actId}/publish`).set('Authorization', `Bearer ${tokens.ownerToken}`);
    });

    it('L1. second worse attempt does NOT replace the first attempt on the leaderboard', async () => {
      // Attempt 1: Charlie answers correctly in 5 seconds (score 100, points ~12)
      mockClock.setTime('2026-10-05T10:00:00Z');
      const start1 = await request(app)
        .post(`/api/public/${slug}/start`)
        .send({ name: 'Charlie Champion', participantCode: 'CHARLIE-01' });
      const att1Id = start1.body.data.attempt.id;
      const att1Token = start1.body.data.attemptToken;

      mockClock.advanceSeconds(5);
      await request(app)
        .post(`/api/attempts/${att1Id}/answers`)
        .set('X-Attempt-Token', att1Token)
        .send({ questionId: q1Id, selectedChoiceIds: [q1ChoiceCorrect] });
      await request(app).post(`/api/attempts/${att1Id}/finish`).set('X-Attempt-Token', att1Token);

      // Verify Leaderboard has Charlie with attempt 1
      const lb1 = await request(app).get(`/api/leaderboards/${slug}`);
      expect(lb1.body.data.top5.length).toBe(1);
      expect(lb1.body.data.top5[0].attemptId).toBe(att1Id);
      expect(lb1.body.data.top5[0].leaderboardPoints).toBeGreaterThan(10);

      // Attempt 2: Charlie starts second attempt and answers WRONGLY (score 0, points 0)
      mockClock.advanceSeconds(10);
      const start2 = await request(app)
        .post(`/api/public/${slug}/start`)
        .send({ name: 'Charlie Champion', participantCode: 'CHARLIE-01' });
      const att2Id = start2.body.data.attempt.id;
      const att2Token = start2.body.data.attemptToken;

      mockClock.advanceSeconds(2);
      await request(app)
        .post(`/api/attempts/${att2Id}/answers`)
        .set('X-Attempt-Token', att2Token)
        .send({ questionId: q1Id, selectedChoiceIds: [q1ChoiceWrong] });
      await request(app).post(`/api/attempts/${att2Id}/finish`).set('X-Attempt-Token', att2Token);

      // Leaderboard STILL shows attempt 1! Attempt 2 (worse) did not replace it!
      const lb2 = await request(app).get(`/api/leaderboards/${slug}`);
      expect(lb2.body.data.top5.length).toBe(1);
      expect(lb2.body.data.top5[0].attemptId).toBe(att1Id);
      expect(lb2.body.data.top5[0].leaderboardPoints).toBeGreaterThan(10);

      // Subcollection entries contains only 1 entry for Charlie
      const entriesSnap = await db.collection('leaderboardSnapshots').doc(actId).collection('entries').get();
      expect(entriesSnap.size).toBe(1);
      expect(entriesSnap.docs[0].id).toBe(att1Id);

      // Stats STILL contains both attempts!
      const statsRes = await request(app)
        .get(`/api/activities/${actId}/stats`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);
      expect(statsRes.body.data.totalAttempts).toBe(2);
      expect(statsRes.body.data.completedAttempts).toBe(2);
    });

    it('L2. second better attempt DOES replace the first attempt on the leaderboard', async () => {
      // New activity for testing second better attempt
      const betSlug = 'better-attempt-act';
      const actRes = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Better Attempt Activity',
          slug: betSlug,
          mode: 'quiz',
          opensAt: '2026-10-05T09:00:00Z',
          closesAt: '2026-10-05T12:00:00Z',
          settings: { maxAttempts: 2 },
          participantFields: [{ key: 'participantCode', label: 'Code', required: true, type: 'text' }],
        });
      const betActId = actRes.body.data.id;

      const qRes = await request(app)
        .post(`/api/activities/${betActId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Question Bet',
          weight: 10,
          speedBonusEnabled: true,
          timeReferenceSeconds: 60,
          choices: [
            { body: 'Right', isCorrect: true },
            { body: 'Wrong', isCorrect: false },
          ],
        });
      const betQId = qRes.body.data.id;
      const betCorrectId = qRes.body.data.choices[0].id;

      await request(app).post(`/api/activities/${betActId}/publish`).set('Authorization', `Bearer ${tokens.ownerToken}`);

      // Attempt 1: Dana answers in 20 seconds
      mockClock.setTime('2026-10-05T10:00:00Z');
      const start1 = await request(app)
        .post(`/api/public/${betSlug}/start`)
        .send({ name: 'Dana Dare', participantCode: 'DANA-01' });
      const att1Id = start1.body.data.attempt.id;
      const att1Token = start1.body.data.attemptToken;

      mockClock.advanceSeconds(20);
      await request(app)
        .post(`/api/attempts/${att1Id}/answers`)
        .set('X-Attempt-Token', att1Token)
        .send({ questionId: betQId, selectedChoiceIds: [betCorrectId] });
      await request(app).post(`/api/attempts/${att1Id}/finish`).set('X-Attempt-Token', att1Token);

      const lb1 = await request(app).get(`/api/leaderboards/${betSlug}`);
      expect(lb1.body.data.top5[0].attemptId).toBe(att1Id);
      const points1 = lb1.body.data.top5[0].leaderboardPoints;

      // Attempt 2: Dana answers much faster (in 2 seconds) -> higher speed bonus!
      mockClock.advanceSeconds(10);
      const start2 = await request(app)
        .post(`/api/public/${betSlug}/start`)
        .send({ name: 'Dana Dare', participantCode: 'DANA-01' });
      const att2Id = start2.body.data.attempt.id;
      const att2Token = start2.body.data.attemptToken;

      mockClock.advanceSeconds(2);
      await request(app)
        .post(`/api/attempts/${att2Id}/answers`)
        .set('X-Attempt-Token', att2Token)
        .send({ questionId: betQId, selectedChoiceIds: [betCorrectId] });
      await request(app).post(`/api/attempts/${att2Id}/finish`).set('X-Attempt-Token', att2Token);

      // Attempt 2 was better -> REPLACES attempt 1 on leaderboard!
      const lb2 = await request(app).get(`/api/leaderboards/${betSlug}`);
      expect(lb2.body.data.top5.length).toBe(1);
      expect(lb2.body.data.top5[0].attemptId).toBe(att2Id);
      expect(lb2.body.data.top5[0].leaderboardPoints).toBeGreaterThan(points1);

      // Only att2Id is in the leaderboard entries subcollection
      const entriesSnap = await db.collection('leaderboardSnapshots').doc(betActId).collection('entries').get();
      expect(entriesSnap.size).toBe(1);
      expect(entriesSnap.docs[0].id).toBe(att2Id);

      // Rebuild preserves the best attempt
      await leaderboardService.rebuildLeaderboardSnapshot(betActId);
      const lbRebuilt = await request(app).get(`/api/leaderboards/${betSlug}`);
      expect(lbRebuilt.body.data.top5.length).toBe(1);
      expect(lbRebuilt.body.data.top5[0].attemptId).toBe(att2Id);

      // Stats still contains both attempts
      const statsRes = await request(app)
        .get(`/api/activities/${betActId}/stats`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);
      expect(statsRes.body.data.totalAttempts).toBe(2);
    });
  });
});
