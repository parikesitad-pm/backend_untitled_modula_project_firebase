import { Request, Response, NextFunction } from 'express';
import { activitiesService } from '../activities/activities.service';
import { questionsService } from '../questions/questions.service';
import { attemptsService } from '../attempts/attempts.service';
import { sendSuccess, sendCreated } from '../../lib/response';
import { BadRequestError } from '../../lib/errors';
import { getClock } from '../../lib/clock';

export class PublicController {
  async getActivity(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const activity = await activitiesService.getBySlug(req.params.slug);
      if (activity.status !== 'published') {
        throw new BadRequestError('Activity is not published', 'ACTIVITY_NOT_PUBLISHED');
      }

      const now = getClock().now().getTime();
      const opens = new Date(activity.opensAt).getTime();
      const closes = new Date(activity.closesAt).getTime();

      if (now < opens) {
        throw new BadRequestError('Activity has not opened yet', 'ACTIVITY_NOT_STARTED');
      }
      if (now > closes) {
        throw new BadRequestError('Activity has closed', 'ACTIVITY_CLOSED');
      }

      const questions = await questionsService.getByActivityId(activity.id, false);
      const questionCount = questions.length;

      const { id, title, description, mode, slug, phase, groupId, opensAt, closesAt, participantFields, settings } = activity;
      const safeActivity = {
        id,
        title,
        description,
        mode,
        slug,
        phase: phase || 'standalone',
        groupId: groupId || null,
        opensAt,
        closesAt,
        participantFields: participantFields || {},
        settings: {
          appearance: settings?.appearance,
          music: settings?.music,
          hideLeaderboardFromParticipants: !!settings?.hideLeaderboardFromParticipants,
          maxAttempts: settings?.maxAttempts ?? 1,
        },
      };

      sendSuccess(res, { activity: safeActivity, questionCount });
    } catch (err) {
      next(err);
    }
  }

  async startAttempt(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = await attemptsService.startAttempt(req.params.slug, req.body);
      sendCreated(res, result, 'Attempt started successfully');
    } catch (err) {
      next(err);
    }
  }
}

export const publicController = new PublicController();
