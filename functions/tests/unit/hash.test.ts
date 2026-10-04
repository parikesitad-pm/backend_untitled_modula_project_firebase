import { describe, it, expect } from 'vitest';
import {
  hashAccessCode,
  verifyAccessCode,
  hashTokenSha256,
  generateSecureToken,
  timingSafeEqualString,
  performDummyVerification,
} from '../../src/lib/hash';

describe('Hash Module', () => {
  it('hashes an access code and verifies correctly', async () => {
    const raw = 'secret-access-code-123';
    const hashed = await hashAccessCode(raw);

    expect(hashed).toBeDefined();
    expect(hashed).not.toBe(raw);

    const isMatch = await verifyAccessCode(raw, hashed);
    expect(isMatch).toBe(true);

    const isMismatch = await verifyAccessCode('wrong-code', hashed);
    expect(isMismatch).toBe(false);
  });

  it('generates secure 32-byte url-safe token and sha256 hashes correctly', () => {
    const token = generateSecureToken();
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThanOrEqual(32);

    const hash1 = hashTokenSha256(token);
    const hash2 = hashTokenSha256(token);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(token);
  });

  it('performs timing-safe string comparison', () => {
    expect(timingSafeEqualString('abc123xyz', 'abc123xyz')).toBe(true);
    expect(timingSafeEqualString('abc123xyz', 'abc123xyw')).toBe(false);
    expect(timingSafeEqualString('short', 'longer-string')).toBe(false);
  });

  it('performs dummy verification against constant pre-computed hash', async () => {
    const result = await performDummyVerification('any-user-input-access-code');
    expect(result).toBe(false);
  });
});
