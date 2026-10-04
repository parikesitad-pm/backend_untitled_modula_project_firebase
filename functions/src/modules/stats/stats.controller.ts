import { Request, Response, NextFunction } from 'express';
import { statsService } from './stats.service';
import { sendSuccess } from '../../lib/response';

export class StatsController {
  async getActivityStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const stats = await statsService.getActivityStats(req.params.id);
      sendSuccess(res, stats);
    } catch (err) {
      next(err);
    }
  }

  async getParticipants(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const participants = await statsService.getActivityParticipants(req.params.id);
      sendSuccess(res, participants);
    } catch (err) {
      next(err);
    }
  }

  async getResponses(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const responses = await statsService.getActivityResponses(req.params.id);
      sendSuccess(res, responses);
    } catch (err) {
      next(err);
    }
  }

  async getQuestionStats(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const questionStats = await statsService.getQuestionStats(req.params.id);
      sendSuccess(res, questionStats);
    } catch (err) {
      next(err);
    }
  }

  async getGroupComparison(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const comparison = await statsService.getGroupComparison(req.params.groupId);
      sendSuccess(res, comparison);
    } catch (err) {
      next(err);
    }
  }
}

export const statsController = new StatsController();
