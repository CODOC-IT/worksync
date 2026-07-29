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

// GET /api/notifications/analytics — Admin-only, registered before /:id-shaped routes for the
// same reason /clear is registered before DELETE /:id below (Express matches in registration
// order; a literal segment must win over a param segment it could otherwise be captured by).
router.get('/analytics', controller.getAnalytics);

// GET /api/notifications/analytics/users?search=&page=&pageSize=&sortBy=
// GET /api/notifications/analytics/users/:userId — Admin-only per-user analytics + drill-down.
// Registered before the generic /:id-shaped routes below for the same route-ordering reason as
// /analytics itself.
router.get('/analytics/users', controller.getUserAnalytics);
router.get('/analytics/users/:userId', controller.getUserAnalyticsDetail);

// PUT /api/notifications/preferences
router.put('/preferences', controller.updatePreferences);

// POST /api/notifications — publish a notification event (the event-bus HTTP entry point)
router.post('/', controller.publishEvent);

// PATCH /api/notifications/read-all
router.patch('/read-all', controller.markAllRead);

// PATCH /api/notifications/:id/read
router.patch('/:id/read', controller.markRead);

// PATCH /api/notifications/:id/snooze — body: { until: ISO date string }
router.patch('/:id/snooze', controller.snooze);

// DELETE /api/notifications/clear
router.delete('/clear', controller.clearAll);

// DELETE /api/notifications/:id
router.delete('/:id', controller.remove);

export default router;
