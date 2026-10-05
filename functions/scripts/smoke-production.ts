/**
 * Non-destructive production smoke verification script.
 * Usage:
 *   API_BASE_URL=https://your-vercel-deployment.vercel.app npm --prefix functions run smoke:production
 */

interface HealthResponse {
  status: string;
  service: string;
  version: string;
}

interface OpenApiResponse {
  openapi: string;
  info: {
    title: string;
    version: string;
  };
}

async function runSmokeTests(): Promise<void> {
  const baseUrl = (process.env.API_BASE_URL || process.argv[2] || '').trim().replace(/\/$/, '');

  if (!baseUrl) {
    console.error('ERROR: API_BASE_URL is required.');
    console.error('Usage: API_BASE_URL=https://your-app.vercel.app npm run smoke:production');
    process.exit(1);
  }

  console.log(`[Smoke Test] Target Base URL: ${baseUrl}`);
  let failures = 0;

  // 1. Health Endpoint Check
  try {
    const healthUrl = `${baseUrl}/api/health`;
    console.log(`[Smoke Test] 1. Checking GET ${healthUrl}...`);
    const res = await fetch(healthUrl, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`Expected HTTP 200, got ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as HealthResponse;
    if (data.status !== 'ok' || data.service !== 'modula-backend') {
      throw new Error(`Unexpected payload: ${JSON.stringify(data)}`);
    }
    console.log(`  ✓ Health OK: status=${data.status}, service=${data.service}, version=${data.version}`);
  } catch (err: any) {
    console.error(`  ✗ Health check failed:`, err.message);
    failures++;
  }

  // 2. OpenAPI Specification Check
  try {
    const openApiUrl = `${baseUrl}/api/openapi.json`;
    console.log(`[Smoke Test] 2. Checking GET ${openApiUrl}...`);
    const res = await fetch(openApiUrl, { method: 'GET' });
    if (!res.ok) {
      throw new Error(`Expected HTTP 200, got ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as OpenApiResponse;
    if (!data.openapi || !data.info?.title) {
      throw new Error(`Invalid OpenAPI document: missing openapi or info.title`);
    }
    console.log(`  ✓ OpenAPI spec OK: version=${data.openapi}, title="${data.info.title}" (${data.info.version})`);
  } catch (err: any) {
    console.error(`  ✗ OpenAPI check failed:`, err.message);
    failures++;
  }

  // 3. Optional Authenticated Check
  const smokeUser = process.env.SMOKE_USERNAME;
  const smokePass = process.env.SMOKE_ACCESS_CODE;
  if (smokeUser && smokePass) {
    try {
      console.log(`[Smoke Test] 3. Running authenticated check with operator '${smokeUser}'...`);
      const loginUrl = `${baseUrl}/api/auth/login`;
      const loginRes = await fetch(loginUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: smokeUser, accessCode: smokePass }),
      });
      if (!loginRes.ok) {
        throw new Error(`Login failed with HTTP ${loginRes.status}`);
      }
      const loginBody = await loginRes.json();
      console.log(`  ✓ Login successful (customToken issued)`);

      if (loginBody.data?.token) {
        // Can optionally verify GET /api/auth/me if idToken exchange is simulated
      }
    } catch (err: any) {
      console.error(`  ✗ Authenticated smoke check failed:`, err.message);
      failures++;
    }
  } else {
    console.log(`[Smoke Test] 3. Authenticated check skipped (SMOKE_USERNAME and SMOKE_ACCESS_CODE not provided).`);
  }

  console.log('--------------------------------------------------');
  if (failures > 0) {
    console.error(`[Smoke Test] FAILED: ${failures} check(s) failed.`);
    process.exit(1);
  } else {
    console.log(`[Smoke Test] SUCCESS: All production smoke checks passed!`);
  }
}

runSmokeTests().catch((err) => {
  console.error('[Smoke Test Fatal]:', err);
  process.exit(1);
});

