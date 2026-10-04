import { auth, db } from '../src/config/firebase';
import { hashAccessCode } from '../src/lib/hash';

async function bootstrapOwner(): Promise<void> {
  const username = process.env.OWNER_USERNAME || 'owner';
  const accessCode = process.env.OWNER_ACCESS_CODE || 'owner-access-code-2026';
  const role = 'owner';
  const email = `${username}@modula.local`;
  const normalized = username.trim().toLowerCase();

  console.log(`[Bootstrap] Bootstrapping first owner: '${username}'...`);

  let uid = '';
  try {
    const existingUser = await auth.getUserByEmail(email);
    uid = existingUser.uid;
    console.log(`[Bootstrap] Found existing Firebase Auth user: ${uid}`);
  } catch (_e) {
    const newUser = await auth.createUser({
      email,
      displayName: username,
    });
    uid = newUser.uid;
    console.log(`[Bootstrap] Created new Firebase Auth user: ${uid}`);
  }

  await auth.setCustomUserClaims(uid, { role });

  const accessCodeHash = await hashAccessCode(accessCode);
  const now = new Date().toISOString();

  await db.collection('operators').doc(uid).set(
    {
      uid,
      username,
      usernameNormalized: normalized,
      accessCodeHash,
      role,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  console.log(`[Bootstrap] Owner operator record saved to Firestore with UID: ${uid}`);
  console.log(`[Bootstrap] Username: ${username}`);
  console.log(`[Bootstrap] Access Code: ${accessCode}`);
  console.log(`[Bootstrap] Role: ${role}`);
  console.log(`[Bootstrap] Done!`);
}

bootstrapOwner()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Bootstrap Error]:', err);
    process.exit(1);
  });
