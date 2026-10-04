import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

export async function hashAccessCode(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

export async function verifyAccessCode(plainText: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plainText, hashed);
}
