import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { toUserPk } from '../utils/idMapping.js';
import { query } from '../db/pool.js';
import * as repo from '../reports/reports.repository.js';
import * as attendanceRepo from '../attendance/attendance.repository.js';

const router = Router();

const ensureBreakStorage = async (): Promise<void> => {
  await query(`
    CREATE TABLE IF NOT EXISTS public.worksync_attendance_breaks (
      user_id TEXT NOT NULL,
      work_date DATE NOT NULL,
      breaks JSONB NOT NULL DEFAULT '[]'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, work_date)
    )
  `);
};

function validateDateRange(from: string, to: string): string | null {
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
    const normalizedRole = String(req.user.role || '').replace(/[\s_-]/g, '').toLowerCase();
    const canViewAll = ['admin', 'administrator', 'hr', 'hrrepresentative', 'humanresources'].includes(normalizedRole);
    const records = await repo.getAttendanceRecords(from, to, canViewAll ? undefined : [userPk]);
    await ensureBreakStorage();
    const breakRows = await query<{ user_id: string; work_date: string | Date; breaks: unknown[] | string }>(
      `SELECT user_id, work_date, breaks
         FROM public.worksync_attendance_breaks
        WHERE work_date BETWEEN $1::date AND $2::date
          ${canViewAll ? '' : 'AND user_id = $3'}`,
      canViewAll ? [from, to] : [from, to, req.user.id]
    );
    const breaksByDate = new Map(
      breakRows.rows.map((row) => [
        `${row.user_id}:${new Date(row.work_date).toISOString().split('T')[0]}`,
        typeof row.breaks === 'string' ? JSON.parse(row.breaks) : row.breaks
      ])
    );

    res.json({
      success: true,
      data: records.map((record) => ({
        ...record,
        breaks: breaksByDate.get(`${record.userId}:${record.date}`) || []
      }))
    });
  } catch (err: any) {
    console.error('[Attendance Error]', err);
    res.status(500).json({ success: false, message: 'Failed to load attendance records.' });
  }
});

// PUT /api/attendance/:userId/:date — preserves the existing Admin direct-edit capability.
router.put('/:userId/:date', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }
    const role = String(req.user.role || '').replace(/[\s_-]/g, '').toLowerCase();
    if (!['admin', 'administrator'].includes(role)) {
      res.status(403).json({ success: false, message: 'Only Admin can directly edit attendance.' });
      return;
    }
    const { checkIn, checkOut, breaks } = req.body as {
      checkIn?: string;
      checkOut?: string;
      breaks?: unknown[];
    };
    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!checkIn || !timePattern.test(checkIn) || (checkOut && !timePattern.test(checkOut))) {
      res.status(400).json({ success: false, message: 'Attendance times must use HH:mm format.' });
      return;
    }
    if (checkOut && checkOut <= checkIn) {
      res.status(400).json({ success: false, message: 'Check-out must be later than check-in.' });
      return;
    }
    const updated = await query(
      `UPDATE hr.attendancerecords
          SET actualcheckinatutc = ($2::date + $3::time) AT TIME ZONE 'UTC',
              actualcheckoutatutc = CASE WHEN NULLIF($4, '') IS NULL THEN NULL
                ELSE ($2::date + $4::time) AT TIME ZONE 'UTC' END,
              workingminutes = CASE WHEN NULLIF($4, '') IS NULL THEN 0
                ELSE GREATEST(0, EXTRACT(EPOCH FROM (
                  (($2::date + $4::time) AT TIME ZONE 'UTC') -
                  (($2::date + $3::time) AT TIME ZONE 'UTC')
                )) / 60)::int END,
              sourcecode = 'HRCorrection',
              updatedatutc = CURRENT_TIMESTAMP
        WHERE userid = $1 AND workdate = $2::date`,
      [toUserPk(req.params.userId), req.params.date, checkIn, checkOut || '']
    );
    if (!updated.rowCount) {
      res.status(404).json({ success: false, message: 'Attendance record not found.' });
      return;
    }
    await ensureBreakStorage();
    await query(
      `INSERT INTO public.worksync_attendance_breaks (user_id, work_date, breaks, updated_at)
       VALUES ($1, $2::date, $3::jsonb, NOW())
       ON CONFLICT (user_id, work_date) DO UPDATE SET breaks = EXCLUDED.breaks, updated_at = NOW()`,
      [req.params.userId, req.params.date, JSON.stringify(Array.isArray(breaks) ? breaks : [])]
    );
    res.json({ success: true, message: 'Attendance record updated.' });
  } catch (err: any) {
    console.error('[Attendance Update Error]', err);
    res.status(500).json({ success: false, message: 'Failed to update attendance record.' });
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
