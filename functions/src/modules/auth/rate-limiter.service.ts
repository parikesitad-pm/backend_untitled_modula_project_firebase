import { db } from '../../config/firebase';
import { AppError } from '../../lib/errors';
import { getClock } from '../../lib/clock';

const MAX_FAILURES = parseInt(process.env.LOGIN_MAX_FAILURES || '5', 10);
const WINDOW_MS = parseInt(process.env.LOGIN_WINDOW_SECONDS || '900', 10) * 1000; // 15 mins

export class RateLimiterService {
  private col = db.collection('loginAttempts');

  async checkRateLimit(key: string): Promise<void> {
    const doc = await this.col.doc(key).get();
    if (!doc.exists) return;

    const data = doc.data();
    if (!data) return;

    const now = getClock().now().getTime();
    if (data.attempts >= MAX_FAILURES && now < data.expiresAt) {
      const retryAfter = Math.max(1, Math.ceil((data.expiresAt - now) / 1000));
      throw new AppError(
        'Too many failed login attempts. Please try again later.',
        429,
        'RATE_LIMITED',
        { retryAfter }
      );
    }
  }

  async recordFailure(key: string): Promise<void> {
    const docRef = this.col.doc(key);
    await db.runTransaction(async (t) => {
      const doc = await t.get(docRef);
      const now = getClock().now().getTime();

      if (!doc.exists || now >= (doc.data()?.expiresAt || 0)) {
        t.set(docRef, {
          attempts: 1,
          firstAttemptAt: now,
          expiresAt: now + WINDOW_MS,
        });
        return;
      }

      const currentAttempts = doc.data()?.attempts || 0;
      t.set(
        docRef,
        {
          attempts: currentAttempts + 1,
        },
        { merge: true }
      );
    });
  }

  async reset(key: string): Promise<void> {
    try {
      await this.col.doc(key).delete();
    } catch (_e) {
      // ignore deletion errors
    }
  }
}

export const rateLimiterService = new RateLimiterService();
