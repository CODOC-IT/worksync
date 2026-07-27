import { Router } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import * as controller from './task.controller.js';

const router = Router();

router.use(authenticateJWT);

// GET /api/tasks?projectId=prj-1
router.get('/', controller.listTasks);

// GET /api/tasks/:id
router.get('/:id', controller.getTask);

// POST /api/tasks
router.post('/', controller.createTask);

// PUT /api/tasks/:id
router.put('/:id', controller.updateTask);

// DELETE /api/tasks/:id — archives (soft-delete), never a hard DELETE
router.delete('/:id', controller.deleteTask);

// PATCH /api/tasks/:id/status — body: { status, note } — every non-review-decision transition
router.patch('/:id/status', controller.changeStatus);

// PATCH /api/tasks/:id/approve — body: { note } — Review -> Done (Team Lead/Admin only)
router.patch('/:id/approve', controller.approveTask);

// PATCH /api/tasks/:id/reject — body: { note } — Review -> In Progress (Team Lead/Admin only)
router.patch('/:id/reject', controller.rejectTask);

// GET /api/tasks/:id/history
router.get('/:id/history', controller.getHistory);

export default router;
