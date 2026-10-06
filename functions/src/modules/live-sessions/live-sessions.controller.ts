import { Request, Response, NextFunction } from 'express';
import { liveSessionsService } from './live-sessions.service';
import { sendSuccess, sendCreated } from '../../lib/response';

export class LiveSessionsController {
  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = await liveSessionsService.create(req.body, req.operator!);
      sendCreated(res, { session }, 'Live session created successfully');
    } catch (err) {
      next(err);
    }
  }

  async getById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = await liveSessionsService.getById(req.params.id);
      sendSuccess(res, { session });
    } catch (err) {
      next(err);
    }
  }

  async start(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = await liveSessionsService.start(req.params.id, req.operator);
      sendSuccess(res, { session }, 'Live session started successfully');
    } catch (err) {
      next(err);
    }
  }

  async setQuestionIndex(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = await liveSessionsService.setQuestionIndex(
        req.params.id,
        req.body.questionIndex,
        req.operator
      );
      sendSuccess(res, { session });
    } catch (err) {
      next(err);
    }
  }

  async nextQuestion(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = await liveSessionsService.nextQuestion(req.params.id, req.operator);
      sendSuccess(res, { session });
    } catch (err) {
      next(err);
    }
  }

  async end(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = await liveSessionsService.end(req.params.id, req.operator);
      sendSuccess(res, { session }, 'Live session ended successfully');
    } catch (err) {
      next(err);
    }
  }

  async listParticipants(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const participants = await liveSessionsService.listParticipants(req.params.id);
      sendSuccess(res, { participants, total: participants.length });
    } catch (err) {
      next(err);
    }
  }

  // Public methods
  async getPublicSession(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      let session;
      if (req.params.id.length === 6 && /^\d+$/.test(req.params.id)) {
        session = await liveSessionsService.getByPin(req.params.id);
      } else {
        session = await liveSessionsService.getById(req.params.id);
      }

      const safeSession = {
        id: session.id,
        activityId: session.activityId,
        assessmentId: session.assessmentId,
        pin: session.pin,
        status: session.status,
        startedAt: session.startedAt,
        expiresAt: session.expiresAt,
        currentQuestionIndex: session.currentQuestionIndex,
        timeLimitEnabled: session.timeLimitEnabled,
        activityTimeLimitSeconds: session.activityTimeLimitSeconds,
      };

      sendSuccess(res, { session: safeSession });
    } catch (err) {
      next(err);
    }
  }

  async join(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const participant = await liveSessionsService.joinParticipant(req.params.id, req.body);
      sendCreated(res, { participant }, 'Joined live session lobby');
    } catch (err) {
      next(err);
    }
  }

  async heartbeat(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await liveSessionsService.heartbeatParticipant(req.params.id, req.body);
      sendSuccess(res, result);
    } catch (err) {
      next(err);
    }
  }
}

export const liveSessionsController = new LiveSessionsController();

