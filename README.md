# MODULA Activity Backend — Firebase First (Hardened v0.2.0)

Backend-first implementation for MODULA Activity platform built with Firebase (Cloud Functions v2, Firestore, Auth, Storage, and Emulator Suite), Express, TypeScript, and Zod. Hardened for production concurrency, cryptographic attempt security, role hierarchy authorization, server-authoritative scoring, and privacy-safe realtime leaderboards.

---

## 1. Product Model

The core parent entity is **Activity**. An Activity represents a complete unit comprising four product areas:
1. **Builder** — Authoring questions (Markdown/rich technical text, 255 char prompt limit), weights, speed bonus settings, and choices.
2. **Participant Area** — Intake form with participant fields and test execution interface with zero answer leakage.
3. **Realtime Leaderboard** — Live ranking calculated from weighted correctness score and question-level speed bonuses.
4. **Stats / Results** — Analytics, participant registry, response export, per-question stats, and pre/post comparison.

### Activity Modes & Phases
- **Modes**:
  - `quiz`: Live access window with strict opening and closing schedules.
  - `task`: Broader multi-hour/multi-day access window.
- **Phases**: `standalone`, `pre`, or `post`. Activities can share a `groupId` for pre/post test score and question delta comparisons.
- **Public Routes Convention**:
  - `/{slug}` — Participant area.
  - `/leaderboard-{slug}` — Realtime leaderboard.

---

## 2. Tech Stack & Dependencies

- **Runtime Engine**: Node.js `22` (strictly pinned in `functions/package.json`)
- **Serverless Compute**: Firebase Cloud Functions v2 (HTTP Express API)
- **Database**: Cloud Firestore with Composite Indexes (Data & Realtime Leaderboards)
- **Authentication**: Firebase Authentication + Private Firestore Operator Records with Bcrypt
- **Media Asset Storage**: Cloudinary (Signed direct uploads, dynamic folder routing, transformation delivery)
- **Validation**: Zod with `@asteasolutions/zod-to-openapi`
- **API Specification**: OpenAPI 3.1 & Swagger UI with `@apidevtools/swagger-parser` validation
- **Testing**: Vitest (serial execution `fileParallelism: false`) & Supertest with Firebase Emulator Suite (Auth & Firestore)

All dependencies are strictly pinned to exact versions (no `^` or `~` prefixes).

---

## 3. Security Model

### Attempt Security & Anonymous Tokens
Participants in the Participant Area are anonymous, so sequential or known `attemptId` values never grant access:
1. **Cryptographic Attempt Token**: When an attempt is started via `POST /api/public/:slug/start`, a 32-byte cryptographically secure random URL-safe token is generated (`crypto.randomBytes(32).toString('base64url')`).
2. **One-Time Token Delivery**: The token is returned **once** in the creation response (`attemptToken`). Only the SHA-256 hash of this token is stored in the Firestore attempt document (`attemptTokenHash`).
3. **Header Enforcement**: All subsequent attempt interactions (`GET /api/attempts/:id`, `POST /api/attempts/:id/answers`, `POST /api/attempts/:id/finish`) require the header `X-Attempt-Token`.
4. **Constant-Time Verification**: The incoming token is hashed and verified against the stored hash using constant-time string comparison (`crypto.timingSafeEqual`) to eliminate timing side-channel attacks. Invalid or missing tokens return `401 Unauthorized` with error code `UNAUTHORIZED_ATTEMPT`.
5. **Participant Code Normalization**: All participant codes are trimmed, uppercased, and collapsed of redundant whitespace prior to indexing or queries.
6. **Max Attempts Guard**: `settings.maxAttempts` (default: 1) is enforced inside an atomic Firestore transaction. Over-limit submissions return `409 Conflict` (`MAX_ATTEMPTS_REACHED`).

### Role Authorization Matrix & Firestore Role Authority
MODULA enforces a single organization model with a strict role hierarchy (`operator < manager < owner < crown`) centralized in a single permission matrix (`functions/src/middleware/auth.middleware.ts`):

