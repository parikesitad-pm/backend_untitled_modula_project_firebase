import { Response } from 'express';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  meta?: {
    limit: number;
    nextCursor: string | null;
    [key: string]: unknown;
  };
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  message?: string,
  statusCode = 200,
  meta?: { limit: number; nextCursor: string | null; [key: string]: unknown }
): Response {
  const body: ApiResponse<T> = { success: true, data };
  if (message) {
    body.message = message;
  }
  if (meta) {
    body.meta = meta;
  }
  return res.status(statusCode).json(body);
}

export function sendCreated<T>(res: Response, data: T, message = 'Created successfully'): Response {
  return sendSuccess(res, data, message, 201);
}

export function sendError(
  res: Response,
  statusCode: number,
  code: string,
  message: string,
  details?: unknown
): Response {
  const body: ApiResponse = {
    success: false,
    error: { code, message, details },
  };
  return res.status(statusCode).json(body);
}
