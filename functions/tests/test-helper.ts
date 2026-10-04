import { db, auth } from '../src/config/firebase';
import { hashAccessCode } from '../src/lib/hash';

export interface TestAuthTokens {
  ownerToken: string;
  operatorToken: string;
}

export async function seedTestOperators(): Promise<TestAuthTokens> {
  const now = new Date().toISOString();

  // Seed Owner
  const ownerHash = await hashAccessCode('owner-secret-2026');
  await db.collection('operators').doc('test-owner-uid').set({
    uid: 'test-owner-uid',
    username: 'owner',
    usernameNormalized: 'owner',
    accessCodeHash: ownerHash,
    role: 'owner',
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  // Seed Operator
  const opHash = await hashAccessCode('operator-secret-2026');
  await db.collection('operators').doc('test-op-uid').set({
    uid: 'test-op-uid',
    username: 'opuser',
    usernameNormalized: 'opuser',
    accessCodeHash: opHash,
    role: 'operator',
    active: true,
    createdAt: now,
    updatedAt: now,
  });

  const ownerToken = await auth.createCustomToken('test-owner-uid', { role: 'owner' });
  const operatorToken = await auth.createCustomToken('test-op-uid', { role: 'operator' });

  return { ownerToken, operatorToken };
}

export async function clearCollection(name: string): Promise<void> {
  const snap = await db.collection(name).get();
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}
