import { auth, db } from '../src/config/firebase';
import { hashAccessCode } from '../src/lib/hash';

interface CreateOperatorOptions {
  email: string;
  password?: string;
  displayName?: string;
  role?: 'superadmin' | 'super_admin' | 'owner' | 'editor' | 'operator' | 'admin';
  accessCode?: string;
  workspaceRole?: 'workspace_admin' | 'editor' | 'viewer';
}

export async function createOrUpdateOperator({
  email,
  password = 'lahanSAWIT13',
  displayName,
  role = 'superadmin',
  accessCode = 'lahanSAWIT13',
  workspaceRole,
}: CreateOperatorOptions): Promise<string> {
  const normalizedEmail = email.trim().toLowerCase();
  const username = normalizedEmail.split('@')[0];
  const finalDisplayName = displayName || (username.toUpperCase());

  console.log(`[Operator] Provisioning operator '${normalizedEmail}' (${role}) with displayName '${finalDisplayName}'...`);

  let uid = '';
  try {
    const existing = await auth.getUserByEmail(normalizedEmail);
    uid = existing.uid;
    console.log(`[Operator] Found existing Firebase Auth user: ${uid}`);
    if (password) {
      await auth.updateUser(uid, { password, displayName: finalDisplayName });
      console.log(`[Operator] Updated password and displayName for ${uid}`);
    }
  } catch (_e) {
    const created = await auth.createUser({
      email: normalizedEmail,
      password,
      displayName: finalDisplayName,
    });
    uid = created.uid;
    console.log(`[Operator] Created Firebase Auth user with UID: ${uid}`);
  }

  // Determine platform and legacy roles
  const isSuperAdmin = role === 'superadmin' || role === 'super_admin' || role === 'owner';
  const platformRole = isSuperAdmin ? 'platform_owner' : null;
  const legacyRole = isSuperAdmin ? 'owner' : 'operator';
  const assignedWorkspaceRole = workspaceRole || (isSuperAdmin ? 'workspace_admin' : 'editor');

  // Set Custom Claims for UI roles
  await auth.setCustomUserClaims(uid, {
    role: legacyRole,
    platformRole,
    workspaceRole: assignedWorkspaceRole,
  });

  // Firestore Operator Document
  const accessCodeHash = await hashAccessCode(accessCode);
  const now = new Date().toISOString();

  await db.collection('operators').doc(uid).set(
    {
      uid,
      username,
      usernameNormalized: username,
      email: normalizedEmail,
      displayName: finalDisplayName,
      accessCodeHash,
      role: legacyRole,
      platformRole,
      active: true,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  // Ensure default internal workspace exists
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
    console.log(`[Operator] Initialized 'internal' workspace`);
  }

  // Assign membership in internal workspace
  const memId = `internal_${uid}`;
  await db.collection('memberships').doc(memId).set(
    {
      id: memId,
      workspaceId: 'internal',
      uid,
      username,
      email: normalizedEmail,
      role: assignedWorkspaceRole,
      active: true,
      createdBy: uid,
      createdAt: now,
      updatedAt: now,
    },
    { merge: true }
  );

  console.log(`[Operator] Successfully provisioned '${normalizedEmail}' with UID: ${uid}`);
  console.log(`  - Username: ${username}`);
  console.log(`  - DisplayName: ${finalDisplayName}`);
  console.log(`  - Platform Role: ${platformRole}`);
  console.log(`  - Legacy Role: ${legacyRole}`);
  console.log(`  - Internal Workspace Role: ${assignedWorkspaceRole}`);

  return uid;
}

export async function bootstrapAccounts(): Promise<void> {
  // 1. owl@untitled.dev (superadmin / platform_owner)
  await createOrUpdateOperator({
    email: 'owl@untitled.dev',
    password: 'lahanSAWIT13',
    displayName: 'OWL',
    role: 'superadmin',
    accessCode: 'lahanSAWIT13',
    workspaceRole: 'workspace_admin',
  });

  // 2. editor@untitled.dev (editor)
  await createOrUpdateOperator({
    email: 'editor@untitled.dev',
    password: 'lahanSAWIT13',
    displayName: 'Editor',
    role: 'editor',
    accessCode: 'lahanSAWIT13',
    workspaceRole: 'editor',
  });
}

// Auto-run if executed directly via CLI
if (process.argv[1]?.includes('create-operator')) {
  bootstrapAccounts()
    .then(() => {
      console.log('[Operator] All requested accounts provisioned successfully!');
      process.exit(0);
    })
    .catch((err) => {
      console.error('[Operator Error]:', err.message || err);
      process.exit(1);
    });
}
