import { NextFunction, Response } from 'express';
import { AuthenticatedRequest } from './authMiddleware.js';
import { userStore } from '../store/userStore.js';
import { recordActivitySafe } from '../activity/activity.service.js';

const moduleForPath = (path: string): string => {
  if (path.startsWith('/api/projects')) return 'Projects';
  if (path.startsWith('/api/tasks')) return 'Tasks';
  if (path.startsWith('/api/project-chats')) return 'Project Chats';
  if (path.startsWith('/api/assistant')) return 'AI Assistant';
  if (path.startsWith('/api/reports')) return 'Reports';
  if (path.startsWith('/api/notifications')) return 'Notifications';
  if (path.startsWith('/api/activity')) return 'Activity Log';
  if (path.startsWith('/api/auth') || path.startsWith('/api/otp')) return 'Authentication';
  return 'System';
};

// Observes responses only. Request bodies and authorization headers are intentionally never
// inspected, which prevents credentials, OTPs, tokens, and other secrets entering the audit log.
export const auditFailedRequests = (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
  res.on('finish', () => {
    if (!req.path.startsWith('/api/') || req.path === '/api/health' || req.path === '/api/auth/login' || res.statusCode < 400) return;
    const actor = req.user ? userStore.findById(req.user.id) : undefined;
    const blocked = res.statusCode === 401 || res.statusCode === 403;
    recordActivitySafe({
      actorId: req.user?.id, actorName: actor?.name, actorEmail: req.user?.email,
      actorRole: req.user?.role, action: blocked ? 'Unauthorized Access' : 'Failed Operation',
      module: moduleForPath(req.path), entityType: 'API Request', entityId: req.path,
      entityName: `${req.method} ${req.path}`,
      description: `${req.method} ${req.path} returned ${res.statusCode}.`,
      result: blocked ? 'Blocked' : 'Failed', source: 'API', important: blocked || res.statusCode >= 500,
      ipAddress: req.ip || req.socket.remoteAddress,
      metadata: { method: req.method, statusCode: res.statusCode }
    });
  });
  next();
};
