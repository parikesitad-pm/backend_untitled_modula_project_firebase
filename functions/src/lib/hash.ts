import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const SALT_ROUNDS = 12;

// Pre-computed bcrypt cost 12 dummy hash for constant-time comparison on unknown user
const DUMMY_HASH = '$2a$12$e8YQ3P5K1Y/Yl0jH0G3.2e7qC7J0G2p4.U0gX9K1Z5m7r1t9w4v8a';

export async function hashAccessCode(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

export async function verifyAccessCode(plainText: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plainText, hashed);
}

export async function performDummyVerification(plainText: string): Promise<boolean> {
  return bcrypt.compare(plainText, DUMMY_HASH);
}

export function hashTokenSha256(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateSecureToken(byteLength = 32): string {
  return crypto.randomBytes(byteLength).toString('base64url');
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}
