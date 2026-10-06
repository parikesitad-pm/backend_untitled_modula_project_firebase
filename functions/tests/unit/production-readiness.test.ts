import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { formatPrivateKey, validateFirebaseProductionEnv } from '../../src/config/firebase';
import { createApp } from '../../src/app';
import vercelApp from '../../api/index';

describe('Production Readiness & Security Tests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('1. Firebase Environment & Key Handling', () => {
    it('correctly replaces escaped newlines in private key', () => {
      const rawKey = '-----BEGIN PRIVATE KEY-----\\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC...\\n-----END PRIVATE KEY-----\\n';
      const formatted = formatPrivateKey(rawKey);

      expect(formatted).not.toContain('\\n');
      expect(formatted).toContain('\n');
      expect(formatted.startsWith('-----BEGIN PRIVATE KEY-----\n')).toBe(true);
      expect(formatted.endsWith('-----END PRIVATE KEY-----\n')).toBe(true);
    });

    it('returns empty string if private key is undefined or empty', () => {
      expect(formatPrivateKey(undefined)).toBe('');
      expect(formatPrivateKey('')).toBe('');
    });

    it('fails fast when required Firebase env vars are missing in production', () => {
      delete process.env.FIREBASE_PROJECT_ID;
      delete process.env.GCLOUD_PROJECT;
      delete process.env.FIREBASE_CLIENT_EMAIL;
      delete process.env.FIREBASE_PRIVATE_KEY;

      expect(() => validateFirebaseProductionEnv()).toThrow(
        /Missing required Firebase production environment variables/
      );
    });

    it('validates and formats credentials when all env vars are present', () => {
      process.env.FIREBASE_PROJECT_ID = 'test-modula-proj';
      process.env.FIREBASE_CLIENT_EMAIL = 'test@example.com';
      process.env.FIREBASE_PRIVATE_KEY = 'line1\\nline2';

      const creds = validateFirebaseProductionEnv();
      expect(creds.projectId).toBe('test-modula-proj');
      expect(creds.clientEmail).toBe('test@example.com');
      expect(creds.privateKey).toBe('line1\nline2');
    });
  });

  describe('2. CORS Origin Enforcement', () => {
    it('allows requests without Origin header (CLI, server-to-server, curl)', async () => {
      process.env.ALLOWED_ORIGINS = 'https://app.example.com';
      process.env.NODE_ENV = 'production';
      delete process.env.FIRESTORE_EMULATOR_HOST;

      const testApp = createApp();
      const res = await request(testApp).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });

    it('allows configured origin in ALLOWED_ORIGINS', async () => {
      process.env.ALLOWED_ORIGINS = 'https://app.example.com,https://admin.example.com';
      process.env.NODE_ENV = 'production';
      delete process.env.FIRESTORE_EMULATOR_HOST;

      const testApp = createApp();
      const res = await request(testApp)
        .get('/api/health')
        .set('Origin', 'https://app.example.com');

      expect(res.status).toBe(200);
      expect(res.headers['access-control-allow-origin']).toBe('https://app.example.com');
    });

    it('rejects unknown browser origin with 403 CORS_FORBIDDEN in production', async () => {
      process.env.ALLOWED_ORIGINS = 'https://app.example.com';
      process.env.NODE_ENV = 'production';
      delete process.env.FIRESTORE_EMULATOR_HOST;

      const testApp = createApp();
      const res = await request(testApp)
        .get('/api/health')
        .set('Origin', 'https://malicious-site.com');

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('CORS_FORBIDDEN');
    });
  });

  describe('3. Clean Routes & Health Endpoint', () => {
    it('serves GET /api/health with clean status and version 0.4.0', async () => {
      const testApp = createApp();
      const res = await request(testApp).get('/api/health');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        status: 'ok',
        service: 'modula-backend',
        version: '0.4.0',
      });
      // Leaks no secrets
      expect(res.body).not.toHaveProperty('stack');
      expect(res.body).not.toHaveProperty('env');
    });

    it('serves GET /health as alias with identical response', async () => {
      const testApp = createApp();
      const res = await request(testApp).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.version).toBe('0.4.0');
    });

    it('serves OpenAPI 3.1 document at /api/openapi.json and /openapi.json', async () => {
      const testApp = createApp();
      const res = await request(testApp).get('/api/openapi.json');

      expect(res.status).toBe(200);
      expect(res.body.openapi).toBe('3.1.0');
      expect(res.body.info.title).toBe('MODULA Activity Backend API');
      expect(res.body.info.version).toBe('0.4.0');
      expect(res.body.paths).toHaveProperty('/api/health');
    });

    it('redirects /api/docs to /api/docs/ and serves Swagger UI', async () => {
      const testApp = createApp();
      const redirectRes = await request(testApp).get('/api/docs');
      expect(redirectRes.status).toBe(301);
      expect(redirectRes.headers.location).toBe('/api/docs/');

      const res = await request(testApp).get('/api/docs/');
      expect(res.status).toBe(200);
      expect(res.text).toContain('Swagger UI');
    });
  });

  describe('4. Vercel Adapter Integration', () => {
    it('vercel default export is the Express application', async () => {
      expect(vercelApp).toBeDefined();
      expect(typeof vercelApp).toBe('function'); // Express app is a callable request listener

      const res = await request(vercelApp).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.version).toBe('0.4.0');
    });

    it('does not produce duplicate /api/api routes', async () => {
      const res = await request(vercelApp).get('/api/api/health');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    });
  });

  describe('5. Zero Secrets Leakage in Common Error Responses', () => {
    it('returns generic error for 404 without leaking server internals', async () => {
      const testApp = createApp();
      const res = await request(testApp).get('/api/nonexistent-route');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
      expect(JSON.stringify(res.body)).not.toContain('password');
      expect(JSON.stringify(res.body)).not.toContain('secret');
      expect(JSON.stringify(res.body)).not.toContain('stack');
    });
  });
});

