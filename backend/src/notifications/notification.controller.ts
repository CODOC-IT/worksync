import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import * as service from './notification.service.js';
import { validatePreferencesBody, validatePublishEventBody } from './notification.validation.js';
import { ApiPriority, NotificationEvent, NotificationType } from './notification.types.js';

// Controller = thin HTTP adapter (Controller layer). Every handler here does: read req, call
// the service, map the result/error to an HTTP response. No SQL, no recipient-resolution
// business logic — that's notification.service.ts / notification.repository.ts.

const requireUser = (req: AuthenticatedRequest, res: Response): string | null => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated.' });
    return null;
  }
  return req.user.id;
};

export const listNotifications = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const { unreadOnly, type, priority, search, page, pageSize } = req.query;
    const result = await service.getNotificationsForUser(userId, {
      unreadOnly: unreadOnly === 'true',
      type: typeof type === 'string' ? (type as NotificationType) : undefined,
      priority: typeof priority === 'string' ? (priority as ApiPriority) : undefined,
      search: typeof search === 'string' ? search : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    });
    res.json({ success: true, data: result.items, total: result.total });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to load notifications.' });
  }
};

export const listUnread = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const data = await service.getUnreadForUser(userId);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to load unread notifications.' });
  }
};

export const getPreferences = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const data = await service.getPreferences(userId);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to load preferences.' });
  }
};

export const updatePreferences = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const validation = validatePreferencesBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  try {
    const data = await service.updatePreferences(userId, req.body);
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to update preferences.' });
  }
};

// POST /notifications — the HTTP entry point of the event bus (see architecture diagram in
// docs/Notification_Module_Guide.md). Called by the frontend's dispatchNotifications() for
// every module that has no backend of its own (Attendance, Break, Reports, Activity Log,
// Project Chat) and could also be called from a real backend module in the future the same
// way assistantRoutes.ts calls notification.service.publishEvent() directly in-process rather
// than over HTTP.
export const publishEvent = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  const validation = validatePublishEventBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  const event = req.body as NotificationEvent;

  // Authorization: a caller may only publish an event *as* themselves — never spoof another
  // user as the actor.
  if (event.actorId && event.actorId !== userId) {
    res.status(403).json({ success: false, message: 'actorId must match the authenticated user.' });
    return;
  }

  try {
    const created = await service.publishEvent(event);
    res.status(201).json({ success: true, data: created });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to publish notification event.' });
  }
};

export const markRead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const updated = await service.markNotificationRead(userId, req.params.id);
    if (!updated) {
      res.status(404).json({ success: false, message: 'Notification not found.' });
      return;
    }
    res.json({ success: true, message: 'Notification marked as read.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to mark notification as read.' });
  }
};

export const markAllRead = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const count = await service.markAllNotificationsRead(userId);
    res.json({ success: true, message: `${count} notification(s) marked as read.` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to mark all notifications as read.' });
  }
};

export const remove = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const removed = await service.clearNotification(userId, req.params.id);
    if (!removed) {
      res.status(404).json({ success: false, message: 'Notification not found.' });
      return;
    }
    res.json({ success: true, message: 'Notification cleared.' });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to clear notification.' });
  }
};

export const clearAll = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const userId = requireUser(req, res);
  if (!userId) return;

  try {
    const count = await service.clearAllNotifications(userId);
    res.json({ success: true, message: `${count} notification(s) cleared.` });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to clear notifications.' });
  }
};
