# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] - 2026-10-05 (Sprint 1.1 Addendum 2 - Final Corrections)

### Added
- **Question Reveal Official Timer (Anti-Cheat H1-H4)**: `GET /api/public/:slug` returns strictly safe activity metadata and `questionCount`, never leaking question bodies or choices. `POST /api/public/:slug/start` reveals the first question and initializes its server timer marker atomically. `POST /api/attempts/:attemptId/questions/:questionId/enter` reveals subsequent snapshot questions and starts/records official question markers.
- **Canonical Leaderboard Ordering via `rankTimeAt` (Section I)**: Added concrete field `rankTimeAt` (`lastAnswerAt` while in-progress, `completedAt` when completed). Standardized composite order across Firestore queries, REST sorting, and rebuild routines: `leaderboardPoints` DESC, `scorePercent` DESC, `durationMs` ASC, `rankTimeAt` ASC, `attemptId` ASC. Updated `firestore.indexes.json` accordingly.
- **Authoritative Schedule Closure & Idempotent Finalization (Section J)**: Natural expiration occurs after `closesAt + finishGraceSeconds` (`effectiveClosed`), transitioning leaderboard state to `final`, expiring in-progress attempts lazily, and blocking new attempts and answers with `ACTIVITY_CLOSED`.
- **Pre/Post Group Phase Concurrency & Snapshotting (Section K)**: Concurrency-safe transactions on `activityGroupPhases/{groupId}_{phase}` ensuring at most one `pre` and one `post` per group. Question comparison strictly honors snapshotted `comparisonKey` even if live questions are modified.
- **Best-Attempt Leaderboard Projection for `maxAttempts > 1` (Section L)**: Leaderboard reflects only the participant's best eligible attempt based on normalized `participantCode`, replacing earlier attempts only when a later attempt scores better. Stats and response exports preserve all durable attempts.
- **Comprehensive Addendum 2 Test Suite**: Added 12 dedicated integration tests in `functions/tests/integration/sprint-1.1-addendum-2.test.ts` covering H1-H5, I, J, K1-K2, and L.

### Changed
- Clarified write contention and subcollection rationale in `README.md` (Section M).
- Updated emulator smoke test to cover metadata fetch, first question reveal at start, question enter, answer, live leaderboard update, finish, and close finalization (Section N).

## [0.2.1] - 2026-10-05 (Sprint 1.1 Addendum Hardening)

### Added
- **Live Provisional Leaderboard**: High-concurrency subcollection architecture `leaderboardSnapshots/{activityId}/entries/{attemptId}` preventing hot document write contention under high load.
- **Atomic Score & Leaderboard Maintenance**: Answer submission updates answer document, attempt aggregates, and leaderboard entry in a single atomic Firestore transaction.
- **Per-Question Server Enter Markers**: `POST /api/attempts/:attemptId/questions/:questionId/enter` endpoint with server-only collection `questionStates/{attemptId}_{questionId}`. Tracks `firstEnteredAt`, `lastEnteredAt`, and `enterCount` (hidden back-navigation analytics).
- **Official Duration Engine (Scoring Version 2)**: Computes official question duration from `firstEnteredAt` to `serverReceivedAt`. Missing markers assign 0 speed bonus with `timingSource: 'missing_marker'`.
- **Firestore-Authoritative Operator Role & Status**: Protected routes load operator record by `uid` directly from Firestore on every request (`verifyIdToken(token, true)`), applying role changes or deactivations immediately on the next request.
- **Attempt-Level Snapshots**: Question bodies, weights, and choices frozen into server-only `attemptSnapshots/{attemptId}` upon attempt start (`POST /start`). Edits made later affect only future attempts.
- **Pre/Post Identity Requirements**: Linked pre/post activities require `participantCode` marked as required, enforce 1 `pre` and 1 `post` per `groupId`, and pair question delta statistics via `comparisonKey`.
- **Text Variants Tracking in Question Stats**: Exposes `textVariants` in `GET /api/activities/:id/question-stats` when questions are cosmetically modified across attempts.
- **Participant Detail Endpoint**: Added `GET /api/activities/:id/participants/:participantId` providing organizer inspection with snapshot question labels.
- **Comprehensive Addendum Test Suite**: Added 19 integration tests covering live provisional ordering, concurrent attempts, idempotent finalization, rebuild vs incremental verification, role revocation, and zero-PII leak scans.
- **Updated Functions Emulator Smoke Test**: End-to-end smoke test covering start, enter, answer, live leaderboard verification prior to finish, finish locking, and activity close.

