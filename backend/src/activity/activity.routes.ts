import { Router } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import * as controller from './activity.controller.js';

const router = Router();
router.use(authenticateJWT);
router.get('/scope', controller.scope);
router.get('/', controller.list);
router.get('/export', controller.exportActivities);
router.get('/export/pdf', controller.exportPdf);
router.get('/:id', controller.detail);
export default router;

