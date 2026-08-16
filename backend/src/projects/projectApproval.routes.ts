import { Router } from 'express';
import * as controller from './projectApproval.controller.js';

// Mounted under /api/projects/approval-requests by project.routes.ts, ahead of its own
// /:id-shaped routes so this literal path segment is never captured as a project id.
// authenticateJWT is already applied by the parent router.
const router = Router();

// GET /api/projects/approval-requests -- Admin's Approval Inbox.
router.get('/', controller.listPending);

// GET /api/projects/approval-requests/mine -- the calling Team Lead's own submitted requests.
router.get('/mine', controller.listMine);
router.patch('/:id/setup', controller.changeSetup);

// PATCH /api/projects/approval-requests/:id/approve -- body: { reason? }
router.patch('/:id/approve', controller.approve);

// PATCH /api/projects/approval-requests/:id/reject -- body: { reason? }
router.patch('/:id/reject', controller.reject);

export default router;
