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
- **Database**: Cloud Firestore with Composite Indexes
- **Authentication**: Firebase Authentication + Private Firestore Operator Records with Bcrypt
- **Storage**: Firebase Storage with security policies for question media assets
- **Validation**: Zod with `@asteasolutions/zod-to-openapi`
- **API Specification**: OpenAPI 3.1 & Swagger UI with `@apidevtools/swagger-parser` validation
- **Testing**: Vitest (serial execution `fileParallelism: false`) & Supertest with Firebase Emulator Suite

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

### Role Authorization Matrix
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

- Role claims are cryptographically verified via Firebase Auth custom claims and verified against the operator's active status in Firestore.
- Deactivated operators have their Firebase refresh tokens immediately revoked via `auth.revokeRefreshTokens(uid)` and are blocked from all endpoints.
- Role escalation rules: Operators can only create or promote users to roles **strictly below** their own level. The `crown` role can assign any role. No user can alter their own role.
- **Last Owner Protection**: The system rejects deactivating or demoting the last remaining active `owner` or `crown` with `409 Conflict` (`LAST_OWNER_PROTECTION`).

### Login Hardening & Brute-Force Rate Limiting
- **Password Hashing**: Bcrypt with cost factor `12` is locked across all operator passwords and access codes.
- **Constant-Time Dummy Verification**: When an unknown username is submitted, the system performs a dummy bcrypt verification against a precomputed cost-12 hash to prevent user enumeration via response timing.
- **Generic Error Responses**: Both non-existent users and incorrect access codes return identical generic messages: `401 Unauthorized: Invalid credentials`.
- **Transaction-Backed Rate Limiting**: Failed logins are recorded in a server-only Firestore collection (`loginAttempts`), isolated from client read/write rules.
- **Lockout Policy**: Defaults to 5 failures per 15-minute sliding window (configurable via `LOGIN_MAX_FAILURES` and `LOGIN_WINDOW_SECONDS`). Exceeding the threshold triggers `429 Too Many Requests` with a standard `Retry-After` header. Successful login immediately resets the failure counter.
- Zero credential logging: passwords, access codes, tokens, and hashes are strictly excluded from server logs and API responses.

### Firestore & Storage Security Rules
- **Firestore Rules (`firestore.rules`)**:
  - Operators with verified auth tokens have read/write access according to server rules.
  - Direct client writes to activities, questions, attempts, answers, and operators are completely forbidden (`allow write: if false`).
  - Public clients can only read `leaderboardSnapshots` if the parent activity is `published` or `closed` and `settings.leaderboardVisible` is `true`.
  - All sensitive collections (`loginAttempts`, `operators`, `answers`, `participants`) deny all direct client access.
- **Storage Rules (`storage.rules`)**:
  - Image uploads restricted to authenticated operators under `activities/{activityId}/questions/{questionId}/{imageId}`.
  - Content type restricted to `image/jpeg`, `image/png`, and `image/webp`. Maximum file size enforced at 5 MB.
  - Direct public reads are denied (`allow read: if false`); access is granted via short-lived signed URLs.

---

## 4. Scoring Model & Server-Authoritative Timing

### Server-Authoritative Timing
Client-side clocks cannot be trusted. MODULA enforces strict server-authoritative timing:
1. **Server Timestamps**: Every submitted answer is stamped with `serverReceivedAt` by the server clock.
2. **Official Question Duration Calculation**:
   $$\text{durationMs} = \text{serverReceivedAt}_{\text{current}} - \max(\text{attempt.startedAt}, \text{serverReceivedAt}_{\text{previous}})$$
   Clamped to $\ge 0$.
3. **Telemetry Demotion**: Client-sent timestamps (`enteredAt`, `answeredAt`, `durationMs`) are preserved solely for diagnostic inspection as `clientEnteredAt`, `clientAnsweredAt`, and `clientDurationMs`. They have zero impact on score calculations.
4. **Scoring Snapshot & Versioning**: Upon attempt creation, question weights, scoring rules, speed bonus parameters, and `scoringVersion: 1` are permanently snapshotted into the attempt document. Future edits to questions never mutate historical scores.

### Speed Bonus & Final Score Calculation
- **Correctness Score**:
  $$\text{finalScore} = \left(\frac{\sum \text{earnedWeight}}{\sum \text{totalWeight}}\right) \times 100$$
- **Speed Bonus**: Correct answers submitted within `timeReferenceSeconds` earn a proportional bonus up to `speedBonusPercent` (capped at 20% max). Wrong answers receive 0 bonus.
- **Leaderboard Points**:
  $$\text{leaderboardPoints} = \text{finalScore} + \sum \text{speedBonusPoints}$$

### Attempt Expiration & Grace Window
- Attempts allow question answers while the activity is open (`now < closesAt`).
- Once `closesAt` passes, new answers are immediately rejected.
- To prevent network drop-outs from penalizing participants who answered all questions before closing, `POST /api/attempts/:id/finish` remains open for a configurable grace window of 120 seconds (`settings.finishGraceSeconds`). Beyond this window, finish requests return `400 Bad Request` (`ACTIVITY_CLOSED`).

---

## 5. Realtime Leaderboard Architecture

MODULA offers two distinct consumption paths for the Leaderboard:

### Path A: One-Shot REST API (Poll / Webhook)
- **Endpoint**: `GET /api/leaderboards/:slug`
- **Response**: High-level metadata, Top 5 highlighted participants, and a compact sorted participant list.
- **Hidden Leaderboard**: When `settings.leaderboardVisible` is `false`, unauthenticated public requests receive `403 Forbidden` (`LEADERBOARD_HIDDEN`), while authenticated operators receive the full leaderboard.

