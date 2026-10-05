import { db } from '../src/config/firebase';

export interface MigrationResult {
  dryRun: boolean;
  workspaceCreated: boolean;
  operatorsUpdated: number;
  membershipsCreated: number;
  activitiesUpdated: number;
}

export async function runMigration(options: { apply?: boolean } = {}): Promise<MigrationResult> {
  const isDryRun = !options.apply;
  const now = new Date().toISOString();

  const result: MigrationResult = {
    dryRun: isDryRun,
    workspaceCreated: false,
    operatorsUpdated: 0,
    membershipsCreated: 0,
    activitiesUpdated: 0,
  };

  console.log(`[migrate-workspaces] Starting migration (mode: ${isDryRun ? 'DRY-RUN' : 'APPLY'})...`);

  // 1. Ensure 'internal' workspace exists
  const wsRef = db.collection('workspaces').doc('internal');
  const wsDoc = await wsRef.get();
  if (!wsDoc.exists) {
    result.workspaceCreated = true;
    console.log(`[migrate-workspaces] ${isDryRun ? '[DRY-RUN] Would create' : 'Creating'} workspace 'internal'`);
    if (!isDryRun) {
      await wsRef.set({
        id: 'internal',
        name: 'Internal',
        slug: 'internal',
        status: 'active',
        createdBy: 'migration',
        createdAt: now,
        updatedAt: now,
      });
    }
  } else {
    console.log(`[migrate-workspaces] Workspace 'internal' already exists.`);
  }

  // 2. Migrate Operators and Memberships
  const opSnap = await db.collection('operators').get();
  for (const doc of opSnap.docs) {
    const data = doc.data();
    const legacyRole = data.role;

    let targetPlatformRole: 'platform_owner' | null = null;
    let targetWorkspaceRole: 'workspace_admin' | 'editor' = 'editor';

    if (legacyRole === 'crown' || legacyRole === 'owner') {
      targetPlatformRole = 'platform_owner';
      targetWorkspaceRole = 'workspace_admin';
    } else if (legacyRole === 'manager') {
      targetPlatformRole = null;
      targetWorkspaceRole = 'workspace_admin';
    } else {
      targetPlatformRole = null;
      targetWorkspaceRole = 'editor';
    }

    // Check if operator record needs updating
    const needsOpUpdate = data.platformRole === undefined || data.platformRole !== targetPlatformRole;
    if (needsOpUpdate) {
      result.operatorsUpdated++;
      console.log(
        `[migrate-workspaces] ${isDryRun ? '[DRY-RUN] Would update' : 'Updating'} operator ${doc.id} platformRole: ${targetPlatformRole}`
      );
      if (!isDryRun) {
        await doc.ref.update({
          platformRole: targetPlatformRole,
          updatedAt: now,
        });
      }
    }

    // Check if membership exists
    const memId = `internal_${doc.id}`;
    const memRef = db.collection('memberships').doc(memId);
    const memDoc = await memRef.get();
    if (!memDoc.exists) {
      result.membershipsCreated++;
      console.log(
        `[migrate-workspaces] ${isDryRun ? '[DRY-RUN] Would create' : 'Creating'} membership for ${doc.id} (role: ${targetWorkspaceRole})`
      );
      if (!isDryRun) {
        await memRef.set({
          id: memId,
          workspaceId: 'internal',
          uid: doc.id,
          role: targetWorkspaceRole,
          active: data.active ?? true,
          createdBy: 'migration',
          createdAt: now,
          updatedAt: now,
        });
      }
    }
  }

  // 3. Migrate Activities without workspaceId
  const actSnap = await db.collection('activities').get();
  for (const doc of actSnap.docs) {
    const data = doc.data();
    if (!data.workspaceId) {
      result.activitiesUpdated++;
      console.log(
        `[migrate-workspaces] ${isDryRun ? '[DRY-RUN] Would assign' : 'Assigning'} activity ${doc.id} to workspace 'internal'`
      );
      if (!isDryRun) {
        await doc.ref.update({
          workspaceId: 'internal',
          updatedAt: now,
        });
      }
    }
  }

  console.log(`[migrate-workspaces] Finished! Summary:`, result);
  return result;
}

// Auto-run if executed as script
if (require.main === module || (typeof process !== 'undefined' && process.argv[1]?.includes('migrate-workspaces'))) {
  const applyFlag = process.argv.includes('--apply');
  runMigration({ apply: applyFlag })
    .then(() => {
      console.log('Migration complete.');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration failed:', err);
      process.exit(1);
    });
}

