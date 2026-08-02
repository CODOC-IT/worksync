import { Router } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import * as controller from './discussion.controller.js';

const router = Router();

// Every route requires a real authenticated session — discussion identity/authorization is
// always derived from the verified JWT (req.user.id/role), never a client-supplied value.
// Same URL shape as the old backend/src/routes/projectChatRoutes.ts (mounted at
// /api/project-chats in server.ts) so the existing frontend
// (frontend/src/features/project-chats/projectChatRepository.ts) needs no changes.
router.use(authenticateJWT);

// GET /api/project-chats
router.get('/', controller.listThreads);

// GET /api/project-chats/:threadId
router.get('/:threadId', controller.getThread);

// POST /api/project-chats
router.post('/', controller.createThread);

// POST /api/project-chats/:threadId/comments
router.post('/:threadId/comments', controller.addComment);

// PATCH /api/project-chats/comments/:commentId
router.patch('/comments/:commentId', controller.editComment);

// DELETE /api/project-chats/comments/:commentId
router.delete('/comments/:commentId', controller.deleteComment);

// POST /api/project-chats/:threadId/resolution — body: { resolved }

export default router;
