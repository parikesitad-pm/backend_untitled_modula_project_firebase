# MODULA Activity Backend — Firebase First

Backend-first implementation for MODULA Activity platform built with Firebase (Cloud Functions v2, Firestore, Auth, Storage, and Emulator Suite), Express, TypeScript, and Zod.

## Product Model

The core parent entity is **Activity**. An Activity represents a complete unit comprising four product areas:
1. **Builder** — Authoring questions (Markdown/rich technical text, 255 char prompt limit), weights, speed bonus settings, and choices.
2. **Participant Area** — Intake form with participant fields and test execution interface without answer leakage.
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

## Tech Stack

- **Runtime**: Node.js (>=20) & TypeScript
- **Serverless**: Firebase Cloud Functions v2 (HTTP Express API)
- **Database**: Cloud Firestore
- **Authentication**: Firebase Authentication + Private Firestore Operator Records with Bcrypt
- **Storage**: Firebase Storage with security policies for question media assets
- **Validation**: Zod with `@asteasolutions/zod-to-openapi`
- **API Specification**: OpenAPI 3.1 & Swagger UI
- **Testing**: Vitest & Supertest with Firebase Emulator Suite

---

## Repository Structure

```text
/
├── firebase.json              # Firebase services and emulator configuration
├── .firebaserc.example        # Example Firebase project targets
├── firestore.rules            # Firestore security rules
├── firestore.indexes.json      # Composite query indexes
├── storage.rules              # Storage bucket security rules
├── functions/
│   ├── src/
│   │   ├── index.ts           # Cloud Functions v2 entrypoint
│   │   ├── app.ts             # Express application wiring & Swagger UI
│   │   ├── config/            # Env and Firebase Admin SDK initialization
│   │   ├── middleware/        # Auth, Zod validation, and error handlers
│   │   ├── modules/
│   │   │   ├── auth/          # Operator login, custom token issuance, /me
│   │   │   ├── activities/    # Activity CRUD, schedule validation, publish/close
│   │   │   ├── questions/     # Question & choice authoring, reordering
│   │   │   ├── participants/  # Durable participant intake & public slug access
│   │   │   ├── attempts/      # Attempt lifecycle, answer recording, final scoring
│   │   │   ├── leaderboard/   # Realtime points, top 5 highlights, compact list
│   │   │   ├── stats/         # Summary analytics, question stats, pre/post delta
│   │   │   └── storage/       # Signed upload URL generation & image policies
│   │   ├── lib/               # Pure scoring engine, hash helpers, custom errors
│   │   └── openapi/           # OpenAPI 3.1 definitions & registry
│   ├── scripts/
│   │   └── bootstrap-owner.ts # Local script to seed initial owner operator
│   ├── tests/
│   │   ├── unit/              # Pure scoring, hash, and OpenAPI unit tests
│   │   └── integration/       # Full 19 scenario integration tests
│   ├── package.json
│   └── tsconfig.json
├── CHANGELOG.md
├── LICENSE
└── README.md
```

---

## Local Setup & Development

### 1. Prerequisites
- Node.js >= 20
- Java 21+ (required for Firestore & Auth Emulators)
- Firebase CLI (`npm install -g firebase-tools`)

### 2. Installation
```bash
git clone <repository-url>
cd untitled_a_modula_project
cd functions && npm install && cd ..
```

### 3. Build Functions
```bash
cd functions
npm run build
cd ..
```

### 4. Running Emulators Locally
To run Auth, Firestore, Functions, Storage, and Emulator UI:
```bash
firebase emulators:start
```
The Emulator UI will be accessible at:
- **Emulator UI**: `http://localhost:4000`
- **Functions Base URL**: `http://127.0.0.1:5001/modula-backend-dev/us-central1/api`
- **Swagger Documentation**: `http://127.0.0.1:5001/modula-backend-dev/us-central1/api/api/docs`
- **OpenAPI 3.1 JSON**: `http://127.0.0.1:5001/modula-backend-dev/us-central1/api/api/openapi.json`

