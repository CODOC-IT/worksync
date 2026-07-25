import { Router } from 'express';
import { authenticateJWT } from '../middleware/authMiddleware.js';
import * as controller from './notification.controller.js';

const router = Router();

// Every route requires a real authenticated session — notification identity is always derived
// from the verified JWT (req.user.id), never from a client-supplied id, per FR-24 "Secure
// Notification Access".
router.use(authenticateJWT);

// GET /api/notifications?unreadOnly=&type=&priority=&search=&page=&pageSize=
router.get('/', controller.listNotifications);

// GET /api/notifications/unread
router.get('/unread', controller.listUnread);

// GET /api/notifications/preferences
router.get('/preferences', controller.getPreferences);

// PUT /api/notifications/preferences
router.put('/preferences', controller.updatePreferences);

// POST /api/notifications — publish a notification event (the event-bus HTTP entry point)
router.post('/', controller.publishEvent);

// PATCH /api/notifications/read-all
router.patch('/read-all', controller.markAllRead);

// PATCH /api/notifications/:id/read
router.patch('/:id/read', controller.markRead);

// DELETE /api/notifications/clear
router.delete('/clear', controller.clearAll);

// DELETE /api/notifications/:id
router.delete('/:id', controller.remove);

export default router;
