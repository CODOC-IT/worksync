import { Router } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import * as controller from './project.controller.js';

const router = Router();

// Every route requires a real authenticated session — project identity/authorization is always
// derived from the verified JWT (req.user.id/role), never a client-supplied value.
router.use(authenticateJWT);

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

// GET /api/projects/:id/members
router.get('/:id/members', controller.listMembers);

// POST /api/projects/:id/members — body: { userId, role? }
router.post('/:id/members', controller.addMember);

// DELETE /api/projects/:id/members/:userId
router.delete('/:id/members/:userId', controller.removeMember);

export default router;