---

## Bootstrapping the First Owner

No public signup is permitted. To bootstrap the initial owner account:

```bash
# In local development / emulator
firebase emulators:exec --only auth,firestore "npm --prefix functions run bootstrap:owner"
```
Or directly against a connected Firebase project:
```bash
cd functions
OWNER_USERNAME=owner OWNER_ACCESS_CODE=your-secure-code npm run bootstrap:owner
```

---

## Automated Tests

The test suite covers unit tests and the 19 required integration scenarios in the Firebase Emulator:
1. Operator login success & failure
2. Unauthorized protected route blocking
3. Role authorization
4. Unique slug enforcement
5. Question prompt 255-character validation
6. Invalid schedule rejection (`opensAt >= closesAt`)
7. Unpublished/draft activity public blocking
8. Activity before open time blocking
9. Activity after close time blocking
10. Start attempt lifecycle
11. Submit correct answer
12. Submit wrong answer
13. Custom question weight calculations
14. Speed bonus calculation (within time reference, capped)
15. Final score calculation (`earnedWeight / totalWeight * 100`)
16. Leaderboard ranking (points DESC, durationMs ASC)
17. Stats aggregation (participants, scores, question stats)
18. Pre/post test comparison delta within group
19. Zero answer leakage (`isCorrect` stripped from public payloads)

### Run Tests
```bash
firebase emulators:exec --only auth,firestore "npm --prefix functions test"
```

---

## API Endpoints Summary

### Auth
- `POST /api/auth/login` — Operator authentication (returns custom token)
- `GET /api/auth/me` — Current operator profile

### Activities
- `GET /api/activities` — List activities with filters
- `POST /api/activities` — Create an activity (validates slug and schedule)
- `GET /api/activities/:id` — Get activity details
- `PATCH /api/activities/:id` — Update activity configuration
- `DELETE /api/activities/:id` — Delete an activity
- `POST /api/activities/:id/publish` — Publish activity
- `POST /api/activities/:id/close` — Close activity

### Questions
- `GET /api/activities/:id/questions` — List questions with choices (operator view)
- `POST /api/activities/:id/questions` — Add question (limit 255 chars)
- `PATCH /api/questions/:id` — Update question & choices
- `DELETE /api/questions/:id` — Delete question
- `POST /api/questions/reorder` — Reorder questions

### Public Participant Area
- `GET /api/public/:slug` — Activity metadata & questions (answers scrubbed)
- `POST /api/public/:slug/start` — Start participant attempt

### Attempts
- `POST /api/attempts/:attemptId/answers` — Record question answer & timing
- `POST /api/attempts/:attemptId/finish` — Complete attempt & compute final score
- `GET /api/attempts/:attemptId` — Get attempt details

### Leaderboard
- `GET /api/leaderboards/:slug` — Top 5 highlighted & compact participant list

### Stats / Analytics
- `GET /api/activities/:id/stats` — Aggregate metrics (scores, completion, timing)
- `GET /api/activities/:id/participants` — Durable participant results list
- `GET /api/activities/:id/responses` — Exportable responses database
- `GET /api/activities/:id/question-stats` — Question accuracy & duration analytics
- `GET /api/groups/:groupId/comparison` — Pre/post test group comparison

### Storage
- `POST /api/storage/upload-url` — Request signed URL for question image upload

---

## Deployment to Firebase

1. Authenticate with Firebase CLI:
```bash
firebase login
```
2. Select your Firebase project:
```bash
firebase use <project-id>
```
3. Deploy Firestore rules and indexes:
```bash
firebase deploy --only firestore
```
4. Deploy Storage rules:
```bash
firebase deploy --only storage
```
5. Deploy Functions:
```bash
firebase deploy --only functions
```

---

## License

MIT License (c) 2026 parikesitad-pm
