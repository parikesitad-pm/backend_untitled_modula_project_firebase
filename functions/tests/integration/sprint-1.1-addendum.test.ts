import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { db, auth } from '../../src/config/firebase';
import { seedTestOperators, clearCollection, TestAuthTokens } from '../test-helper';
import { setSystemClock, MockClock, SystemClock } from '../../src/lib/clock';
import { leaderboardService } from '../../src/modules/leaderboard/leaderboard.service';
import { compareLeaderboardEntries } from '../../src/lib/scoring';

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

describe('Sprint 1.1 ADDENDUM Tests (Section F: 19 Tests)', () => {
  let tokens: TestAuthTokens;
  let mockClock: MockClock;

  beforeAll(async () => {
    mockClock = new MockClock('2026-10-01T10:00:00Z');
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
  // LEADERBOARD (LIVE) TESTS 1 - 7
  // ==========================================
  describe('Leaderboard (Live)', () => {
    let actId: string;
    let actSlug = 'live-lb-act';
    let q1Id: string;
    let q1CorrectId: string;
    let q2Id: string;
    let q2CorrectId: string;

    beforeAll(async () => {
      mockClock.setTime('2026-10-01T10:00:00Z');

      const actRes = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Live Leaderboard Activity',
          slug: actSlug,
          mode: 'quiz',
          opensAt: '2026-10-01T09:00:00Z',
          closesAt: '2026-10-01T12:00:00Z',
          settings: { finishGraceSeconds: 60 },
        });
      actId = actRes.body.data.id;

      const q1Res = await request(app)
        .post(`/api/activities/${actId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Question 1',
          weight: 2,
          speedBonusEnabled: true,
          speedBonusPercent: 20,
          timeReferenceSeconds: 30,
          choices: [
            { body: 'Correct 1', isCorrect: true },
            { body: 'Wrong 1', isCorrect: false },
          ],
        });
      q1Id = q1Res.body.data.id;
      q1CorrectId = q1Res.body.data.choices.find((c: any) => c.isCorrect).id;

      const q2Res = await request(app)
        .post(`/api/activities/${actId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Question 2',
          weight: 2,
          speedBonusEnabled: false,
          choices: [
            { body: 'Correct 2', isCorrect: true },
            { body: 'Wrong 2', isCorrect: false },
          ],
        });
      q2Id = q2Res.body.data.id;
      q2CorrectId = q2Res.body.data.choices.find((c: any) => c.isCorrect).id;

      await request(app)
        .post(`/api/activities/${actId}/publish`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);
    });

    let attemptAliceId: string;
    let tokenAlice: string;
    let attemptBobId: string;
    let tokenBob: string;

    it('1. an accepted answer immediately changes entry and ordering before finish', async () => {
      // Alice starts
      const startAlice = await request(app)
        .post(`/api/public/${actSlug}/start`)
        .send({ name: 'Alice Wonder', participantCode: 'P-ALICE' });
      attemptAliceId = startAlice.body.data.attempt.id;
      tokenAlice = startAlice.body.data.attemptToken;

      // Alice answers Q1 correctly after 5 seconds
      mockClock.advanceSeconds(5);
      const ansAlice = await request(app)
        .post(`/api/attempts/${attemptAliceId}/answers`)
        .set('X-Attempt-Token', tokenAlice)
        .send({
          questionId: q1Id,
          selectedChoiceIds: [q1CorrectId],
        });
      expect(ansAlice.status).toBe(200);

      // Check leaderboard before Alice finishes: Alice is visible and ranked with provisional points!
      const lb1 = await request(app).get(`/api/leaderboards/${actSlug}`);
      expect(lb1.status).toBe(200);
      expect(lb1.body.data.state).toBe('live');
      expect(lb1.body.data.top5.length).toBe(1);
      const aliceEntry = lb1.body.data.top5[0];
      expect(aliceEntry.displayName).toBe('Alice Wonder');
      expect(aliceEntry.locked).toBe(false);
      expect(aliceEntry.status).toBe('in_progress');
      expect(aliceEntry.rank).toBe(1);
      expect(aliceEntry.leaderboardPoints).toBeGreaterThan(0);

      // Bob starts now (at T0 + 5s)
      const startBob = await request(app)
        .post(`/api/public/${actSlug}/start`)
        .send({ name: 'Bob Builder', participantCode: 'P-BOB' });
      attemptBobId = startBob.body.data.attempt.id;
      tokenBob = startBob.body.data.attemptToken;

      // Bob answers Q1 faster (1s vs 5s -> higher speed bonus) -> overtakes Alice before finish!
      mockClock.advanceSeconds(1);
      const ansBob = await request(app)
        .post(`/api/attempts/${attemptBobId}/answers`)
        .set('X-Attempt-Token', tokenBob)
        .send({
          questionId: q1Id,
          selectedChoiceIds: [q1CorrectId],
        });
      expect(ansBob.status).toBe(200);

      const lb2 = await request(app).get(`/api/leaderboards/${actSlug}`);
      expect(lb2.body.data.top5.length).toBe(2);
      expect(lb2.body.data.top5[0].displayName).toBe('Bob Builder');
      expect(lb2.body.data.top5[0].rank).toBe(1);
      expect(lb2.body.data.top5[1].displayName).toBe('Alice Wonder');
      expect(lb2.body.data.top5[1].rank).toBe(2);
    });

    it('2. 20 simulated concurrent attempts answering: no lost updates, entries match raw data', async () => {
      const concurrentCount = 20;
      const participants = Array.from({ length: concurrentCount }, (_, i) => ({
        name: `Participant ${i + 1}`,
        code: `CONC-${i + 1}`,
      }));

      // Start all 20 attempts
      const started = await Promise.all(
        participants.map((p) =>
          request(app)
            .post(`/api/public/${actSlug}/start`)
            .send({ name: p.name, participantCode: p.code })
        )
      );

      const attemptInfos = started.map((s) => ({
        attemptId: s.body.data.attempt.id,
        token: s.body.data.attemptToken,
      }));

      // Concurrently submit answers
      await Promise.all(
        attemptInfos.map((att) =>
          request(app)
            .post(`/api/attempts/${att.attemptId}/answers`)
            .set('X-Attempt-Token', att.token)
            .send({
              questionId: q1Id,
              selectedChoiceIds: [q1CorrectId],
            })
        )
      );

      // Verify all 20 entries exist in Firestore subcollection
      const entriesSnap = await db
        .collection('leaderboardSnapshots')
        .doc(actId)
        .collection('entries')
        .get();

      // Alice, Bob + 20 concurrent = 22 total entries
      expect(entriesSnap.size).toBe(22);

      for (const info of attemptInfos) {
        const doc = await db
          .collection('leaderboardSnapshots')
          .doc(actId)
          .collection('entries')
          .doc(info.attemptId)
          .get();
        expect(doc.exists).toBe(true);
        expect(doc.data()?.answeredCount).toBe(1);
        expect(doc.data()?.leaderboardPoints).toBeGreaterThan(0);
      }
    });

    it('3. completed entries are locked; further calls do not change them', async () => {
      // Alice finishes her attempt
      const finishRes = await request(app)
        .post(`/api/attempts/${attemptAliceId}/finish`)
        .set('X-Attempt-Token', tokenAlice);
      expect(finishRes.status).toBe(200);

      const docBefore = await db
        .collection('leaderboardSnapshots')
        .doc(actId)
        .collection('entries')
        .doc(attemptAliceId)
        .get();
      const dataBefore = docBefore.data();
      expect(dataBefore?.locked).toBe(true);
      expect(dataBefore?.status).toBe('completed');
      expect(dataBefore?.completedAt).toBeDefined();

      // Attempting to answer again returns error
      const afterRes = await request(app)
        .post(`/api/attempts/${attemptAliceId}/answers`)
        .set('X-Attempt-Token', tokenAlice)
        .send({
          questionId: q2Id,
          selectedChoiceIds: [q2CorrectId],
        });
      expect(afterRes.status).toBe(400);

      const docAfter = await db
        .collection('leaderboardSnapshots')
        .doc(actId)
        .collection('entries')
        .doc(attemptAliceId)
        .get();
      expect(docAfter.data()).toEqual(dataBefore);
    });

    it('4. expired attempts leave the ranked list and show as incomplete in stats', async () => {
      // Bob is still in_progress. Advance clock past closesAt (12:00) + grace (60s) -> 12:05
      mockClock.setTime('2026-10-01T12:05:00Z');

      // Request leaderboard after grace window -> triggers lazy finalization
      const lbRes = await request(app).get(`/api/leaderboards/${actSlug}`);
      expect(lbRes.status).toBe(200);

      // Bob's attempt doc is now expired
      const bobDoc = await db.collection('attempts').doc(attemptBobId).get();
      expect(bobDoc.data()?.status).toBe('expired');

      // Bob is removed from ranked leaderboard entries
      const bobEntryDoc = await db
        .collection('leaderboardSnapshots')
        .doc(actId)
        .collection('entries')
        .doc(attemptBobId)
        .get();
      expect(bobEntryDoc.exists).toBe(false);

      // Check stats: incomplete attempts include Bob
      const statsRes = await request(app)
        .get(`/api/activities/${actId}/stats`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);
      expect(statsRes.status).toBe(200);
      expect(statsRes.body.data.incompleteAttempts).toBeGreaterThanOrEqual(1);
    });

    it('5. lazy finalization is idempotent and sets state final after close', async () => {
      // Call close endpoint
      await request(app)
        .post(`/api/activities/${actId}/close`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);

      const metaDoc1 = await db.collection('leaderboardSnapshots').doc(actId).get();
      expect(metaDoc1.data()?.state).toBe('final');

      // Requesting leaderboard again changes nothing
      const lbRes = await request(app).get(`/api/leaderboards/${actSlug}`);
      expect(lbRes.status).toBe(200);
      expect(lbRes.body.data.state).toBe('final');
    });

    it('6. rebuild equals incremental', async () => {
      // Get all current incremental entries
      const incrementalSnap = await db
        .collection('leaderboardSnapshots')
        .doc(actId)
        .collection('entries')
        .get();
      const incrementalMap = new Map<string, any>();
      incrementalSnap.docs.forEach((d) => incrementalMap.set(d.id, d.data()));

      // Run rebuild routine
      await leaderboardService.rebuildLeaderboardSnapshot(actId);

      const rebuiltSnap = await db
        .collection('leaderboardSnapshots')
        .doc(actId)
        .collection('entries')
        .get();
      expect(rebuiltSnap.size).toBe(incrementalSnap.size);

      rebuiltSnap.docs.forEach((d) => {
        const inc = incrementalMap.get(d.id);
        expect(inc).toBeDefined();
        const rebuilt = d.data();
        expect(rebuilt.attemptId).toBe(inc.attemptId);
        expect(rebuilt.displayName).toBe(inc.displayName);
        expect(rebuilt.status).toBe(inc.status);
        expect(rebuilt.locked).toBe(inc.locked);
        expect(rebuilt.leaderboardPoints).toBe(inc.leaderboardPoints);
        expect(rebuilt.scorePercent).toBe(inc.scorePercent);
        expect(rebuilt.answeredCount).toBe(inc.answeredCount);
        expect(rebuilt.totalQuestions).toBe(inc.totalQuestions);
        expect(rebuilt.durationMs).toBe(inc.durationMs);
      });
    });

    it('7. comparator ties, hidden leaderboard (403 public, OK for operator), zero PII', async () => {
      // Pure comparator tie-break testing
      const tied1 = {
        attemptId: 'att-1',
        leaderboardPoints: 10,
        scorePercent: 100,
        durationMs: 5000,
        lastAnswerAt: '2026-01-01T00:00:00Z',
      };
      const tied2 = {
        attemptId: 'att-2',
        leaderboardPoints: 10,
        scorePercent: 100,
        durationMs: 5000,
        lastAnswerAt: '2026-01-01T00:00:00Z',
      };
      // att-1 < att-2 (stable tie-break)
      expect(compareLeaderboardEntries(tied1, tied2)).toBeLessThan(0);

      // Hidden leaderboard testing
      const hiddenAct = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Secret Hidden Leaderboard',
          slug: 'secret-hidden-lb',
          mode: 'quiz',
          opensAt: '2026-01-01T00:00:00Z',
          closesAt: '2027-01-01T00:00:00Z',
          settings: { hideLeaderboardFromParticipants: true },
        });
      await request(app)
        .post(`/api/activities/${hiddenAct.body.data.id}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'HQ Question',
          choices: [
            { body: 'A', isCorrect: true },
            { body: 'B', isCorrect: false },
          ],
        });
      await request(app)
        .post(`/api/activities/${hiddenAct.body.data.id}/publish`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);

      // Public read -> 403 Forbidden
      const pubHidden = await request(app).get('/api/leaderboards/secret-hidden-lb');
      expect(pubHidden.status).toBe(403);
      expect(pubHidden.body.error.code).toBe('LEADERBOARD_HIDDEN');

      // Operator read -> 200 OK
      const opHidden = await request(app)
        .get('/api/leaderboards/secret-hidden-lb')
        .set('Authorization', `Bearer ${tokens.operatorToken}`);
      expect(opHidden.status).toBe(200);

      // PII scan on entries
      const entries = await db
        .collection('leaderboardSnapshots')
        .doc(actId)
        .collection('entries')
        .get();
      for (const d of entries.docs) {
        const e = d.data();
        expect(e).not.toHaveProperty('participantCode');
        expect(e).not.toHaveProperty('email');
        expect(e).not.toHaveProperty('division');
        expect(e).not.toHaveProperty('customFields');
        expect(e).not.toHaveProperty('selectedChoiceIds');
        expect(e).not.toHaveProperty('isCorrect');
      }
    });
  });

  // ==========================================
  // TIMING TESTS 8 - 12
  // ==========================================
  describe('Server Timing', () => {
    let timeActId: string;
    let timeSlug = 'timing-test-act';
    let qIds: string[] = [];
    let qCorrectIds: string[] = [];

    beforeAll(async () => {
      mockClock.setTime('2026-10-02T10:00:00Z');

      const actRes = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Timing Activity',
          slug: timeSlug,
          mode: 'quiz',
          opensAt: '2026-10-02T09:00:00Z',
          closesAt: '2026-10-02T13:00:00Z',
        });
      timeActId = actRes.body.data.id;

      // Create 5 questions
      for (let i = 1; i <= 5; i++) {
        const qRes = await request(app)
          .post(`/api/activities/${timeActId}/questions`)
          .set('Authorization', `Bearer ${tokens.ownerToken}`)
          .send({
            body: `Question ${i}`,
            position: i,
            weight: 1,
            speedBonusEnabled: true,
            speedBonusPercent: 20,
            timeReferenceSeconds: 60,
            choices: [
              { body: `Correct ${i}`, isCorrect: true },
              { body: `Wrong ${i}`, isCorrect: false },
            ],
          });
        qIds.push(qRes.body.data.id);
        qCorrectIds.push(qRes.body.data.choices.find((c: any) => c.isCorrect).id);
      }

      await request(app)
        .post(`/api/activities/${timeActId}/publish`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);
    });

    let attemptId: string;
    let attemptToken: string;

    it('12. start creates the marker for question 1', async () => {
      mockClock.setTime('2026-10-02T10:00:00Z');

      const startRes = await request(app)
        .post(`/api/public/${timeSlug}/start`)
        .send({ name: 'Timer Participant', participantCode: 'TIME-01' });

      expect(startRes.status).toBe(201);
      attemptId = startRes.body.data.attempt.id;
      attemptToken = startRes.body.data.attemptToken;

      // Question 1 marker must exist immediately
      const markerDoc = await db.collection('questionStates').doc(`${attemptId}_${qIds[0]}`).get();
      expect(markerDoc.exists).toBe(true);
      expect(markerDoc.data()?.enterCount).toBe(1);
      expect(markerDoc.data()?.firstEnteredAt).toBe('2026-10-02T10:00:00.000Z');
    });

    it('9. re-entering a question does not reset firstEnteredAt (only enterCount grows)', async () => {
      // Enter Q2 at T + 10s
      mockClock.setTime('2026-10-02T10:00:10Z');
      const enter1 = await request(app)
        .post(`/api/attempts/${attemptId}/questions/${qIds[1]}/enter`)
        .set('X-Attempt-Token', attemptToken);
      expect(enter1.status).toBe(200);

      const marker1 = await db.collection('questionStates').doc(`${attemptId}_${qIds[1]}`).get();
      expect(marker1.data()?.firstEnteredAt).toBe('2026-10-02T10:00:10.000Z');
      expect(marker1.data()?.enterCount).toBe(1);

      // Re-enter Q2 at T + 30s
      mockClock.setTime('2026-10-02T10:00:30Z');
      const enter2 = await request(app)
        .post(`/api/attempts/${attemptId}/questions/${qIds[1]}/enter`)
        .set('X-Attempt-Token', attemptToken);
      expect(enter2.status).toBe(200);

      const marker2 = await db.collection('questionStates').doc(`${attemptId}_${qIds[1]}`).get();
      // firstEnteredAt is NOT reset!
      expect(marker2.data()?.firstEnteredAt).toBe('2026-10-02T10:00:10.000Z');
      expect(marker2.data()?.lastEnteredAt).toBe('2026-10-02T10:00:30.000Z');
      expect(marker2.data()?.enterCount).toBe(2);
    });

    it("8. answer Q5, then Q3: Q3's duration uses Q3's own firstEnteredAt, never Q5's answer time", async () => {
      // Enter Q5 at 10:01:00
      mockClock.setTime('2026-10-02T10:01:00Z');
      await request(app)
        .post(`/api/attempts/${attemptId}/questions/${qIds[4]}/enter`)
        .set('X-Attempt-Token', attemptToken);

      // Enter Q3 at 10:01:10
      mockClock.setTime('2026-10-02T10:01:10Z');
      await request(app)
        .post(`/api/attempts/${attemptId}/questions/${qIds[2]}/enter`)
        .set('X-Attempt-Token', attemptToken);

      // Answer Q5 at 10:01:20 (duration for Q5 = 20s)
      mockClock.setTime('2026-10-02T10:01:20Z');
      await request(app)
        .post(`/api/attempts/${attemptId}/answers`)
        .set('X-Attempt-Token', attemptToken)
        .send({
          questionId: qIds[4],
          selectedChoiceIds: [qCorrectIds[4]],
        });

      // Answer Q3 at 10:01:30 (Q3 entered at 10:01:10 -> duration = 20s, NOT 10s from Q5)
      mockClock.setTime('2026-10-02T10:01:30Z');
      await request(app)
        .post(`/api/attempts/${attemptId}/answers`)
        .set('X-Attempt-Token', attemptToken)
        .send({
          questionId: qIds[2],
          selectedChoiceIds: [qCorrectIds[2]],
        });

      const q3AnsDoc = await db.collection('answers').doc(`${attemptId}_${qIds[2]}`).get();
      expect(q3AnsDoc.data()?.durationMs).toBe(20000); // 10:01:30 - 10:01:10 = 20,000 ms
      expect(q3AnsDoc.data()?.timingSource).toBe('server_marker');
    });

    it('10. answer without an enter marker: correctness scored, speed bonus 0, timingSource: "missing_marker"', async () => {
      // Q4 was NEVER entered via enter endpoint
      mockClock.setTime('2026-10-02T10:02:00Z');
      const ansRes = await request(app)
        .post(`/api/attempts/${attemptId}/answers`)
        .set('X-Attempt-Token', attemptToken)
        .send({
          questionId: qIds[3],
          selectedChoiceIds: [qCorrectIds[3]],
        });
      expect(ansRes.status).toBe(200);

      const q4AnsDoc = await db.collection('answers').doc(`${attemptId}_${qIds[3]}`).get();
      const ansData = q4AnsDoc.data();
      expect(ansData?.isCorrect).toBe(true);
      expect(ansData?.earnedWeight).toBe(1);
      expect(ansData?.speedBonus).toBe(0); // speed bonus 0!
      expect(ansData?.timingSource).toBe('missing_marker');
      expect(ansData?.durationMs).toBeGreaterThan(0); // not defaulted to 0
    });

    it('11. client timestamps are ignored for official scoring', async () => {
      // Answer Q1 with spoofed client duration 1ms and future timestamps
      mockClock.setTime('2026-10-02T10:03:00Z');
      await request(app)
        .post(`/api/attempts/${attemptId}/answers`)
        .set('X-Attempt-Token', attemptToken)
        .send({
          questionId: qIds[0],
          selectedChoiceIds: [qCorrectIds[0]],
          durationMs: 1, // client lie
          enteredAt: '2026-10-02T10:02:59.999Z',
          answeredAt: '2026-10-02T10:03:00.000Z',
        });

      const q1AnsDoc = await db.collection('answers').doc(`${attemptId}_${qIds[0]}`).get();
      const ansData = q1AnsDoc.data();
      // Server duration from Q1 firstEnteredAt (10:00:00) to 10:03:00 is 180,000 ms, NOT 1 ms
      expect(ansData?.durationMs).toBe(180000);
      expect(ansData?.clientEnteredAt).toBe('2026-10-02T10:02:59.999Z');
    });
  });

  // ==========================================
  // ROLES TESTS 13 - 14
  // ==========================================
  describe('Role Authority from Firestore', () => {
    let opUserUid: string;
    let opUserToken: string;

    beforeAll(async () => {
      // Create user in Auth & Firestore with role manager
      const createRes = await request(app)
        .post('/api/operators')
        .set('Authorization', `Bearer ${tokens.crownToken}`)
        .send({
          username: 'dynamic_role_user',
          accessCode: 'DynamicSecret123!',
          role: 'manager',
        });
      opUserUid = createRes.body.data.uid;

      // Login to get token
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          username: 'dynamic_role_user',
          accessCode: 'DynamicSecret123!',
        });
      opUserToken = loginRes.body.data.token;
    });

    it('13. downgrade/deactivate operator in Firestore: very next request with old token is denied', async () => {
      // Manager can access /api/activities POST
      const testAct1 = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${opUserToken}`)
        .send({
          title: 'Manager Act',
          slug: 'manager-act-1',
          mode: 'quiz',
          opensAt: '2026-01-01T00:00:00Z',
          closesAt: '2027-01-01T00:00:00Z',
        });
      expect(testAct1.status).toBe(201);

      // Deactivate operator directly in Firestore
      await db.collection('operators').doc(opUserUid).update({ active: false });

      // Very next request with old token is rejected
      const deactReq = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${opUserToken}`);
      expect(deactReq.status).toBe(403);

      // Reactivate but downgrade to operator in Firestore
      await db.collection('operators').doc(opUserUid).update({ active: true, role: 'operator' });

      // GET /api/auth/me returns the downgraded role from the record
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${opUserToken}`);
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.role).toBe('operator');

      // Operator cannot publish activity (manager capability)
      const pubReq = await request(app)
        .post(`/api/activities/${testAct1.body.data.id}/publish`)
        .set('Authorization', `Bearer ${opUserToken}`);
      expect(pubReq.status).toBe(403);
    });

    it('14. claims are not authoritative: token with claim owner but record operator gets operator permissions', async () => {
      // Create custom token with claim 'crown' for opUserUid (whose record is 'operator')
      const bogusToken = await auth.createCustomToken(opUserUid, { role: 'crown' });

      // Attempt crown-only endpoint (/api/operators list requires owner/crown)
      const opListRes = await request(app)
        .get('/api/operators')
        .set('Authorization', `Bearer ${bogusToken}`);

      // Denied because Firestore record is operator
      expect(opListRes.status).toBe(403);
    });
  });

  // ==========================================
  // PRE/POST TESTS 15 - 17
  // ==========================================
  describe('Pre/Post Linked Activities', () => {
    let linkedGroupId = 'linked-group-101';

    it('15. publish rejected when a linked activity does not require participantCode', async () => {
      const actRes = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Linked Pre Activity Missing Code',
          slug: 'linked-pre-no-code',
          mode: 'quiz',
          phase: 'pre',
          groupId: linkedGroupId,
          opensAt: '2026-01-01T00:00:00Z',
          closesAt: '2027-01-01T00:00:00Z',
          participantFields: [
            { key: 'name', label: 'Name', required: true, type: 'text' },
            { key: 'participantCode', label: 'Code', required: false, type: 'text' }, // optional!
          ],
        });
      const actId = actRes.body.data.id;

      await request(app)
        .post(`/api/activities/${actId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Sample Q',
          choices: [
            { body: 'A', isCorrect: true },
            { body: 'B', isCorrect: false },
          ],
        });

      const pubRes = await request(app)
        .post(`/api/activities/${actId}/publish`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);

      expect(pubRes.status).toBe(400);
      expect(pubRes.body.error.code).toBe('PARTICIPANT_CODE_REQUIRED_FOR_LINKED_ACTIVITY');
    });

    it('16. phase without groupId, and a second pre in the same group, are rejected', async () => {
      // Phase without groupId -> 400
      const noGroupRes = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Orphan Phase',
          slug: 'orphan-phase-act',
          mode: 'quiz',
          phase: 'pre',
          opensAt: '2026-01-01T00:00:00Z',
          closesAt: '2027-01-01T00:00:00Z',
        });
      expect(noGroupRes.status).toBe(400);
      expect(noGroupRes.body.error.code).toBe('GROUP_ID_REQUIRED');

      // Valid pre activity
      const pre1 = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Valid Pre',
          slug: 'valid-pre-act-1',
          mode: 'quiz',
          phase: 'pre',
          groupId: 'single-phase-grp',
          opensAt: '2026-01-01T00:00:00Z',
          closesAt: '2027-01-01T00:00:00Z',
          participantFields: [{ key: 'participantCode', label: 'Code', required: true, type: 'text' }],
        });
      expect(pre1.status).toBe(201);

      // Second pre activity in same group -> 409 DUPLICATE_GROUP_PHASE
      const pre2 = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Duplicate Pre',
          slug: 'duplicate-pre-act-2',
          mode: 'quiz',
          phase: 'pre',
          groupId: 'single-phase-grp',
          opensAt: '2026-01-01T00:00:00Z',
          closesAt: '2027-01-01T00:00:00Z',
          participantFields: [{ key: 'participantCode', label: 'Code', required: true, type: 'text' }],
        });
      expect(pre2.status).toBe(409);
      expect(pre2.body.error.code).toBe('DUPLICATE_GROUP_PHASE');
    });

    it('17. comparison pairs questions by comparisonKey; unmatched questions are reported', async () => {
      const compGroupId = 'comp-delta-grp';

      // Pre activity
      const preAct = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Delta Pre Activity',
          slug: 'delta-pre-act',
          mode: 'quiz',
          phase: 'pre',
          groupId: compGroupId,
          opensAt: '2026-01-01T00:00:00Z',
          closesAt: '2027-01-01T00:00:00Z',
          participantFields: [{ key: 'participantCode', label: 'Code', required: true, type: 'text' }],
        });
      const preId = preAct.body.data.id;

      // Pre Q1: comparisonKey 'key-alpha'
      await request(app)
        .post(`/api/activities/${preId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Pre Q1 Alpha',
          comparisonKey: 'key-alpha',
          choices: [
            { body: 'A', isCorrect: true },
            { body: 'B', isCorrect: false },
          ],
        });

      // Pre Q2: comparisonKey 'key-pre-only'
      await request(app)
        .post(`/api/activities/${preId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Pre Q2 Only',
          comparisonKey: 'key-pre-only',
          choices: [
            { body: 'A', isCorrect: true },
            { body: 'B', isCorrect: false },
          ],
        });

      await request(app).post(`/api/activities/${preId}/publish`).set('Authorization', `Bearer ${tokens.ownerToken}`);

      // Post activity
      const postAct = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Delta Post Activity',
          slug: 'delta-post-act',
          mode: 'quiz',
          phase: 'post',
          groupId: compGroupId,
          opensAt: '2026-01-01T00:00:00Z',
          closesAt: '2027-01-01T00:00:00Z',
          participantFields: [{ key: 'participantCode', label: 'Code', required: true, type: 'text' }],
        });
      const postId = postAct.body.data.id;

      // Post Q1: comparisonKey 'key-alpha'
      await request(app)
        .post(`/api/activities/${postId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Post Q1 Alpha',
          comparisonKey: 'key-alpha',
          choices: [
            { body: 'A', isCorrect: true },
            { body: 'B', isCorrect: false },
          ],
        });

      // Post Q2: comparisonKey 'key-post-only'
      await request(app)
        .post(`/api/activities/${postId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Post Q2 Only',
          comparisonKey: 'key-post-only',
          choices: [
            { body: 'A', isCorrect: true },
            { body: 'B', isCorrect: false },
          ],
        });

      await request(app).post(`/api/activities/${postId}/publish`).set('Authorization', `Bearer ${tokens.ownerToken}`);

      const compRes = await request(app)
        .get(`/api/groups/${compGroupId}/comparison`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);

      expect(compRes.status).toBe(200);
      const deltas = compRes.body.data.questionStatsDelta;

      // 'key-alpha' is matched
      const alpha = deltas.find((d: any) => d.comparisonKey === 'key-alpha');
      expect(alpha).toBeDefined();
      expect(alpha.matched).toBe(true);

      // 'key-pre-only' is unmatched
      const preOnly = deltas.find((d: any) => d.comparisonKey === 'key-pre-only');
      expect(preOnly).toBeDefined();
      expect(preOnly.matched).toBe(false);

      // 'key-post-only' is unmatched
      const postOnly = deltas.find((d: any) => d.comparisonKey === 'key-post-only');
      expect(postOnly).toBeDefined();
      expect(postOnly.matched).toBe(false);
    });
  });

  // ==========================================
  // SNAPSHOT TESTS 18 - 19
  // ==========================================
  describe('Attempt Snapshots', () => {
    let snapActId: string;
    let snapSlug = 'snapshot-act';
    let qId: string;
    let qChoiceId: string;

    beforeAll(async () => {
      mockClock.setTime('2026-10-03T10:00:00Z');

      const actRes = await request(app)
        .post('/api/activities')
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          title: 'Snapshot Test Activity',
          slug: snapSlug,
          mode: 'quiz',
          opensAt: '2026-10-03T09:00:00Z',
          closesAt: '2026-10-03T13:00:00Z',
        });
      snapActId = actRes.body.data.id;

      const qRes = await request(app)
        .post(`/api/activities/${snapActId}/questions`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Original Typo Question Body',
          choices: [
            { body: 'Choice 1', isCorrect: true },
            { body: 'Choice 2', isCorrect: false },
          ],
        });
      qId = qRes.body.data.id;
      qChoiceId = qRes.body.data.choices[0].id;

      await request(app)
        .post(`/api/activities/${snapActId}/publish`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);
    });

    it("18. edit a question body after an attempt exists: old attempts show old text, new attempts show new text, and textVariants reflects it", async () => {
      // Participant 1 starts with original typo body
      const start1 = await request(app)
        .post(`/api/public/${snapSlug}/start`)
        .send({ name: 'User One', participantCode: 'USER-01' });
      const att1Id = start1.body.data.attempt.id;
      const att1Token = start1.body.data.attemptToken;

      expect(start1.body.data.firstQuestion.body).toBe('Original Typo Question Body');

      // Answer question 1
      await request(app)
        .post(`/api/attempts/${att1Id}/answers`)
        .set('X-Attempt-Token', att1Token)
        .send({
          questionId: qId,
          selectedChoiceIds: [qChoiceId],
        });

      // Organizer edits the typo in the question body
      const editRes = await request(app)
        .patch(`/api/questions/${qId}`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`)
        .send({
          body: 'Corrected Question Body Without Typo',
        });
      expect(editRes.status).toBe(200);

      // Participant 2 starts after edit -> sees new corrected text
      const start2 = await request(app)
        .post(`/api/public/${snapSlug}/start`)
        .send({ name: 'User Two', participantCode: 'USER-02' });
      expect(start2.body.data.firstQuestion.body).toBe('Corrected Question Body Without Typo');

      // Check responses export for attempt 1: shows the original text as participant saw it
      const responsesRes = await request(app)
        .get(`/api/activities/${snapActId}/responses`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);
      expect(responsesRes.status).toBe(200);
      const att1Response = responsesRes.body.data.find((r: any) => r.attemptId === att1Id);
      expect(att1Response.questionBody).toBe('Original Typo Question Body');

      // Check question stats: textVariants must be 2
      const qStatsRes = await request(app)
        .get(`/api/activities/${snapActId}/question-stats`)
        .set('Authorization', `Bearer ${tokens.ownerToken}`);
      expect(qStatsRes.status).toBe(200);
      const stat = qStatsRes.body.data.find((s: any) => s.questionId === qId);
      expect(stat.textVariants).toBe(2);
    });

    it('19. public payloads served from the snapshot never contain isCorrect (deep recursive scan)', async () => {
      // 1. start attempt payload
      const startRes = await request(app)
        .post(`/api/public/${snapSlug}/start`)
        .send({ name: 'Audit User', participantCode: 'AUDIT-01' });
      expect(startRes.status).toBe(201);
      const attId = startRes.body.data.attempt.id;
      const token = startRes.body.data.attemptToken;

      expect(findForbiddenKeys(startRes.body)).toEqual([]);

      // 2. enter question payload
      const enterRes = await request(app)
        .post(`/api/attempts/${attId}/questions/${qId}/enter`)
        .set('X-Attempt-Token', token);
      expect(enterRes.status).toBe(200);
      expect(findForbiddenKeys(enterRes.body)).toEqual([]);

      // 3. submit answer payload
      const ansRes = await request(app)
        .post(`/api/attempts/${attId}/answers`)
        .set('X-Attempt-Token', token)
        .send({
          questionId: qId,
          selectedChoiceIds: [qChoiceId],
        });
      expect(ansRes.status).toBe(200);
      expect(findForbiddenKeys(ansRes.body)).toEqual([]);

      // 4. get attempt status payload
      const getAttRes = await request(app)
        .get(`/api/attempts/${attId}`)
        .set('X-Attempt-Token', token);
      expect(getAttRes.status).toBe(200);
      expect(findForbiddenKeys(getAttRes.body)).toEqual([]);

      // 5. finish payload
      const finishRes = await request(app)
        .post(`/api/attempts/${attId}/finish`)
        .set('X-Attempt-Token', token);
      expect(finishRes.status).toBe(200);
      expect(findForbiddenKeys(finishRes.body)).toEqual([]);

      // 6. leaderboard payload
      const lbRes = await request(app).get(`/api/leaderboards/${snapSlug}`);
      expect(lbRes.status).toBe(200);
      expect(findForbiddenKeys(lbRes.body)).toEqual([]);
    });
  });
});
