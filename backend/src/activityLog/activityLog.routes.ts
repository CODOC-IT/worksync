import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { toUserPk } from '../utils/idMapping.js';
import * as repo from './activityLog.repository.js';

const router = Router();

function validateDateRange(from: string, to: string): string | null {
  const today = new Date().toISOString().split('T')[0];
  if (from > today) return 'From date cannot be in the future.';
  if (to > today) return 'To date cannot be in the future.';
  if (to < from) return 'To date cannot be earlier than From date.';
  return null;
}

// GET /api/activity-log — returns activity logs for the authenticated user within a date range
router.get('/', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }

    const { from, to } = req.query as { from?: string; to?: string };

    if (!from || !to) {
      res.status(400).json({ success: false, message: 'Date range (from, to) is required.' });
      return;
    }

    const dateError = validateDateRange(from, to);
    if (dateError) {
      res.status(400).json({ success: false, message: dateError });
      return;
    }

    const userPk = toUserPk(req.user.id);
    const logs = await repo.getActivityLogs(userPk, from, to);

    const mapped = logs.map((l) => ({
      id: l.id,
      userId: l.userId,
      userName: l.userName,
      action: l.action,
      targetType: l.targetType,
      targetId: l.targetId,
      targetTitle: l.targetTitle,
      timestamp: l.timestamp,
      ...(l.diffField ? { diff: { field: l.diffField, oldVal: l.diffOldVal || '', newVal: l.diffNewVal || '' } } : {}),
    }));

    res.json({ success: true, data: mapped });
  } catch (err: any) {
    console.error('[Activity Log Error]', err);
    res.status(500).json({ success: false, message: 'Failed to load activity logs.' });
  }
});

// POST /api/activity-log — creates a new activity log entry
router.post('/', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }

    const { action, targetType, targetId, targetTitle, diff } = req.body;

    if (!action || !targetType) {
      res.status(400).json({ success: false, message: 'Action and targetType are required.' });
      return;
    }

    const userPk = toUserPk(req.user.id);
    const eventId = await repo.createActivityLog(
      userPk,
      action,
      repo.toDbEntityType(targetType),
      targetId || '',
      targetTitle || null,
      diff?.field,
      diff?.oldVal,
      diff?.newVal
    );

    res.status(201).json({ success: true, data: { id: `act-${eventId}` } });
  } catch (err: any) {
    console.error('[Activity Log Create Error]', err);
    res.status(500).json({ success: false, message: 'Failed to create activity log entry.' });
  }
});

export default router;
