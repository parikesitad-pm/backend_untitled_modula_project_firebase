import cors from 'cors';

export function getCorsOptions(): cors.CorsOptions {
  const rawOrigins = process.env.ALLOWED_ORIGINS || '';
  const configuredOrigins = rawOrigins
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const isProduction =
    process.env.NODE_ENV === 'production' &&
    !process.env.FIRESTORE_EMULATOR_HOST;

  return {
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      // 1. Requests with no origin (e.g. mobile apps, curl, server-to-server, smoke scripts)
      if (!origin) {
        return callback(null, true);
      }

      // 2. In non-production, permit localhost and 127.0.0.1 origins
      if (!isProduction) {
        if (
          origin.startsWith('http://localhost:') ||
          origin.startsWith('http://127.0.0.1:') ||
          origin === 'http://localhost' ||
          origin === 'http://127.0.0.1'
        ) {
          return callback(null, true);
        }
        // If no explicit ALLOWED_ORIGINS configured in dev/test, permit all for developer convenience
        if (configuredOrigins.length === 0) {
          return callback(null, true);
        }
      }

      // 3. Match against configured allowed origins
      if (configuredOrigins.includes(origin)) {
        return callback(null, true);
      }

      // 4. Reject unauthorized origin
      return callback(new Error(`CORS origin not allowed: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Attempt-Token'],
  };
}

export function corsMiddleware() {
  const options = getCorsOptions();
  return cors(options);
}

