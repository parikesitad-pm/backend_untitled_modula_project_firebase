import { Request, Response, NextFunction } from 'express';
import { attemptsService } from './attempts.service';
import { sendSuccess } from '../../lib/response';
import { extractBearerToken, verifyTokenString } from '../../middleware/auth.middleware';

export class AttemptsController {
  private getAttemptToken(req: Request): string | undefined {
    return (req.headers['x-attempt-token'] || req.headers['X-Attempt-Token']) as string | undefined;
  }

  async submitAnswer(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = this.getAttemptToken(req);
      const result = await attemptsService.submitAnswer(req.params.attemptId, req.body, token);
      sendSuccess(res, result, 'Answer recorded successfully');
    } catch (err) {
      next(err);
    }
  }

  async finish(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = this.getAttemptToken(req);
      const result = await attemptsService.finishAttempt(req.params.attemptId, token);
      sendSuccess(res, result, 'Attempt completed successfully');
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = this.getAttemptToken(req);
      let isOperator = false;
      if (req.headers.authorization) {
        try {
          const bearer = extractBearerToken(req);
          await verifyTokenString(bearer);
          isOperator = true;
        } catch (_e) {
          // ignore
        }
      }
      const attempt = await attemptsService.getById(req.params.attemptId, token, isOperator);
      sendSuccess(res, attempt);
    } catch (err) {
      next(err);
    }
  }

  async enterQuestion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const token = this.getAttemptToken(req);
      const result = await attemptsService.enterQuestion(req.params.attemptId, req.params.questionId, token);
      sendSuccess(res, result, 'Question revealed successfully');
    } catch (err) {
      next(err);
    }
  }
}

export const attemptsController = new AttemptsController();
