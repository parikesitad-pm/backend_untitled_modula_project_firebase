import { Request, Response, NextFunction } from 'express';
import { operatorsService } from './operators.service';
import { sendSuccess, sendCreated } from '../../lib/response';

export class OperatorsController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const cursor = req.query.cursor as string | undefined;
      const result = await operatorsService.list(limit, cursor);
      sendSuccess(res, result.items, undefined, 200, result.meta);
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await operatorsService.create(req.operator!, req.body);
      sendCreated(res, result, 'Operator created successfully');
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await operatorsService.update(req.operator!, req.params.uid, req.body);
      sendSuccess(res, result, 'Operator updated successfully');
    } catch (err) {
      next(err);
    }
  }

  async deactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await operatorsService.update(req.operator!, req.params.uid, { active: false });
      sendSuccess(res, result, 'Operator deactivated successfully');
    } catch (err) {
      next(err);
    }
  }

  async reactivate(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await operatorsService.update(req.operator!, req.params.uid, { active: true });
      sendSuccess(res, result, 'Operator reactivated successfully');
    } catch (err) {
      next(err);
    }
  }
}

export const operatorsController = new OperatorsController();
