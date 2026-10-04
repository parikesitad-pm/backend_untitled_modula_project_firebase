import { Request, Response, NextFunction } from 'express';
import { authService } from './auth.service';
import { sendSuccess } from '../../lib/response';
import { UnauthorizedError } from '../../lib/errors';

export class AuthController {
  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const forwarded = req.headers['x-forwarded-for'];
      const clientIp =
        (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : undefined) ||
        req.ip ||
        req.socket.remoteAddress ||
        '127.0.0.1';
      const result = await authService.login(req.body, clientIp);
      sendSuccess(res, result, 'Login successful');
    } catch (err) {
      next(err);
    }
  }

  async getMe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.operator) {
        throw new UnauthorizedError('Authentication required');
      }
      const operator = await authService.getMe(req.operator.uid);
      sendSuccess(res, operator);
    } catch (err) {
      next(err);
    }
  }
}

export const authController = new AuthController();
