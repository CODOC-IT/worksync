import { Router } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import {
  getDepartments,
  postAccount,
  postInvitationResend
} from './accounts.controller.js';

const router = Router();

router.get('/departments', authenticateJWT, getDepartments);
router.post('/', authenticateJWT, postAccount);
router.post('/:userId/invitation/resend', authenticateJWT, postInvitationResend);

export default router;