| Capability | operator | manager | owner | crown |
|---|:---:|:---:|:---:|:---:|
| `GET /api/auth/me` | Yes | Yes | Yes | Yes |
| Read activities, questions, leaderboard, stats, question-stats, comparison | Yes | Yes | Yes | Yes |
| Create/update activities and questions, reorder | Yes | Yes | Yes | Yes |
| Storage upload URL | Yes | Yes | Yes | Yes |
| Publish, close, archive activity | No | Yes | Yes | Yes |
| `GET .../participants` and `GET .../responses` (contain PII) | No | Yes | Yes | Yes |
| Hard-delete a draft activity | No | No | Yes | Yes |
| Manage operators (`/api/operators/**`) | No | No | Yes | Yes |

- **Firestore Role Authority**: While a Firebase ID token proves user identity (`uid`), it is **not** the authority for authorization roles. On every protected request, the server executes `auth.verifyIdToken(token, true)` with revocation check, loads the operator's record directly from the `operators` collection in Firestore, and enforces `role` and `active` status from that live record.
- **Immediate Effect**: Role downgrades or account deactivations take effect immediately on the very next request, even with a previously issued, unexpired ID token.
- **Informational Custom Claims**: Custom claims on tokens are maintained for frontend UI convenience only and are strictly ignored by server authorization guards.
- **Role Escalation Rules**: Operators can only create or promote users to roles **strictly below** their own level. The `crown` role can assign any role. No operator can alter their own role.
- **Last Owner Protection**: The system rejects deactivating or demoting the last remaining active `owner` or `crown` with `409 Conflict` (`LAST_OWNER_PROTECTION`).

### Login Hardening & Brute-Force Rate Limiting
- **Password Hashing**: Bcrypt with cost factor `12` is locked across all operator passwords and access codes.
- **Constant-Time Dummy Verification**: When an unknown username is submitted, the system performs a dummy bcrypt verification against a precomputed cost-12 hash to prevent user enumeration via response timing.
- **Generic Error Responses**: Both non-existent users and incorrect access codes return identical generic messages: `401 Unauthorized: Invalid credentials`.
- **Transaction-Backed Rate Limiting**: Failed logins are recorded in a server-only Firestore collection (`loginAttempts`), isolated from client read/write rules.
- **Lockout Policy**: Defaults to 5 failures per 15-minute sliding window (configurable via `LOGIN_MAX_FAILURES` and `LOGIN_WINDOW_SECONDS`). Exceeding the threshold triggers `429 Too Many Requests` with a standard `Retry-After` header. Successful login immediately resets the failure counter.
- Zero credential logging: passwords, access codes, tokens, and hashes are strictly excluded from server logs and API responses.

### Firestore Collections Overview
All Firestore data is structured across the following collections:

| Collection Path | Purpose & Access |
|---|---|
| `activities` | Root activity documents (metadata, schedules, settings). Public reads when published/closed; operator-managed. |
| `questions` | Question authoring documents for activities. Stripped of `isCorrect` on public read. |
| `choices` | Choice authoring documents per question. Stripped of `isCorrect` on public read. |
| `participants` | Participant identity registry (`name`, `participantCode`, `email`). Operator-only access. |
| `attempts` | Attempt sessions with cryptographic token hash and running aggregates. |
| `answers` | Immutable individual question answer records. Server-only direct access. |
| `questionStates/{attemptId}_{questionId}` | Server-only enter markers tracking `firstEnteredAt`, `lastEnteredAt`, and `enterCount`. |
| `attemptSnapshots/{attemptId}` | Server-only frozen copy of questions, choices, and scoring config captured at `POST /start`. |
| `leaderboardSnapshots/{activityId}` | Meta document for activity leaderboard (`state`: `live \| final`, `participantCount`). |
| `leaderboardSnapshots/{activityId}/entries/{attemptId}` | High-concurrency subcollection with one document per attempt. Zero PII. |
| `statsSnapshots/{activityId}` | Aggregated statistics snapshot per activity. |
| `activityGroupPhases/{groupId}_{phase}` | Atomic lock enforcing at most 1 `pre` and 1 `post` activity per pre/post group. |
| `operators` | Operator accounts with bcrypt access code hash, role, and active status. Server-only access. |
| `loginAttempts` | Server-only rate limiting failure records for operator authentication. |

