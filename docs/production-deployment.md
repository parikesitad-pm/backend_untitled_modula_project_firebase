# MODULA Backend — Production Deployment Guide

This guide details the deployment of the MODULA Activity Backend to production.

## Architecture Overview

```text
Vercel
└── Node.js 22 + TypeScript + Express REST API (Production API)

Firebase (Project: untitled-modula-backend)
├── Authentication (Identity)
├── Firestore (Persistent Data & Realtime Leaderboards)
└── Security Rules & Indexes

Cloudinary (Cloud Name: xkhsmbmg)
└── Direct signed uploads & optimized media delivery
```

> [!IMPORTANT]
> - **Production API**: Runs exclusively on **Vercel Serverless Functions**.
> - **Firebase Cloud Functions**: Retained strictly for local emulator suite and development; **not** deployed to production.
> - **Firebase Hosting & Storage**: Not used in production. Media assets are hosted and transformed via Cloudinary.

---

## Environment Matrix

| Environment Variable | Description | Example / Note |
|---|---|---|
| `NODE_ENV` | Runtime environment mode | `production` |
| `FIREBASE_PROJECT_ID` | Target Firebase project ID | `untitled-modula-backend` |
| `FIREBASE_CLIENT_EMAIL` | Service Account client email | `firebase-adminsdk-...@untitled-modula-backend.iam.gserviceaccount.com` |
| `FIREBASE_PRIVATE_KEY` | Service Account private key with newlines | `"-----BEGIN PRIVATE KEY-----\nMII...\n-----END PRIVATE KEY-----\n"` |
| `CLOUDINARY_CLOUD_NAME` | Cloudinary tenant name | `xkhsmbmg` |
| `CLOUDINARY_API_KEY` | Cloudinary API Key | *(Secret from Cloudinary Console)* |
| `CLOUDINARY_API_SECRET` | Cloudinary API Secret | *(Secret from Cloudinary Console)* |
| `CLOUDINARY_UPLOAD_PRESET`| Signed upload preset | `modula_question_images_signed` |
| `CLOUDINARY_ROOT_ASSET_FOLDER` | Root folder namespace | `untitled-modula` |
| `ALLOWED_ORIGINS` | Permitted frontend origins (comma-separated) | `https://app.modula.example,https://admin.modula.example` |
| `PUBLIC_API_BASE_URL` | Public API URL for OpenAPI docs | `https://api.modula.example` (or Vercel URL) |
| `LOGIN_MAX_FAILURES` | Max failed logins before lockout (default: 5) | `5` |
| `LOGIN_WINDOW_SECONDS` | Lockout window in seconds (default: 900) | `900` |

---

## Step-by-Step Deployment Checklist

### 1. Verify Firebase Project
Ensure your Firebase CLI is authenticated and connected to the production project:
```bash
firebase login
firebase use untitled-modula-backend
```

### 2. Create Firebase Service Account Credentials
1. Open the [Google Cloud Console](https://console.cloud.google.com/) or Firebase Console for `untitled-modula-backend`.
2. Navigate to **Project Settings > Service Accounts**.
3. Click **Generate New Private Key**.
4. Securely store the downloaded JSON file. You will use:
   - `project_id` -> `FIREBASE_PROJECT_ID`
   - `client_email` -> `FIREBASE_CLIENT_EMAIL`
   - `private_key` -> `FIREBASE_PRIVATE_KEY`

> [!CAUTION]
> Never commit the service account JSON file to git. It is ignored by `.gitignore`.

### 3. Create Vercel Project
1. Log in to [Vercel](https://vercel.com).
2. Click **Add New > Project** and import the `backend_untitled_modula_project_firebase` repository.

### 4. Set Root Directory in Vercel
In the Vercel project configuration settings:
- **Framework Preset**: Other
- **Root Directory**: `functions`

### 5. Configure Vercel Environment Variables
In **Project Settings > Environment Variables**, add the variables for **Production** (and optionally **Preview**):
- `NODE_ENV` = `production`
- `FIREBASE_PROJECT_ID` = `untitled-modula-backend`
- `FIREBASE_CLIENT_EMAIL` = *(your service account email)*
- `FIREBASE_PRIVATE_KEY` = *(your service account private key, including PEM headers)*
- `CLOUDINARY_CLOUD_NAME` = `xkhsmbmg`
- `CLOUDINARY_API_KEY` = *(your cloudinary api key)*
- `CLOUDINARY_API_SECRET` = *(your cloudinary api secret)*
- `CLOUDINARY_UPLOAD_PRESET` = `modula_question_images_signed`
- `CLOUDINARY_ROOT_ASSET_FOLDER` = `untitled-modula`
- `ALLOWED_ORIGINS` = `https://your-frontend-domain.com`

### 6. Deploy Firestore Rules and Composite Indexes
Deploy only Firestore rules and composite indexes to Firebase:
```bash
firebase deploy --only firestore
```
*Note: Do NOT deploy hosting, storage, or functions.*

### 7. Deploy Vercel API
Trigger deployment via git push or via the Vercel CLI:
```bash
# Push to main/deployment branch
git push origin <branch>

# Or deploy via Vercel CLI from functions directory:
vercel --prod
```

### 8. Bootstrap First Platform Owner
Initialize the primary `platform_owner` operator account in production:
```bash
NODE_ENV=production \
FIREBASE_PROJECT_ID=untitled-modula-backend \
FIREBASE_CLIENT_EMAIL=your-service-account@untitled-modula-backend.iam.gserviceaccount.com \
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n" \
OWNER_USERNAME=admin \
OWNER_ACCESS_CODE=your-secure-access-code-min-12-chars \
npm --prefix functions run bootstrap:owner
```

### 9. Run Production Smoke Test
Verify the deployed production API endpoints:
```bash
API_BASE_URL=https://your-app.vercel.app npm --prefix functions run smoke:production
```
With authenticated flow verification:
```bash
API_BASE_URL=https://your-app.vercel.app \
SMOKE_USERNAME=admin \
SMOKE_ACCESS_CODE=your-secure-access-code-min-12-chars \
npm --prefix functions run smoke:production
```

### 10. Verify Swagger and OpenAPI Endpoints
Open in your browser:
- Health check: `https://your-app.vercel.app/api/health`
- OpenAPI Specification: `https://your-app.vercel.app/api/openapi.json`
- Swagger UI Documentation: `https://your-app.vercel.app/api/docs`

### 11. Attach Custom Domain (Optional)
In Vercel **Project Settings > Domains**:
- Add your custom API domain (e.g. `api.modula.example`).
- Configure the DNS `CNAME` record as prompted.
- Update `ALLOWED_ORIGINS` and `PUBLIC_API_BASE_URL` in Vercel environment variables.

---

## Canonical Role Model Summary

The production platform enforces four hierarchical roles:
1. `platform_owner`: Global operator superuser across all workspaces.
2. `workspace_admin`: Full administrative control over activities and member assignments in their workspace.
3. `editor`: Can draft, update, and manage activities and question content.
4. `viewer`: Read-only access to activities, questions, and aggregate statistics.

