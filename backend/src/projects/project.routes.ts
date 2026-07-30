import { Router } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import * as controller from './project.controller.js';
import projectApprovalRoutes from './projectApproval.routes.js';

const router = Router();

// Every route requires a real authenticated session — project identity/authorization is always
// derived from the verified JWT (req.user.id/role), never a client-supplied value.
router.use(authenticateJWT);

// /api/projects/approval-requests/* -- registered before the /:id routes below so this literal
// path segment is never captured as a project id by Express's route matching.
router.use('/approval-requests', projectApprovalRoutes);

// GET /api/projects
router.get('/', controller.listProjects);

// GET /api/projects/:id
router.get('/:id', controller.getProject);

// POST /api/projects
router.post('/', controller.createProject);

// PUT /api/projects/:id
router.put('/:id', controller.updateProject);

// DELETE /api/projects/:id — archives (soft-delete), never a hard DELETE; body: { reason }
router.delete('/:id', controller.archiveProject);

// DELETE /api/projects/:id/permanent — hard-deletes an already-Archived project. Second step of
// the two-step delete; the archive endpoint above is untouched and still the first step.
router.delete('/:id/permanent', controller.permanentlyDeleteProject);

// POST /api/projects/:id/restore — restores an Archived project back to Active.
router.post('/:id/restore', controller.restoreProject);

// GET /api/projects/:id/members
router.get('/:id/members', controller.listMembers);

// POST /api/projects/:id/members — body: { userId, role? }
router.post('/:id/members', controller.addMember);

// DELETE /api/projects/:id/members/:userId
router.delete('/:id/members/:userId', controller.removeMember);

export default router;
