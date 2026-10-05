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

export function getOpenApiDocument() {
  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'MODULA Activity Backend API',
      version: '0.2.0',
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
    servers: [
      {
        url: '/modula-backend-dev/us-central1/api',
        description: 'Firebase Cloud Functions (Local / Emulator)',
      },
      {
        url: '',
        description: 'Direct server root',
      },
    ],
    tags: [
      { name: 'Auth', description: 'Operator authentication and token issuance' },
      { name: 'Activities', description: 'Activity lifecycle, configuration, and scheduling' },
      { name: 'Questions', description: 'Builder question and choice authoring' },
      { name: 'Participants', description: 'Participant intake and durable profiles' },
      { name: 'Attempts', description: 'Participant test execution and submission' },
      { name: 'Leaderboard', description: 'Realtime points and speed bonus rankings' },
      { name: 'Stats', description: 'Aggregate metrics, question stats, and pre/post comparison' },
      { name: 'Assets', description: 'Cloudinary asset storage management and signed uploads' },
    ],
  });
}
