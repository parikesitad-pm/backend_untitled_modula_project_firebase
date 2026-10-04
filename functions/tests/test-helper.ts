import { db, auth } from '../src/config/firebase';
import { hashAccessCode } from '../src/lib/hash';

export interface TestAuthTokens {
  crownToken: string;
  ownerToken: string;
  managerToken: string;
  operatorToken: string;
}

export async function seedTestOperators(): Promise<TestAuthTokens> {
  await clearCollection('loginAttempts');
  const now = new Date().toISOString();

  // Seed Crown
  const crownHash = await hashAccessCode('crown-secret-2026');
  await db.collection('operators').doc('test-crown-uid').set({
    uid: 'test-crown-uid',
    username: 'crown',
    usernameNormalized: 'crown',
    accessCodeHash: crownHash,
    role: 'crown',
    active: true,
    createdAt: now,
    updatedAt: now,
  });

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

  // Seed Manager
  const managerHash = await hashAccessCode('manager-secret-2026');
  await db.collection('operators').doc('test-mgr-uid').set({
    uid: 'test-mgr-uid',
    username: 'manager',
    usernameNormalized: 'manager',
    accessCodeHash: managerHash,
    role: 'manager',
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

  const crownToken = await auth.createCustomToken('test-crown-uid', { role: 'crown' });
  const ownerToken = await auth.createCustomToken('test-owner-uid', { role: 'owner' });
  const managerToken = await auth.createCustomToken('test-mgr-uid', { role: 'manager' });
  const operatorToken = await auth.createCustomToken('test-op-uid', { role: 'operator' });

  return { crownToken, ownerToken, managerToken, operatorToken };
}

export async function clearCollection(name: string): Promise<void> {
  const snap = await db.collection(name).get();
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}
