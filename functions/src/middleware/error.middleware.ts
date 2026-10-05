import { Request, Response, NextFunction } from 'express';
import { AppError } from '../lib/errors';
import { sendError } from '../lib/response';

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    const details = err.details as Record<string, any> | undefined;
    if (err.statusCode === 429 && details?.retryAfter) {
      res.setHeader('Retry-After', String(details.retryAfter));
    }
    sendError(res, err.statusCode, err.code, err.message, err.details);
    return;
  }

  if (err.message && err.message.startsWith('CORS origin not allowed')) {
    sendError(res, 403, 'CORS_FORBIDDEN', 'Origin not allowed by CORS');
    return;
  }

  if (process.env.NODE_ENV !== 'production') {
    console.error('[Unhandled Error]:', err);
  } else {
    console.error('[Unhandled Error]:', err.message || 'Internal server error');
  }
  sendError(
    res,
    500,
    'INTERNAL_SERVER_ERROR',
    'An unexpected error occurred. Please try again later.'
  );
}

export function notFoundHandler(req: Request, res: Response): void {
  sendError(
    res,
    404,
    'ROUTE_NOT_FOUND',
    `Cannot ${req.method} ${req.originalUrl}`
  );
}
