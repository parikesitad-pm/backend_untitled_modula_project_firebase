import { Request, Response, NextFunction } from 'express';
import { workspacesService } from './workspaces.service';

export class WorkspacesController {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const items = await workspacesService.list(req.operator!);
      res.json({ success: true, data: items });
    } catch (err) {
      next(err);
    }
  }

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const item = await workspacesService.create(req.body, req.operator!.uid);
      res.status(201).json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const item = await workspacesService.getById(req.params.workspaceId, req.operator!);
      res.json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  }

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const item = await workspacesService.update(req.params.workspaceId, req.body);
      res.json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  }

  async archive(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const item = await workspacesService.archive(req.params.workspaceId);
      res.json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  }

  // Memberships
  async listMembers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const items = await workspacesService.listMembers(req.params.workspaceId);
      res.json({ success: true, data: items });
    } catch (err) {
      next(err);
    }
  }

  async addMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const item = await workspacesService.addMember(req.params.workspaceId, req.body, req.operator!.uid);
      res.status(201).json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  }

  async updateMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const item = await workspacesService.updateMember(req.params.workspaceId, req.params.uid, req.body);
      res.json({ success: true, data: item });
    } catch (err) {
      next(err);
    }
  }

  async removeMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      await workspacesService.removeMember(req.params.workspaceId, req.params.uid);
      res.json({ success: true, message: 'Membership removed' });
    } catch (err) {
      next(err);
    }
  }
}

export const workspacesController = new WorkspacesController();