### Firestore & Storage Security Rules
- **Firestore Rules (`firestore.rules`)**:
  - Operators with verified auth tokens have read/write access according to server rules.
  - Direct client writes to activities, questions, attempts, answers, and operators are completely forbidden (`allow write: if false`).
  - Public clients can read `leaderboardSnapshots/{activityId}` and its subcollection `entries` only when the activity is `published` or `closed` AND `settings.hideLeaderboardFromParticipants` is false.
  - All sensitive collections (`loginAttempts`, `operators`, `answers`, `participants`, `questionStates`, `attemptSnapshots`) deny all direct client access.
- **Storage Rules (`storage.rules`)**:
  - Image uploads restricted to authenticated operators under `activities/{activityId}/questions/{questionId}/{imageId}`.
  - Content type restricted to `image/jpeg`, `image/png`, and `image/webp`. Maximum file size enforced at 5 MB.
  - Direct public reads are denied (`allow read: if false`); access is granted via short-lived signed URLs.

---

## 4. Scoring Model & Server-Authoritative Timing

### Per-Question Server Enter Markers (Scoring Version 2)
To eliminate vulnerabilities caused by client-side clock tampering, skipping, or out-of-order answering:
1. **Server Enter Marker Endpoint**: `POST /api/attempts/:attemptId/questions/:questionId/enter`.
   - Requires valid `X-Attempt-Token`.
   - Idempotent: First call records `firstEnteredAt` using the server clock. Subsequent calls increment `enterCount` and set `lastEnteredAt` without resetting `firstEnteredAt`.
   - Markers are stored in server-only collection `questionStates/{attemptId}_{questionId}`.
   - `POST /api/public/:slug/start` automatically records the enter marker for the first question (position 1).
   - `enterCount > 1` is preserved as hidden server analytics (back-navigation counter) and never exposed to participants.
2. **Official Question Duration Calculation**:
   $$\text{durationMs} = \text{serverReceivedAt}_{\text{answer}} - \text{firstEnteredAt}_{\text{question}}$$
   Guaranteed $\ge 0$ by construction.
3. **Missing Enter Marker Fallback**:
   If an answer arrives for a question without an enter marker (e.g. client bypassed enter endpoint), the answer is evaluated for correctness scoring, but receives **speed bonus 0** and is stamped with `timingSource: 'missing_marker'`. Answers with valid markers receive `timingSource: 'server_marker'`.
4. **Telemetry Demotion**:
   Client-sent timestamps (`enteredAt`, `answeredAt`) are stored solely as diagnostic metadata (`clientEnteredAt`, `clientAnsweredAt`). They are never used for official duration or speed bonus calculations.
5. **Attempt-Level Question Snapshot**:
   At `POST /start`, the entire question set (text, choices, weights, speed bonus settings, `timeReferenceSeconds`) is snapshotted into `attemptSnapshots/{attemptId}` with `scoringVersion: 2`. All subsequent question serving, answer scoring, and stat compilations read strictly from the snapshot. Cosmetic typo fixes to draft or live questions never mutate an in-progress or historical attempt.

### Speed Bonus & Final Score Calculation
- **Correctness Score**:
  $$\text{finalScore} = \left(\frac{\sum \text{earnedWeight}}{\sum \text{totalWeight}}\right) \times 100$$
- **Speed Bonus**: Correct answers submitted within `timeReferenceSeconds` earn a proportional bonus up to `speedBonusPercent` (capped at 20% max). Wrong answers receive 0 bonus.
- **Leaderboard Points**:
  $$\text{leaderboardPoints} = \text{finalScore} + \sum \text{speedBonusPoints}$$

