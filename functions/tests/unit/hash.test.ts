import { describe, it, expect } from 'vitest';
import { hashAccessCode, verifyAccessCode } from '../../src/lib/hash';

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
});
