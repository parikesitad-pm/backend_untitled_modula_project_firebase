import { z } from 'zod';
import { registry, jsonResponse, ErrorResponseSchema } from '../registry';
import { LeaderboardResponseSchema } from '../../modules/leaderboard/leaderboard.schema';

registry.registerPath({
  method: 'get',
  path: '/api/leaderboards/{slug}',
  tags: ['Leaderboard'],
  summary: 'Realtime leaderboard with Top 5 highlighted and compact list',
  description: 'Can be viewed by participants unless hidden by organizer. Organizers can always view.',
  request: {
    params: z.object({ slug: z.string() }),
  },
  responses: {
    200: jsonResponse(
      z.object({ success: z.literal(true), data: LeaderboardResponseSchema }),
      'Leaderboard rankings'
    ),
    403: jsonResponse(ErrorResponseSchema, 'Leaderboard hidden by organizer'),
    404: jsonResponse(ErrorResponseSchema, 'Activity not found'),
  },
});