### Attempt Expiration & Lazy Finalization
- Attempts accept answers while the activity is open (`now < closesAt`).
- Once `closesAt` passes, new answers are immediately rejected.
- A grace window of 120 seconds (`settings.finishGraceSeconds`) allows in-flight attempts to submit `POST /finish`.
- Attempts remaining `in_progress` after `closesAt + finishGraceSeconds` become `expired`. Expired attempts are excluded from the ranked leaderboard and count as incomplete in Stats.
- **Lazy Finalization**: No background cron or scheduled function is required. Finalization runs idempotently on `POST /api/activities/:id/close` and whenever leaderboard or stats are requested after the grace window. A second run changes nothing. When finalized, the leaderboard meta state is set to `'final'`.

---

## 5. Live Realtime Leaderboard Architecture

MODULA implements a high-concurrency, live provisional leaderboard architecture:

### Concepts & Subcollection Data Model
To prevent write contention on a single hot document (Firestore sustains ~1 write/sec per document), the leaderboard is decoupled into:
```text
leaderboardSnapshots/{activityId}                      (small meta document, rarely written)
leaderboardSnapshots/{activityId}/entries/{attemptId}  (one subcollection document per attempt)
```
- **Provisional Points**: On every accepted answer, the answer document, attempt running aggregates, and leaderboard entry are updated **in the same atomic Firestore transaction**. As a result, the live leaderboard updates before finish without lost updates.
- **Final Result**: On `POST /finish`, the entry is updated with final scores and permanently locked (`locked: true`, `status: 'completed'`).
- **Leaderboard State**: `state: 'live'` while the activity is open or attempts are in progress; transitions to `state: 'final'` upon lazy finalization.

### Unified Ordering Comparator
A single deterministic comparator is enforced across client queries, REST endpoints, rebuild routines, and tests:
1. `leaderboardPoints` descending
2. `scorePercent` descending
3. `durationMs` ascending
4. `lastAnswerAt` ascending (for completed entries: `completedAt`)
5. `attemptId` ascending (stable tie-breaker)

The required composite index is configured in `firestore.indexes.json` for collectionGroup `"entries"`.

### Consumption Paths

#### Path A: One-Shot REST API (Top-N & Poll)
- **Endpoint**: `GET /api/leaderboards/:slug` (supports query param `?limit=50`)
- **Response**: Meta document properties (`state`, `updatedAt`, `participantCount`), plus sorted `top5` and full entries with computed `rank` and `locked` flag.
- **Hidden Leaderboard**: When `settings.hideLeaderboardFromParticipants` is `true`, unauthenticated public requests receive `403 Forbidden` (`LEADERBOARD_HIDDEN`), while authenticated operators receive full data.

#### Path B: Direct Firestore Realtime Listener (`onSnapshot`)
For zero-latency live projection displays:
- **Collection Path**: `leaderboardSnapshots/{activityId}/entries`
- **Frontend Code Example**:
  ```typescript
  import { collection, query, orderBy, limit, onSnapshot } from 'firebase/firestore';
  import { db } from './firebase-client';

  const entriesRef = collection(db, 'leaderboardSnapshots', activityId, 'entries');
  const q = query(
    entriesRef,
    orderBy('leaderboardPoints', 'desc'),
    orderBy('scorePercent', 'desc'),
    orderBy('durationMs', 'asc'),
    orderBy('lastAnswerAt', 'asc'),
    orderBy('attemptId', 'asc'),
    limit(50)
  );

  const unsub = onSnapshot(q, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      console.log('Leaderboard change:', change.type, change.doc.data());
    });
  });
  ```
- **Zero-PII Guarantee**: Entries strictly contain safe display data (`attemptId`, `displayName`, `status`, `locked`, `leaderboardPoints`, `scorePercent`, `answeredCount`, `totalQuestions`, `durationMs`, `lastAnswerAt`, `completedAt`). Never includes `participantCode`, `email`, `division`, `customFields`, or choice answers.
- **Rebuild Routine**: Deterministic rebuild method `leaderboardService.rebuildLeaderboardSnapshot(activityId)` recalculates all entries from raw attempt and answer data, verifying that rebuilt data strictly equals incrementally maintained data.

