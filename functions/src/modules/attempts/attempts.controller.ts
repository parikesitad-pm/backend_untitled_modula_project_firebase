import { Request, Response, NextFunction } from 'express';
import { attemptsService } from './attempts.service';
import { sendSuccess } from '../../lib/response';

export class AttemptsController {
  async submitAnswer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await attemptsService.submitAnswer(req.params.attemptId, req.body);
      sendSuccess(res, result, 'Answer recorded successfully');
    } catch (err) {
      next(err);
    }
  }

  async finish(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await attemptsService.finishAttempt(req.params.attemptId);
      sendSuccess(res, result, 'Attempt completed successfully');
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const attempt = await attemptsService.getById(req.params.attemptId);
      sendSuccess(res, attempt);
    } catch (err) {
      next(err);
    }
  }
}

export const attemptsController = new AttemptsController();
