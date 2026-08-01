import { Router } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import * as controller from './task.controller.js';

const router = Router();

router.use(authenticateJWT);

router.get('/edit-approvals', controller.listTaskEditApprovals);
router.patch('/edit-approvals/:approvalId', controller.decideTaskEditApproval);

// GET /api/tasks?projectId=prj-1&archived=true
router.get('/', controller.listTasks);

// GET /api/tasks/:id
router.get('/:id', controller.getTask);

// POST /api/tasks
router.post('/', controller.createTask);

// PUT /api/tasks/:id
router.put('/:id', controller.updateTask);
router.post('/:id/edit-approvals', controller.createTaskEditApproval);

// DELETE /api/tasks/:id — archives (soft-delete), never a hard DELETE
router.delete('/:id', controller.deleteTask);

// PATCH /api/tasks/:id/status — body: { status, note } — every non-review-decision transition
router.patch('/:id/status', controller.changeStatus);

// PATCH /api/tasks/:id/reopen — body: { status, reason } — Done -> Review/In Progress/Todo.
// The only route out of Done, and Team-Lead-only (see task.service.ts's reopenTask).
router.patch('/:id/reopen', controller.reopenTask);

// PATCH /api/tasks/:id/approve — body: { note } — Review -> Done. This project's own Team Lead
// only (ProjectMembers.MemberRoleCode = 'TeamLead'); Admin no longer gets a bypass, see
// task.service.ts's decideReview.
router.patch('/:id/approve', controller.approveTask);

// PATCH /api/tasks/:id/reject — body: { note, subtaskDecisions? } — Review -> In Progress, same
// Team-Lead-only rule as approve. `subtaskDecisions` (one { subtaskId, decision, comment? } per
// completed subtask) is required whenever the task has Done subtasks — see task.service.ts.
router.patch('/:id/reject', controller.rejectTask);

// GET /api/tasks/:id/history
router.get('/:id/history', controller.getHistory);

export default router;