---

## 6. Durable Data & Lifecycle Guardrails

To protect historical contest data and audit trails:
- **Deletion Lock**: `DELETE /api/activities/:id` is permitted only when an activity is in `draft` status AND has zero attempts. Activities with attempts or published activities return `409 Conflict` (`ACTIVITY_HAS_DATA`).
- **Archive Endpoint**: Completed activities can be safely archived via `POST /api/activities/:id/archive`. Archived activities are excluded from standard lists and public views.
- **Question Structure Lock**: Once an activity has at least one attempt, scoring-affecting fields (`weight`, `type`, choices, `isCorrect`, `speedBonus*`, `timeReferenceSeconds`) are permanently immutable. Modification attempts return `409 Conflict` (`QUESTION_LOCKED`). Only cosmetic edits (e.g., fixing a typo in question text) are allowed. Deletion of questions with attempts is blocked.
- **Activity Immutability**: `slug`, `mode`, and `groupId` cannot be altered once an activity is published or has attempts (`409 Conflict: IMMUTABLE_FIELD`).
- **Publish Prerequisites**: Publishing requires at least one question, with at least one correct choice, and a valid schedule window (`opensAt < closesAt`).
- **Pre/Post Linked Activity Requirements**:
  - Activities configured with `phase: 'pre'` or `'post'` must specify a `groupId`.
  - Linked activities **must require `participantCode`** in `participantFields`. Publishing an activity with optional `participantCode` is rejected (`400 PARTICIPANT_CODE_REQUIRED_FOR_LINKED_ACTIVITY`). Once published, `participantCode` cannot be changed back to optional.
  - A group can contain at most one `pre` and one `post` activity, enforced atomically via collection `activityGroupPhases` (`409 DUPLICATE_GROUP_PHASE`).
  - Pre/post question statistics comparison pairs questions by unique `comparisonKey`. Questions without counterparts across both phases are reported as unmatched.

---

## 7. Operators Management

Operators are authored and maintained via dedicated management endpoints (tagged under `Operators` in OpenAPI 3.1):
- `GET /api/operators` — List operators with cursor pagination (owner/crown only).
- `POST /api/operators` — Create operator account, seed Auth user, set custom claims, and store cost-12 bcrypt access code hash.
- `PATCH /api/operators/:uid` — Update role, active status, or reset access code.
- `POST /api/operators/:uid/deactivate` — Instantly deactivate operator and revoke Firebase tokens.
- `POST /api/operators/:uid/reactivate` — Reactivate an inactive operator.

---

## 8. Cloudinary Media Architecture & Direct Upload Flow

MODULA decouples persistent database and authentication concerns from media asset delivery:
- **Firebase**: Authentication, Cloud Firestore (Database, Realtime Leaderboards), Cloud Functions.
- **Cloudinary**: Question diagrams, cover images, and branding assets.

Default quiz music is not uploaded to Cloudinary; it is shipped as static frontend assets.

### Environment Configuration (Server-Only)
The following server environment variables must be configured (see `.env.example`):
```bash
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
CLOUDINARY_UPLOAD_PRESET=modula_question_images_signed
CLOUDINARY_ROOT_ASSET_FOLDER=untitled-modula
```
`CLOUDINARY_API_SECRET` is server-only and is never returned in API responses, logs, OpenAPI specs, or Firestore documents.

### Direct Browser Upload & Confirmation Sequence

