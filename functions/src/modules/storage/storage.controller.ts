import { Request, Response, NextFunction } from 'express';
import { storageService } from './storage.service';
import { sendSuccess } from '../../lib/response';

export class StorageController {
  async requestUploadUrl(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await storageService.getUploadUrl(req.body);
      sendSuccess(res, result, 'Upload URL generated successfully');
    } catch (err) {
      next(err);
    }
  }
}

export const storageController = new StorageController();
