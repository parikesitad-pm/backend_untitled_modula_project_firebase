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

  it('redirects /api/docs to /api/docs/ with 301', async () => {
    const res = await request(app).get('/api/docs');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/api/docs/');
  });

  it('redirects /docs to /api/docs/ with 301 for local/legacy compatibility', async () => {
    const res = await request(app).get('/docs');
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe('/api/docs/');
  });

  it('serves Swagger UI correctly from /api/docs/ referencing valid asset paths', async () => {
    const res = await request(app).get('/api/docs/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('Swagger UI');
    expect(res.text).toContain('<link rel="stylesheet" type="text/css" href="./swagger-ui.css"');
    expect(res.text).toContain('<script src="./swagger-ui-bundle.js"');
  });

  it('serves Swagger UI static assets correctly from /api/docs/ with appropriate content types', async () => {
    const cssRes = await request(app).get('/api/docs/swagger-ui.css');
    expect(cssRes.status).toBe(200);
    expect(cssRes.headers['content-type']).toContain('text/css');

    const jsBundleRes = await request(app).get('/api/docs/swagger-ui-bundle.js');
    expect(jsBundleRes.status).toBe(200);
    expect(jsBundleRes.headers['content-type']).toContain('application/javascript');

    const jsPresetRes = await request(app).get('/api/docs/swagger-ui-standalone-preset.js');
    expect(jsPresetRes.status).toBe(200);
    expect(jsPresetRes.headers['content-type']).toContain('application/javascript');

    const jsInitRes = await request(app).get('/api/docs/swagger-ui-init.js');
    expect(jsInitRes.status).toBe(200);
    expect(jsInitRes.headers['content-type']).toContain('application/javascript');
  });

  it('serves Swagger UI from /docs/ for local compatibility', async () => {
    const res = await request(app).get('/docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Swagger UI');
  });
});