```
[Browser / Builder]                  [MODULA Backend]                 [Cloudinary]
       │                                     │                              │
       │ 1. POST /api/assets/upload-intent   │                              │
       ├────────────────────────────────────>│                              │
       │                                     │ Validate MIME, <=5MB, auth   │
       │                                     │ Generate random public_id    │
       │                                     │ Compute signature            │
       │ 2. Return signed intent parameters  │                              │
       │<────────────────────────────────────┤                              │
       │                                                                    │
       │ 3. POST direct multipart upload (file, signature, upload_preset)   │
       ├───────────────────────────────────────────────────────────────────>│
       │ 4. Direct upload success                                           │
       │<───────────────────────────────────────────────────────────────────┤
       │                                                                    │
       │ 5. POST /api/assets/confirm (activityId, questionId, publicId)     │
       ├────────────────────────────────────>│                              │
       │                                     │ 6. Server verify asset       │
       │                                     ├─────────────────────────────>│
       │                                     │ 7. Return verified resource  │
       │                                     │<─────────────────────────────┤
       │                                     │ Enforce format, size, folder │
       │                                     │ Persist trusted metadata     │
       │                                     │ Destroy old media if replaced│
       │ 8. Return confirmed delivery URL    │                              │
       │<────────────────────────────────────┤                              │
```

1. **Upload Intent (`POST /api/assets/upload-intent`)**:
   - Protected: authenticated operator/editor.
   - Enforces format (`image/jpeg`, `image/png`, `image/webp`), max source size (5 MB), positive dimensions, and activity/question ownership.
   - Computes dynamic folder: `untitled-modula/workspaces/default/activities/{activityId}/questions/{questionId}`.
   - Generates unguessable server-side random hex `publicId` (32 characters).
   - Generates SHA-1 HMAC signature and returns direct upload parameters without exposing the API secret.
2. **Direct Browser Upload**:
   - Client sends file bytes directly to `https://api.cloudinary.com/v1_1/<cloudName>/image/upload`.
   - Media bytes never traverse or load MODULA backend serverless instances.
3. **Server Confirmation (`POST /api/assets/confirm`)**:
   - Calls Cloudinary resource API server-side to independently verify uploaded asset metadata.
   - Validates format, enforces declared bytes $\le 5$ MB, and validates dynamic folder context.
   - Transactionally persists trusted metadata on question document: `assetId`, `publicId`, `version`, `resourceType`, `format`, `width`, `height`, `bytes`, `secureUrl`, `assetFolder`, `provider: 'cloudinary'`.
   - Idempotent: repeated calls with the same `publicId` return current confirmed metadata without duplicate work.
4. **Delivery & Participant Exposure**:
   - Published questions deliver Cloudinary HTTPS URLs with automatic browser format and quality negotiation (`f_auto, q_auto`).
   - Internal administrative asset metadata is stripped from participant payloads.
5. **Deletion & Safe Replacement**:
   - When question images are replaced or questions are deleted, old Cloudinary assets are cleanly destroyed (`uploader.destroy(publicId, { invalidate: true })`) without leaving dangling or broken Firestore references.

---

## 9. Local URLs & Hosting Configuration

Firebase Hosting is configured with rewrite rules routing `/api/**` to Cloud Function `api`.

### Clean Hosting URLs (Port 5000)
- **Swagger Documentation UI**: `http://127.0.0.1:5000/api/docs`
- **OpenAPI 3.1 Specification JSON**: `http://127.0.0.1:5000/api/openapi.json`
- **API Base**: `http://127.0.0.1:5000/api`

### Direct Cloud Functions URLs (Port 5001)
- **Swagger Documentation UI**: `http://127.0.0.1:5001/modula-backend-dev/us-central1/api/api/docs`
- **OpenAPI 3.1 Specification JSON**: `http://127.0.0.1:5001/modula-backend-dev/us-central1/api/api/openapi.json`
- **API Base**: `http://127.0.0.1:5001/modula-backend-dev/us-central1/api/api`

---

## 10. Deviations and Trade-offs

1. **Subcollection `entries` for Leaderboard**:
   To avoid a single shared hot document and reduce write contention under high concurrency, individual participant entries are stored in `leaderboardSnapshots/{activityId}/entries/{attemptId}` with independent per-attempt writes, while raw attempts and answers remain the durable source of truth and metadata remains at `leaderboardSnapshots/{activityId}`.
2. **Server-Only Collections (`questionStates` & `attemptSnapshots`)**:
   `questionStates` stores enter markers and hidden back-navigation counters. `attemptSnapshots` permanently isolates frozen question structures from the lightweight attempt document, ensuring historical scoring integrity.
