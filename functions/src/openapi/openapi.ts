import { OpenApiGeneratorV31 } from '@asteasolutions/zod-to-openapi';
import { registry } from './registry';

// Import all docs registrations
import './docs/auth.docs';
import './docs/operators.docs';
import './docs/activities.docs';
import './docs/questions.docs';
import './docs/participants.docs';
import './docs/attempts.docs';
import './docs/leaderboard.docs';
import './docs/stats.docs';
import './docs/assets.docs';
import './docs/workspaces.docs';
import './docs/live-sessions.docs';
import './docs/system.docs';

export function getOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);

  const servers: Array<{ url: string; description: string }> = [];
  if (process.env.PUBLIC_API_BASE_URL) {
    servers.push({
      url: process.env.PUBLIC_API_BASE_URL,
      description: 'Production API Base URL',
    });
  }
  servers.push(
    {
      url: '',
      description: 'Direct server root (Vercel / Direct Host)',
    },
    {
      url: '/modula-backend-dev/us-central1/api',
      description: 'Firebase Cloud Functions (Local / Emulator)',
    }
  );

  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'MODULA Activity Backend API',
      version: '0.4.0',
      description:
        'Neutral Activity Backend supporting Builder, Participant Area, Realtime Leaderboard, and Stats / Results.',
      contact: {
        name: 'parikesitad-pm',
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT',
      },
    },
    servers,
    tags: [
      { name: 'System', description: 'System health and diagnostic endpoints' },
      { name: 'Auth', description: 'Operator authentication and token issuance' },
      { name: 'Activities', description: 'Activity lifecycle, configuration, and scheduling' },
      { name: 'LiveSessions', description: 'Realtime live play sessions, host lobby, and participant presence' },
      { name: 'Questions', description: 'Builder question and choice authoring' },
      { name: 'Participants', description: 'Participant intake and durable profiles' },
      { name: 'Attempts', description: 'Participant test execution and submission' },
      { name: 'Leaderboard', description: 'Realtime points and speed bonus rankings' },
      { name: 'Stats', description: 'Aggregate metrics, question stats, and pre/post comparison' },
      { name: 'Assets', description: 'Cloudinary asset storage management and signed uploads' },
      { name: 'Workspaces', description: 'Multi-workspace management and isolation' },
      { name: 'Memberships', description: 'Workspace operator membership assignment and roles' },
    ],
  });
}
