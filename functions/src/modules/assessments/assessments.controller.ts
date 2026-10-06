import { Request, Response, NextFunction } from 'express';
import { assessmentsService } from './assessments.service';
import { sendSuccess, sendCreated } from '../../lib/response';
import { UnauthorizedError } from '../../lib/errors';

export class AssessmentsController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.operator) {
        throw new UnauthorizedError('Authentication required');
      }
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const cursor = req.query.cursor as string | undefined;
      const result = await assessmentsService.list(req.operator, limit, cursor);
      sendSuccess(res, result.items, undefined, 200, { limit, nextCursor: result.nextCursor });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.operator) {
        throw new UnauthorizedError('Authentication required');
      }
      const created = await assessmentsService.create(req.body, req.operator);
      sendCreated(res, created, 'Assessment created successfully');
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.operator) {
        throw new UnauthorizedError('Authentication required');
      }
      const item = await assessmentsService.getById(req.params.id, req.operator);
      sendSuccess(res, item);
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.operator) {
        throw new UnauthorizedError('Authentication required');
      }
      const updated = await assessmentsService.update(req.params.id, req.body, req.operator);
      sendSuccess(res, updated, 'Assessment updated successfully');
    } catch (err) {
      next(err);
    }
  }

  async delete(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      if (!req.operator) {
        throw new UnauthorizedError('Authentication required');
      }
      await assessmentsService.delete(req.params.id, req.operator);
      sendSuccess(res, { deleted: true }, 'Assessment deleted successfully');
    } catch (err) {
      next(err);
    }
  }

  async getBySlugPublic(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const publicDto = await assessmentsService.getBySlugPublic(req.params.slug);
      sendSuccess(res, publicDto);
    } catch (err) {
      next(err);
    }
  }
}

export const assessmentsController = new AssessmentsController();