3. **Lazy Idempotent Leaderboard Finalization**:
   Instead of requiring a scheduled Cloud Function (cron), finalization runs lazily on activity close (`POST /close`) and whenever leaderboard or stats are retrieved after the finish grace window.
4. **Question Comparison Pairing via `comparisonKey`**:
   Rather than fragile position-based index pairing across two distinct activities, pre/post delta pairing matches questions using explicit `comparisonKey` attributes.
5. **Direct Firestore Role Authority**:
   To eliminate security windows where revoked or downgraded operators use unexpired ID tokens, role and status are loaded directly from the Firestore operator record on every protected request with zero cache.
6. **Cloudinary Asset Storage Provider**:
   Firebase Storage runtime (`admin.storage()`) and Google signed upload/read URLs have been removed from runtime in favor of `AssetStorageProvider` with `CloudinaryAssetStorageProvider`. The media test path requires only Auth and Firestore emulators.
7. **OpenAPI `Assets` Tag**:
   Replaced deprecated `Storage` tag with `Assets` documenting signed upload intents and server-side asset confirmations.
8. **Vitest Serial Test Execution**:
   Because multiple integration test suites interact with shared Firestore emulator collections (`operators`, `loginAttempts`, `attempts`), `fileParallelism: false` is configured in `functions/vitest.config.ts`. This prevents cross-file race conditions on document resets.

---

## 11. Known Limitations

1. **Network Latency Variance**:
   Server-authoritative timing measures elapsed time using `serverReceivedAt`. On mobile networks with high jitter or intermittent disconnects, latency spikes may slightly increase recorded duration.
2. **Tab Left Open / Idle Time**:
   Because question duration is measured from `firstEnteredAt` to `serverReceivedAt`, if a participant leaves a question tab open or steps away before answering, the recorded duration reflects the total elapsed time.

---

## 12. Local Development & Verification

### 1. Prerequisites
- Node.js `22`
- Java 21+ (for Firestore and Auth emulators)
- Firebase CLI (`firebase-tools`)

### 2. Install & Build
```bash
npm --prefix functions install
npm --prefix functions run build
npm --prefix functions run typecheck
npm --prefix functions run lint
npm --prefix functions run openapi:validate
```

### 3. Run Automated Tests in Emulator Suite
```bash
firebase emulators:exec --only auth,firestore "npm --prefix functions test"
```
The test suite executes 221 tests across 16 test suites covering role matrices, live leaderboards, attempt security, enter marker timing, pre/post identity requirements, attempt snapshots, leak prevention, pagination, emulator smoke tests, and Cloudinary media migration.

### 4. Running Emulators Locally
```bash
firebase emulators:start --only auth,firestore,functions,hosting
```

---

## 13. Deployment to Firebase & Cloudinary

### 1. Cloudinary Setup
In the Cloudinary Console:
1. Create a signed upload preset named `modula_question_images_signed` (Signing Mode: `Signed`).
2. Restrict allowed formats to `jpg, jpeg, png, webp`.
3. Set environment variables in Cloud Functions runtime:
   `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_UPLOAD_PRESET`, `CLOUDINARY_ROOT_ASSET_FOLDER`.

### 2. Firebase Deployment
1. Log in to Firebase CLI:
```bash
firebase login
```
2. Set target project:
```bash
firebase use <project-id>
```
3. Deploy Firestore rules and composite indexes:
```bash
firebase deploy --only firestore
```
4. Deploy Cloud Functions:
```bash
firebase deploy --only functions
```
5. Deploy Hosting rewrites:
```bash
firebase deploy --only hosting
```
6. Bootstrap initial owner operator:
```bash
OWNER_USERNAME=owner OWNER_ACCESS_CODE=your-secure-code-min-12-chars npm --prefix functions run bootstrap:owner
```

---

## 14. License

Copyright (c) 2026 parikesitad-pm. Released under the MIT License.
