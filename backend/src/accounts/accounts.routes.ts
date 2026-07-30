import { Router } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import {
  getDepartments,
  postAccount
} from './accounts.controller.js';

const router = Router();

router.get('/departments', authenticateJWT, getDepartments);
router.post('/', authenticateJWT, postAccount);

export default router;