### Changed
- Shifted leaderboard finalization from scheduled functions to lazy, idempotent execution on activity close and post-grace period requests.
- Demoted Firebase custom claims to informational status, taking authorization authority directly from Firestore.
- Sanitized `finishAttempt` response payload to aggregate scores only, eliminating individual question correctness leakage.
- Bumped total automated test suite to 207 tests across 15 test files (100% passing).

## [0.2.0] - 2026-10-05

### Added
- Cryptographic attempt token generation (32-byte URL-safe) with one-time issuance and constant-time SHA-256 validation via `X-Attempt-Token` header.
- Deterministic answer IDs (`{attemptId}_{questionId}`) with transactional duplicate prevention (`409 ALREADY_ANSWERED`).
- Server-authoritative timing engine deriving official question durations from `serverReceivedAt` timestamps.
- Attempt scoring snapshots and `scoringVersion: 1` preserving historical scoring integrity against subsequent question authoring edits.
- Enforced role hierarchy (`operator < manager < owner < crown`) and centralized permission matrix in `auth.middleware.ts`.
- Operator management endpoints (`GET /api/operators`, `POST /api/operators`, `PATCH /api/operators/:uid`, `POST /api/operators/:uid/deactivate`, `POST /api/operators/:uid/reactivate`) with token revocation and last-owner protection.
- Transaction-backed rate limiter on `loginAttempts` collection (5 failures per 15 minutes default) with HTTP 429 and `Retry-After` header.
- Precomputed dummy hash verification on unknown usernames to prevent side-channel timing attacks.
- Activity lifecycle protections: `POST /api/activities/:id/archive`, draft deletion checks (`409 ACTIVITY_HAS_DATA`), and immutable fields (`slug`, `mode`, `groupId`) once published.
- Question structure lock (`409 QUESTION_LOCKED`) for scoring-critical properties when attempts exist.
- SystemClock and MockClock provider abstraction in `functions/src/lib/clock.ts`.
- Firebase Hosting rewrites (`/api/**` to `api`) with local emulator configuration on port 5000.
- OpenAPI 3.1 validator script using `@apidevtools/swagger-parser` and added `Operators` tag.
- Comprehensive integration test suites in Vitest: 185 tests across 14 test suites covering role matrix (100 cases), attempt security, answer leaks, and emulator smoke tests.

### Changed
- Pinned all dependencies in `functions/package.json` to exact versions (removed all `^` prefixes) and pinned Node engine to exact `"22"`.
- Configured Vitest `fileParallelism: false` to ensure serial execution across integration tests on shared Firestore collections.
- Stripped sensitive answer keys (`correctChoiceIds`, `attemptTokenHash`) from participant attempt queries.
- Participant codes are strictly normalized (trimmed, uppercased, collapsed whitespace).
- Leaderboard snapshots stripped of all participant PII (`rank`, `displayName`, `finalScore`, `leaderboardPoints`, `durationMs`, `completedAt`).

### Fixed
- Fixed timing leaks and user enumeration vulnerabilities on operator login.
- Fixed public participant endpoint to respect mock clock provider rather than host `Date.now()`.
- Fixed Base64URL JWT payload decoding fallback in authorization middleware.
- Fixed rate limiter failure recording to use transactions with upsert semantics.
- Fixed activity publish validation requiring at least one question with choices before publishing.

## [0.1.0] - 2026-10-04

### Added
- Initial project scaffold for MODULA Firebase Backend with Cloud Functions v2 and Express.
- Basic activity management, questions authoring, and participant intake endpoints.
- Pure scoring engine for correctness, speed bonus, and leaderboard points.
- Initial Firestore and Storage security rules.
- OpenAPI 3.1 schema definition and Swagger UI endpoints.
- Bootstrap script for initial owner account.
