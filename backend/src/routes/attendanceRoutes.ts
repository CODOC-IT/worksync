import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { toUserPk } from '../utils/idMapping.js';
import { query } from '../db/pool.js';
import * as repo from '../reports/reports.repository.js';
import * as attendanceRepo from '../attendance/attendance.repository.js';
import { attendanceRole, canUsePersonalAttendance, getEffectiveRoles } from '../auth/effectiveRoles.js';
import { calculateAttendanceOutcome } from '../attendance/attendancePolicy.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import { userStore } from '../store/userStore.js';

const router = Router();

const ensureBreakStorage = async (): Promise<void> => {
  await query(`
    INSERT INTO hr.attendancestatuses (statuscode, statusname, countsaspresent)
    VALUES ('In Session', 'In Session', FALSE)
    ON CONFLICT (statuscode) DO NOTHING
  `);
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

const materializeAbsences = async (from: string, to: string): Promise<void> => {
  await query(
    `INSERT INTO hr.attendancerecords
       (userid, workdate, workscheduleid, attendancestatusid, scheduledstarttime,
        scheduledendtime, workingminutes, sourcecode, updatedatutc)
     SELECT u.userid, day.workdate, schedule.workscheduleid,
            (SELECT attendancestatusid FROM hr.attendancestatuses WHERE statuscode = 'Absent'),
            wsd.starttime, wsd.endtime, 0, 'System', CURRENT_TIMESTAMP
       FROM iam.users u
       CROSS JOIN generate_series($1::date, LEAST($2::date, CURRENT_DATE - 1), interval '1 day')
         AS day(workdate)
       LEFT JOIN LATERAL (
         SELECT ws.workscheduleid
           FROM hr.workschedules ws
           LEFT JOIN hr.userworkscheduleassignments uwa
             ON uwa.workscheduleid = ws.workscheduleid AND uwa.userid = u.userid
            AND uwa.effectivefrom <= day.workdate
            AND (uwa.effectiveto IS NULL OR uwa.effectiveto >= day.workdate)
          WHERE ws.organizationid = u.organizationid
            AND ws.effectivefrom <= day.workdate
            AND (ws.effectiveto IS NULL OR ws.effectiveto >= day.workdate)
            AND (uwa.userid IS NOT NULL OR ws.isdefault)
          ORDER BY (uwa.userid IS NOT NULL) DESC, ws.effectivefrom DESC
          LIMIT 1
       ) schedule ON TRUE
       LEFT JOIN hr.workscheduledays wsd
         ON wsd.workscheduleid = schedule.workscheduleid
        AND wsd.isoweekday = EXTRACT(ISODOW FROM day.workdate)
      WHERE u.accountstatus = 'Active'
        AND COALESCE(wsd.isworkingday, EXTRACT(ISODOW FROM day.workdate) < 6)
        AND NOT EXISTS (
          SELECT 1 FROM iam.userroles ur JOIN iam.roles r ON r.roleid = ur.roleid
           WHERE ur.userid = u.userid AND r.rolecode = 'Administrator'
             AND ur.revokedatutc IS NULL AND ur.startsatutc <= day.workdate + interval '1 day'
             AND (ur.endsatutc IS NULL OR ur.endsatutc > day.workdate)
        )
        AND NOT EXISTS (
          SELECT 1 FROM hr.holidays h
           WHERE h.organizationid = u.organizationid
             AND (h.departmentid IS NULL OR h.departmentid = u.departmentid)
             AND (h.holidaydate = day.workdate OR
                  (h.isrecurringannual AND to_char(h.holidaydate, 'MM-DD') = to_char(day.workdate, 'MM-DD')))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.worksync_hr_requests wr
           WHERE wr.user_id = 'usr-' || u.userid AND wr.request_date = day.workdate
             AND wr.request_type = 'Leave' AND wr.status = 'Approved'
        )
     ON CONFLICT (userid, workdate) DO NOTHING`,
    [from, to]
  );
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
    const role = attendanceRole(await getEffectiveRoles(req.user.id));
    if (role !== 'Member') await materializeAbsences(from, to);
    let visibleUserPks: number[];
    if (role === 'Member') {
      visibleUserPks = [userPk];
    } else {
      const visible = await query<{ userid: number }>(
        `SELECT u.userid
           FROM iam.users u
          WHERE u.accountstatus = 'Active'
            AND u.userid <> $1
            AND NOT EXISTS (
              SELECT 1
                FROM iam.userroles ur
                JOIN iam.roles r ON r.roleid = ur.roleid
               WHERE ur.userid = u.userid
                 AND r.rolecode = 'Administrator'
                 AND ur.revokedatutc IS NULL
                 AND ur.startsatutc <= now()
                 AND (ur.endsatutc IS NULL OR ur.endsatutc > now())
            )`,
        [userPk]
      );
      visibleUserPks = visible.rows.map((row) => row.userid);
      if (role === 'HR') visibleUserPks.push(userPk);
    }
    const records = visibleUserPks.length
      ? await repo.getAttendanceRecords(from, to, visibleUserPks)
      : [];
    await ensureBreakStorage();
    const breakRows = await query<{ user_id: string; work_date: string | Date; breaks: unknown[] | string }>(
      `SELECT user_id, work_date, breaks
         FROM public.worksync_attendance_breaks
        WHERE work_date BETWEEN $1::date AND $2::date
          AND user_id = ANY($3::text[])`,
      [from, to, visibleUserPks.map((id) => `usr-${id}`)]
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

// Retained for API compatibility, but attendance records are now view-only for Admin.
router.put('/:userId/:date', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }
    res.status(403).json({ success: false, message: 'Attendance records are view-only for Administrators.' });
    return;
    /*
    const effectiveRoles = await getEffectiveRoles(req.user.id);
    if (!effectiveRoles.isAdmin) {
      res.status(403).json({ success: false, message: 'Only Admin can directly edit attendance.' });
      return;
    }
    const { checkIn, checkOut, breaks, reason } = req.body as {
      checkIn?: string;
      checkOut?: string;
      breaks?: unknown[];
      reason?: string;
    };
    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (!cleanReason) {
      res.status(400).json({ success: false, message: 'A correction reason is required.' });
      return;
    }
    if (req.params.userId === req.user.id) {
      res.status(403).json({ success: false, message: 'Admins do not have personal attendance records.' });
      return;
    }
    const targetAdmin = await query(
      `SELECT 1
         FROM iam.userroles ur
         JOIN iam.roles r ON r.roleid = ur.roleid
        WHERE ur.userid = $1 AND r.rolecode = 'Administrator'
          AND ur.revokedatutc IS NULL AND ur.startsatutc <= now()
          AND (ur.endsatutc IS NULL OR ur.endsatutc > now())
        LIMIT 1`,
      [toUserPk(req.params.userId)]
    );
    if (targetAdmin.rowCount) {
      res.status(403).json({ success: false, message: 'Administrators do not have attendance records.' });
      return;
    }
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
    await recordActivity({
      actorId: req.user.id,
      actorEmail: req.user.email,
      actorRole: 'Admin',
      affectedUserId: req.params.userId,
      action: 'Corrected',
      module: 'Attendance',
      entityType: 'Attendance',
      entityId: `${req.params.userId}:${req.params.date}`,
      entityName: `Attendance ${req.params.date}`,
      description: `Administrator corrected attendance for ${req.params.userId}.`,
      reason: cleanReason,
      source: 'API',
      important: true,
      linkRoute: 'attendance',
      changes: [
        { field: 'checkIn', previousValue: null, newValue: checkIn },
        { field: 'checkOut', previousValue: null, newValue: checkOut || null },
      ],
    });
    res.json({ success: true, message: 'Attendance record updated.' }); */
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
    if (!canUsePersonalAttendance(await getEffectiveRoles(req.user.id))) {
      res.status(403).json({ success: false, message: 'Admins do not have personal attendance.' });
      return;
    }

    const { workDate, checkInUtc } = req.body as {
      workDate?: string;
      checkInUtc?: string;
    };

    if (!workDate || !checkInUtc) {
      res.status(400).json({ success: false, message: 'workDate and checkInUtc are required.' });
      return;
    }

    const userPk = toUserPk(req.user.id);
    await ensureBreakStorage();
    const recordId = await attendanceRepo.upsertAttendanceRecord(userPk, workDate, checkInUtc, 'In Session');
    if (recordId) {
      await attendanceRepo.insertAttendancePunch(recordId, 'CheckIn', checkInUtc, userPk);
      const actorName = userStore.findById(req.user.id)?.name || req.user.email;
      recordActivitySafe({
        actorId: req.user.id,
        actorName,
        actorEmail: req.user.email,
        actorRole: req.user.role,
        action: 'Checked In',
        module: 'Attendance',
        entityType: 'Attendance',
        entityId: String(recordId),
        entityName: `Attendance ${workDate}`,
        description: `${actorName} checked in.`,
        source: 'Web',
      });
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
    if (!canUsePersonalAttendance(await getEffectiveRoles(req.user.id))) {
      res.status(403).json({ success: false, message: 'Admins do not have personal attendance.' });
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

    const policy = await query<{
      actualcheckinatutc: Date;
      scheduledstartatutc: Date | null;
      scheduledminutes: number;
      graceminutes: number;
      breakseconds: number;
      approvedleavetype: 'Full Day Leave' | 'Half Day Leave' | null;
      approvedleaveperiod: 'First Half' | 'Second Half' | null;
      halfdayboundaryatutc: Date;
    }>(
      `SELECT ar.actualcheckinatutc,
              CASE WHEN wsd.starttime IS NULL THEN NULL
                   ELSE (ar.workdate + wsd.starttime) AT TIME ZONE 'UTC' END AS scheduledstartatutc,
              GREATEST(1, COALESCE(
                EXTRACT(EPOCH FROM (wsd.endtime - wsd.starttime)) / 60 - wsd.breakminutes,
                480
              ))::int AS scheduledminutes,
              COALESCE(ws.graceminutes, 0)::int AS graceminutes,
              COALESCE((
                SELECT SUM(GREATEST(0, (item->>'durationSeconds')::numeric))
                  FROM public.worksync_attendance_breaks wab,
                       jsonb_array_elements(wab.breaks) item
                 WHERE wab.user_id = $3 AND wab.work_date = $2::date
              ), 0)::int AS breakseconds,
              (
                SELECT wr.details->>'leaveType' FROM public.worksync_hr_requests wr
                 WHERE wr.user_id = $3 AND wr.request_date = $2::date
                   AND wr.request_type = 'Leave' AND wr.status = 'Approved'
                 ORDER BY wr.decided_at DESC NULLS LAST LIMIT 1
              ) AS approvedleavetype,
              COALESCE((
                SELECT wr.details->>'leavePeriod' FROM public.worksync_hr_requests wr
                 WHERE wr.user_id = $3 AND wr.request_date = $2::date
                   AND wr.request_type = 'Leave' AND wr.status = 'Approved'
                   AND wr.details->>'leaveType' = 'Half Day Leave'
                 ORDER BY wr.decided_at DESC NULLS LAST LIMIT 1
              ), 'Second Half') AS approvedleaveperiod,
              (ar.workdate + TIME '12:00') AT TIME ZONE 'UTC' AS halfdayboundaryatutc
         FROM hr.attendancerecords ar
         LEFT JOIN hr.userworkscheduleassignments uwa ON uwa.userid = ar.userid
          AND uwa.effectivefrom <= ar.workdate
          AND (uwa.effectiveto IS NULL OR uwa.effectiveto >= ar.workdate)
         LEFT JOIN hr.workschedules ws ON ws.workscheduleid = COALESCE(ar.workscheduleid, uwa.workscheduleid)
         LEFT JOIN hr.workscheduledays wsd ON wsd.workscheduleid = ws.workscheduleid
          AND wsd.isoweekday = EXTRACT(ISODOW FROM ar.workdate)
        WHERE ar.attendancerecordid = $1`,
      [recordId, workDate, req.user.id]
    );
    const row = policy.rows[0];
    if (!row?.actualcheckinatutc) {
      res.status(409).json({ success: false, message: 'This attendance session is not active.' });
      return;
    }
    const outcome = calculateAttendanceOutcome({
      checkInUtc: new Date(row.actualcheckinatutc),
      checkOutUtc: new Date(checkOutUtc),
      scheduledStartUtc: row.scheduledstartatutc ? new Date(row.scheduledstartatutc) : null,
      scheduledMinutes: row.scheduledminutes,
      graceMinutes: row.graceminutes,
      breakSeconds: row.breakseconds,
      approvedLeave: row.approvedleavetype
        ? {
            type: row.approvedleavetype,
            period: row.approvedleaveperiod || undefined,
            halfDayBoundaryUtc: new Date(row.halfdayboundaryatutc)
          }
        : null
    });
    await attendanceRepo.updateAttendanceCheckOut(
      recordId,
      checkOutUtc,
      outcome.status === 'On Leave' ? 'Leave' : outcome.status,
      outcome.workingMinutes,
      outcome.lateMinutes
    );
    await attendanceRepo.insertAttendancePunch(recordId, 'CheckOut', checkOutUtc, userPk);

    const actorName = userStore.findById(req.user.id)?.name || req.user.email;

    recordActivitySafe({
      actorId: req.user.id,
      actorName,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: 'Checked Out',
      module: 'Attendance',
      entityType: 'Attendance',
      entityId: String(recordId),
      entityName: `Attendance ${workDate}`,
      description: `${actorName} checked out.`,
      source: 'Web',
    });

    res.json({
      success: true,
      data: {
        attendancerecordid: recordId,
        status: outcome.status,
        workingMinutes: outcome.workingMinutes
      }
    });
  } catch (err: any) {
    console.error('[Attendance CheckOut Error]', err);
    res.status(500).json({ success: false, message: 'Failed to persist check-out.', details: err.message });
  }
});

router.post('/breaks', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !canUsePersonalAttendance(await getEffectiveRoles(req.user.id))) {
      res.status(403).json({ success: false, message: 'Personal attendance is unavailable.' });
      return;
    }
    const { workDate, id, type, startedAtUtc, endedAtUtc } = req.body as Record<string, string>;
    const started = new Date(startedAtUtc);
    const ended = new Date(endedAtUtc);
    if (!workDate || !id || !Number.isFinite(started.getTime()) || !Number.isFinite(ended.getTime()) || ended <= started) {
      res.status(400).json({ success: false, message: 'Valid break timestamps are required.' });
      return;
    }
    const active = await query(
      `SELECT 1 FROM hr.attendancerecords
        WHERE userid = $1 AND workdate = $2::date
          AND actualcheckinatutc IS NOT NULL AND actualcheckoutatutc IS NULL`,
      [toUserPk(req.user.id), workDate]
    );
    if (!active.rowCount) {
      res.status(409).json({ success: false, message: 'Breaks can only be saved during an active session.' });
      return;
    }
    await ensureBreakStorage();
    const durationSeconds = Math.max(0, Math.floor((ended.getTime() - started.getTime()) / 1000));
    const savedBreak = {
      id, type: type || 'Other',
      startTime: started.toISOString().slice(11, 16),
      endTime: ended.toISOString().slice(11, 16),
      startedAtUtc: started.toISOString(), endedAtUtc: ended.toISOString(),
      durationSeconds, durationMinutes: durationSeconds / 60
    };
    await query(
      `INSERT INTO public.worksync_attendance_breaks (user_id, work_date, breaks, updated_at)
       VALUES ($1, $2::date, jsonb_build_array($3::jsonb), NOW())
       ON CONFLICT (user_id, work_date) DO UPDATE
       SET breaks = public.worksync_attendance_breaks.breaks || EXCLUDED.breaks, updated_at = NOW()`,
      [req.user.id, workDate, JSON.stringify(savedBreak)]
    );
    res.json({ success: true, data: savedBreak });
  } catch (err: any) {
    console.error('[Attendance Break Error]', err);
    res.status(500).json({ success: false, message: 'Failed to persist break.' });
  }
});

export default router;
