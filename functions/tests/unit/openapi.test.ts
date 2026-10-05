import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { app } from '../../src/app';
import { getOpenApiDocument } from '../../src/openapi/openapi';

describe('OpenAPI & Swagger Documentation', () => {
  it('generates valid OpenAPI 3.1.0 document with all 11 tags', () => {
    const doc = getOpenApiDocument();
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title).toBe('MODULA Activity Backend API');
    expect(doc.tags?.length).toBe(11);

    const tagNames = doc.tags?.map((t) => t.name);
    expect(tagNames).toContain('System');
    expect(tagNames).toContain('Auth');
    expect(tagNames).toContain('Activities');
    expect(tagNames).toContain('Questions');
    expect(tagNames).toContain('Participants');
    expect(tagNames).toContain('Attempts');
    expect(tagNames).toContain('Leaderboard');
    expect(tagNames).toContain('Stats');
    expect(tagNames).toContain('Assets');
    expect(tagNames).toContain('Workspaces');
    expect(tagNames).toContain('Memberships');
  });

  it('serves OpenAPI JSON at /api/openapi.json and /openapi.json', async () => {
    const res = await request(app).get('/api/openapi.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.body.openapi).toBe('3.1.0');

    const resRoot = await request(app).get('/openapi.json');
    expect(resRoot.status).toBe(200);
  });

  it('serves Swagger UI at /api/docs and /docs', async () => {
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });
});
