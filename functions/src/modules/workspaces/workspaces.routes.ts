import { Router } from 'express';
import { workspacesController } from './workspaces.controller';
import { requireAuth, requirePlatformOwner } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  CreateWorkspaceSchema,
  UpdateWorkspaceSchema,
  CreateMembershipSchema,
  UpdateMembershipSchema,
} from './workspaces.schema';

const router = Router();

router.use(requireAuth());

// Workspaces endpoints
router.get('/', (req, res, next) => workspacesController.list(req, res, next));

router.post(
  '/',
  requirePlatformOwner(),
  validateBody(CreateWorkspaceSchema),
  (req, res, next) => workspacesController.create(req, res, next)
);

router.get('/:workspaceId', (req, res, next) => workspacesController.getById(req, res, next));

router.patch(
  '/:workspaceId',
  requirePlatformOwner(),
  validateBody(UpdateWorkspaceSchema),
  (req, res, next) => workspacesController.update(req, res, next)
);

router.post(
  '/:workspaceId/archive',
  requirePlatformOwner(),
  (req, res, next) => workspacesController.archive(req, res, next)
);

// Membership endpoints (platform_owner only per Section 8)
router.get(
  '/:workspaceId/members',
  requirePlatformOwner(),
  (req, res, next) => workspacesController.listMembers(req, res, next)
);

router.post(
  '/:workspaceId/members',
  requirePlatformOwner(),
  validateBody(CreateMembershipSchema),
  (req, res, next) => workspacesController.addMember(req, res, next)
);

router.patch(
  '/:workspaceId/members/:uid',
  requirePlatformOwner(),
  validateBody(UpdateMembershipSchema),
  (req, res, next) => workspacesController.updateMember(req, res, next)
);

router.delete(
  '/:workspaceId/members/:uid',
  requirePlatformOwner(),
  (req, res, next) => workspacesController.removeMember(req, res, next)
);

export const workspacesRoutes = router;

