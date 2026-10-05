import { auth, db } from '../src/config/firebase';
import { hashAccessCode } from '../src/lib/hash';

async function bootstrapOwner(): Promise<void> {
  const isProd =
    process.env.NODE_ENV === 'production' ||
    (!process.env.FIRESTORE_EMULATOR_HOST && process.env.NODE_ENV !== 'test');

  const username = process.env.OWNER_USERNAME || (isProd ? '' : 'owner');
  const accessCode = process.env.OWNER_ACCESS_CODE || (isProd ? '' : 'owner-access-code-2026');

  if (!username || !accessCode) {
    throw new Error(
      'OWNER_USERNAME and OWNER_ACCESS_CODE environment variables are strictly required to bootstrap platform owner in production.'
    );
  }

  if (accessCode.length < 12) {
    throw new Error('OWNER_ACCESS_CODE must be at least 12 characters long.');
  }

  const role = 'owner';
  const platformRole = 'platform_owner';
  const email = `${username.trim().toLowerCase()}@modula.local`;
  const normalized = username.trim().toLowerCase();

  console.log(`[Bootstrap] Bootstrapping first platform_owner: '${normalized}'...`);

  // 1. Resolve or create Firebase Auth user
  let uid = '';
  try {
    const existingUser = await auth.getUserByEmail(email);
    uid = existingUser.uid;
    console.log(`[Bootstrap] Found existing Firebase Auth user: ${uid}`);
  } catch (_e) {
    const newUser = await auth.createUser({
      email,
      displayName: normalized,
    });
    uid = newUser.uid;
    console.log(`[Bootstrap] Created new Firebase Auth user: ${uid}`);
  }

  // 2. Check if already active platform owner (prevent downgrade or accidental overwrite)
  const existingDoc = await db.collection('operators').doc(uid).get();
  if (existingDoc.exists) {
    const existingData = existingDoc.data();
    if (
      existingData?.active &&
      (existingData?.platformRole === 'platform_owner' || existingData?.role === 'owner' || existingData?.role === 'crown')
    ) {
      console.log(`[Bootstrap] Operator '${normalized}' is already an active platform_owner. Preserving existing record.`);
      return;
    }
  }

  // 3. Set Custom User Claims for UI convenience
  await auth.setCustomUserClaims(uid, { role, platformRole });

  // 4. Save live record in Firestore operators collection
  const accessCodeHash = await hashAccessCode(accessCode);
  const now = new Date().toISOString();

  await db.collection('operators').doc(uid).set(
    {
      uid,
      username: normalized,
      usernameNormalized: normalized,
      accessCodeHash,
      role,
      platformRole,
      active: true,
      createdAt: existingDoc.exists ? existingDoc.data()?.createdAt : now,
      updatedAt: now,
    },
    { merge: true }
  );

  // 5. Ensure internal workspace exists and add workspace_admin membership
  const wsRef = db.collection('workspaces').doc('internal');
  const wsDoc = await wsRef.get();
  if (!wsDoc.exists) {
    await wsRef.set({
      id: 'internal',
      name: 'Internal',
      slug: 'internal',
      status: 'active',
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`[Bootstrap] Created default 'internal' workspace`);
  }

  const memId = `internal_${uid}`;
  await db.collection('memberships').doc(memId).set(
    {
      id: memId,
      workspaceId: 'internal',
      uid,
      username: normalized,
      role: 'workspace_admin',
      active: true,
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  console.log(`[Bootstrap] Platform owner operator record saved to Firestore with UID: ${uid}`);
  console.log(`[Bootstrap] Username: ${normalized}`);
  console.log(`[Bootstrap] Platform Role: ${platformRole}`);
  console.log(`[Bootstrap] Legacy Role: ${role}`);
  console.log(`[Bootstrap] Status: active`);
  console.log(`[Bootstrap] Done!`);
}

bootstrapOwner()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Bootstrap Error]:', err.message || err);
    process.exit(1);
  });
