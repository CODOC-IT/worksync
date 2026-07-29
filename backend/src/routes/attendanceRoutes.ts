import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { toUserPk } from '../utils/idMapping.js';
import { query } from '../db/pool.js';
import * as repo from '../reports/reports.repository.js';
import * as attendanceRepo from '../attendance/attendance.repository.js';

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

// POST /api/attendance/check-in — persist check-in to hr.attendancerecords and hr.attendancepunches
router.post('/check-in', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }

    const { workDate, checkInUtc, isLate } = req.body as {
      workDate?: string;
      checkInUtc?: string;
      isLate?: boolean;
    };

    if (!workDate || !checkInUtc) {
      res.status(400).json({ success: false, message: 'workDate and checkInUtc are required.' });
      return;
    }

    const userPk = toUserPk(req.user.id);
    const statusCode = isLate ? 'Late' : 'Present';

    const recordId = await attendanceRepo.upsertAttendanceRecord(userPk, workDate, checkInUtc, statusCode);
    if (recordId) {
      await attendanceRepo.insertAttendancePunch(recordId, 'CheckIn', checkInUtc, userPk);
    }

    res.json({ success: true, data: { attendancerecordid: recordId } });
  } catch (err: any) {
    console.error('[Attendance CheckIn Error]', err);
    res.status(500).json({ success: false, message: 'Failed to persist check-in.', details: err.message });
  }
});

// POST /api/attendance/check-out — persist check-out to hr.attendancerecords and hr.attendancepunches
router.post('/check-out', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }

    const { workDate, checkOutUtc } = req.body as {
      workDate?: string;
      checkOutUtc?: string;
    };

    if (!workDate || !checkOutUtc) {
      res.status(400).json({ success: false, message: 'workDate and checkOutUtc are required.' });
      return;
    }

    const userPk = toUserPk(req.user.id);

    // Find the attendance record for this user on this date
    const records = await repo.getAttendanceRecords(workDate, workDate, [userPk]);
    const record = records[0];
    if (!record) {
      res.status(404).json({ success: false, message: 'No check-in record found for this date.' });
      return;
    }

    // Extract the numeric ID from the prefixed userId (e.g. 'usr-5' -> need attendancerecordid)
    // We need to find the actual attendancerecordid. Let's query it.
    const idResult = await query<{ attendancerecordid: number }>(
      `SELECT attendancerecordid FROM hr.attendancerecords
       WHERE userid = $1 AND workdate = $2::date`,
      [userPk, workDate]
    );

    const recordId = idResult.rows[0]?.attendancerecordid;
    if (!recordId) {
      res.status(404).json({ success: false, message: 'Attendance record not found.' });
      return;
    }

    await attendanceRepo.updateAttendanceCheckOut(recordId, checkOutUtc);
    await attendanceRepo.insertAttendancePunch(recordId, 'CheckOut', checkOutUtc, userPk);

    res.json({ success: true, data: { attendancerecordid: recordId } });
  } catch (err: any) {
    console.error('[Attendance CheckOut Error]', err);
    res.status(500).json({ success: false, message: 'Failed to persist check-out.', details: err.message });
  }
});

export default router;
