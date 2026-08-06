import { Router } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import {
  deleteDepartmentController,
  getDepartments,
  postAccount,
  postDepartment
} from './accounts.controller.js';

const router = Router();

router.get('/departments', authenticateJWT, getDepartments);
router.post('/departments', authenticateJWT, postDepartment);
router.delete('/departments/:id', authenticateJWT, deleteDepartmentController);
router.post('/', authenticateJWT, postAccount);

export default router;