### Path B: Direct Firestore Realtime Listener (`onSnapshot`)
For live reactive leaderboard displays (e.g., event projection screens):
- **Document Path**: `leaderboardSnapshots/{activityId}`
- **Frontend Code Example**:
  ```typescript
  import { doc, onSnapshot } from 'firebase/firestore';
  import { db } from './firebase-client';

  const unsub = onSnapshot(doc(db, 'leaderboardSnapshots', activityId), (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.data();
      console.log('Top entries:', data.entries);
    }
  });
  ```
- **Zero-PII Guarantee**: The snapshot document contains strictly sanitized display fields: `rank`, `displayName`, `finalScore`, `leaderboardPoints`, `durationMs`, and `completedAt`. Fields such as `participantCode`, `email`, `division`, and `customFields` are never included.
- **Deterministic Rebuilding**: A service rebuild method (`leaderboardService.rebuildSnapshot(activityId)`) recomputes the snapshot from raw completed attempts to guarantee that `rebuilt == incremental`.

---

## 6. Durable Data & Lifecycle Guardrails

To protect historical contest data and audit trails:
- **Deletion Lock**: `DELETE /api/activities/:id` is permitted only when an activity is in `draft` status AND has zero attempts. Activities with attempts or published activities return `409 Conflict` (`ACTIVITY_HAS_DATA`).
- **Archive Endpoint**: Completed activities can be safely archived via `POST /api/activities/:id/archive`. Archived activities are excluded from standard lists and public views.
- **Question Structure Lock**: Once an activity has at least one attempt, scoring-affecting fields (`weight`, `type`, choices, `isCorrect`, `speedBonus*`, `timeReferenceSeconds`) are permanently immutable. Modification attempts return `409 Conflict` (`QUESTION_LOCKED`). Only cosmetic edits (e.g., fixing a typo in question text) are allowed. Deletion of questions with attempts is blocked.
- **Activity Immutability**: `slug`, `mode`, and `groupId` cannot be altered once an activity is published or has attempts (`409 Conflict: IMMUTABLE_FIELD`).
- **Publish Prerequisites**: Publishing requires at least one question, with at least one correct choice, and a valid schedule window (`opensAt < closesAt`).

---

## 7. Operators Management

Operators are authored and maintained via dedicated management endpoints (tagged under `Operators` in OpenAPI 3.1):
- `GET /api/operators` — List operators with cursor pagination (owner/crown only).
- `POST /api/operators` — Create operator account, seed Auth user, set custom claims, and store cost-12 bcrypt access code hash.
- `PATCH /api/operators/:uid` — Update role, active status, or reset access code.
- `POST /api/operators/:uid/deactivate` — Instantly deactivate operator and revoke Firebase tokens.
- `POST /api/operators/:uid/reactivate` — Reactivate an inactive operator.

---

## 8. Local URLs & Hosting Configuration

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

## 9. Deviations and Trade-offs

1. **Storage Signed URLs in Emulator**:
   In production Google Cloud environments, signed URLs are generated via Google Cloud Storage RSA private keys. In the local Firebase Emulator Suite, service account keys are not available; therefore, the storage service generates an emulator-compatible media URL fallback (`http://127.0.0.1:9199/v0/b/...`) when running under `FUNCTIONS_EMULATOR=true`.
2. **OpenAPI `Operators` Tag**:
   As required by Sprint 1.1 Section 5, an explicit `Operators` tag was added to OpenAPI 3.1 to document operator administration endpoints alongside `Auth`, `Activities`, `Questions`, `Attempts`, `Leaderboard`, `Stats`, and `Storage`.
3. **Vitest Serial Test Execution**:
   Because multiple integration test suites interact with shared Firestore emulator collections (`operators`, `loginAttempts`, `attempts`), `fileParallelism: false` is configured in `functions/vitest.config.ts`. This prevents cross-file race conditions on document resets.

---

## 10. Known Limitations

1. **Network Latency Variance**:
   Server-authoritative timing measures elapsed time using `serverReceivedAt`. On mobile networks with high jitter or intermittent disconnects, latency spikes may slightly increase recorded duration.
2. **Unordered Question Answering**:
   Because participants can answer questions in arbitrary order, question duration is derived by taking the delta from the previously recorded answer (or attempt start time). If a participant pauses on one question before answering another, the idle duration is associated with the active question window.

---

## 11. Local Development & Verification

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
firebase emulators:exec --only auth,firestore,functions,hosting,storage "npm --prefix functions test"
```
The test suite executes 185 tests across 14 test suites covering role matrices, attempt security, timing attacks, leak prevention, pagination, and emulator smoke tests.

### 4. Running Emulators Locally
```bash
firebase emulators:start
```

---

## 12. Deployment to Firebase

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
4. Deploy Storage rules:
```bash
firebase deploy --only storage
```
5. Deploy Cloud Functions:
```bash
firebase deploy --only functions
```
6. Deploy Hosting rewrites:
```bash
firebase deploy --only hosting
```
7. Bootstrap initial owner operator:
```bash
OWNER_USERNAME=owner OWNER_ACCESS_CODE=your-secure-code-min-12-chars npm --prefix functions run bootstrap:owner
```

---

## 13. License

Copyright (c) 2026 parikesitad-pm. Released under the MIT License.
