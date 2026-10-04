import { Request, Response, NextFunction } from 'express';
import { questionsService } from './questions.service';
import { sendSuccess, sendCreated } from '../../lib/response';

export class QuestionsController {
  async getByActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const items = await questionsService.getByActivityId(req.params.id, false);
      sendSuccess(res, items);
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const created = await questionsService.create(req.params.id, req.body);
      sendCreated(res, created, 'Question created successfully');
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const updated = await questionsService.update(req.params.id, req.body);
      sendSuccess(res, updated, 'Question updated successfully');
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await questionsService.delete(req.params.id);
      sendSuccess(res, { deleted: true }, 'Question deleted successfully');
    } catch (err) {
      next(err);
    }
  }

  async reorder(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await questionsService.reorder(req.body);
      sendSuccess(res, { reordered: true }, 'Questions reordered successfully');
    } catch (err) {
      next(err);
    }
  }
}

export const questionsController = new QuestionsController();
