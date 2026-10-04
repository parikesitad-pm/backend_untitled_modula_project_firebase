import { Request, Response, NextFunction } from 'express';
import { activitiesService } from './activities.service';
import { sendSuccess, sendCreated } from '../../lib/response';

export class ActivitiesController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const items = await activitiesService.list(req.query as any);
      sendSuccess(res, items);
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const creatorUid = req.operator?.uid || 'system';
      const created = await activitiesService.create(req.body, creatorUid);
      sendCreated(res, created, 'Activity created successfully');
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const item = await activitiesService.getById(req.params.id);
      sendSuccess(res, item);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const updated = await activitiesService.update(req.params.id, req.body);
      sendSuccess(res, updated, 'Activity updated successfully');
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await activitiesService.delete(req.params.id);
      sendSuccess(res, { deleted: true }, 'Activity deleted successfully');
    } catch (err) {
      next(err);
    }
  }

  async publish(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const published = await activitiesService.publish(req.params.id);
      sendSuccess(res, published, 'Activity published successfully');
    } catch (err) {
      next(err);
    }
  }

  async close(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const closed = await activitiesService.close(req.params.id);
      sendSuccess(res, closed, 'Activity closed successfully');
    } catch (err) {
      next(err);
    }
  }
}

export const activitiesController = new ActivitiesController();
