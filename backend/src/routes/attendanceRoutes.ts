import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { toUserPk } from '../utils/idMapping.js';
import * as repo from '../reports/reports.repository.js';

const router = Router();

function validateDateRange(from: string, to: string): string | null {
  const today = new Date().toISOString().split('T')[0];
  if (from > today) return 'From date cannot be in the future.';
  if (to > today) return 'To date cannot be in the future.';
  if (to < from) return 'To date cannot be earlier than From date.';
  return null;
}

// GET /api/attendance — returns attendance records for the authenticated user within a date range
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
    const records = await repo.getAttendanceRecords(from, to, [userPk]);

    res.json({ success: true, data: records });
  } catch (err: any) {
    console.error('[Attendance Error]', err);
    res.status(500).json({ success: false, message: 'Failed to load attendance records.' });
  }
});

export default router;
