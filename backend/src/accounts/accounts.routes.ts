import { Router } from 'express';
import { authenticateJWT, authenticateSession } from '../middleware/authMiddleware.js';
import {
  getDepartments,
  postAccount,
  postFirstLoginPassword,
  postInvitationResend
} from './accounts.controller.js';

const router = Router();

router.get('/departments', authenticateJWT, getDepartments);
router.post('/', authenticateJWT, postAccount);
router.post('/:userId/invitation/resend', authenticateJWT, postInvitationResend);
router.post('/first-login/password', authenticateSession, postFirstLoginPassword);

export default router;
