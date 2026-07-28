import { Router } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import * as controller from './activity.controller.js';

const router = Router();
router.use(authenticateJWT);
router.get('/', controller.list);
router.get('/export', controller.exportActivities);
router.get('/:id', controller.detail);
export default router;

