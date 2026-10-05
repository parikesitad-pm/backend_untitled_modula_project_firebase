import { Request, Response, NextFunction } from 'express';
import { assetsService } from './assets.service';
import { sendSuccess } from '../../lib/response';

export class AssetsController {
  async createUploadIntent(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await assetsService.createUploadIntent(req.operator!, req.body);
      sendSuccess(res, result, 'Upload intent generated successfully');
    } catch (err) {
      next(err);
    }
  }

  async confirmAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await assetsService.confirmAsset(req.operator!, req.body);
      sendSuccess(res, result, 'Asset confirmed successfully');
    } catch (err) {
      next(err);
    }
  }
}

export const assetsController = new AssetsController();
