# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
