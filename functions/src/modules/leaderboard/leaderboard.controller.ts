import { Request, Response, NextFunction } from 'express';
import { leaderboardService } from './leaderboard.service';
import { sendSuccess } from '../../lib/response';
import { extractBearerToken, verifyTokenString } from '../../middleware/auth.middleware';

export class LeaderboardController {
  async getBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let operator = req.operator;
      if (!operator && req.headers.authorization) {
        try {
          const token = extractBearerToken(req);
          operator = await verifyTokenString(token);
        } catch (_e) {
          // ignore unauthenticated participant
        }
      }

      const result = await leaderboardService.getLeaderboard(req.params.slug, operator);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
}

export const leaderboardController = new LeaderboardController();
