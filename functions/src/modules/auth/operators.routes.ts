import { Router } from 'express';
import { operatorsController } from './operators.controller';
import { requireAuth, requireCapability } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { CreateOperatorSchema, UpdateOperatorSchema } from './operators.schema';

const router = Router();

router.use(requireAuth());
router.use(requireCapability('operators:manage'));

router.get('/', (req, res, next) => {
  operatorsController.list(req, res, next);
});

router.post('/', validateBody(CreateOperatorSchema), (req, res, next) => {
  operatorsController.create(req, res, next);
});

router.patch('/:uid', validateBody(UpdateOperatorSchema), (req, res, next) => {
  operatorsController.update(req, res, next);
});

router.post('/:uid/deactivate', (req, res, next) => {
  operatorsController.deactivate(req, res, next);
});

router.post('/:uid/reactivate', (req, res, next) => {
  operatorsController.reactivate(req, res, next);
});

export const operatorsRoutes = router;
