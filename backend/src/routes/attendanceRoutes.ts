import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { toUserPk } from '../utils/idMapping.js';
import { query } from '../db/pool.js';
import * as repo from '../reports/reports.repository.js';
import * as attendanceRepo from '../attendance/attendance.repository.js';
import { canUsePersonalAttendance, getEffectiveRoles } from '../auth/effectiveRoles.js';
import { calculateAttendanceOutcome } from '../attendance/attendancePolicy.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import { userStore } from '../store/userStore.js';
import { materializeAbsences } from '../attendance/absenceMaterialization.js';
import { DEFAULT_BUSINESS_TIME_ZONE, formatBusinessTime } from '../attendance/businessTime.js';
import { resolveAttendanceViewerRole, visibleAttendanceUserIds } from '../attendance/attendanceAccess.js';
import {
  DEFAULT_SHIFT_BREAK_MINUTES,
  DEFAULT_SHIFT_WINDOW_MINUTES,
  SHIFT_TIME_PATTERN,
  scheduleNetMinutes,
  scheduleWindowMinutes
} from '../attendance/workingSchedule.js';

const router = Router();

const ensureBreakStorage = async (): Promise<void> => {
  await query(`
    INSERT INTO hr.attendancestatuses (statuscode, statusname, countsaspresent)
    VALUES ('In Session', 'In Session', FALSE),
           ('Short Hours', 'Short Hours', TRUE)
    ON CONFLICT (statuscode) DO NOTHING
  `);
  await query(`
    CREATE TABLE IF NOT EXISTS public.worksync_active_attendance_breaks (
      user_id TEXT PRIMARY KEY,
      work_date DATE NOT NULL,
      break_id TEXT NOT NULL,
      break_type TEXT NOT NULL,
      started_at_utc TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
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
    const effectiveRoles = await getEffectiveRoles(req.user.id);
    const role = resolveAttendanceViewerRole(req.user.role, effectiveRoles);
    await materializeAbsences(from, to);
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
      visibleUserPks = visibleAttendanceUserIds(
        userPk,
        role,
        visible.rows.map((row) => row.userid)
      );
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

    const activeBreakResult = await query<{
      break_id: string;
      break_type: string;
      started_at_utc: string | Date;
      work_date: string | Date;
    }>(
      `SELECT active_break.break_id, active_break.break_type,
              active_break.started_at_utc, active_break.work_date
         FROM public.worksync_active_attendance_breaks active_break
         JOIN hr.attendancerecords attendance
           ON attendance.userid = $2
          AND attendance.workdate = active_break.work_date
          AND attendance.actualcheckinatutc IS NOT NULL
          AND attendance.actualcheckoutatutc IS NULL
        WHERE active_break.user_id = $1`,
      [req.user.id, userPk]
    );
    const persistedActiveBreak = activeBreakResult.rows[0];

    res.json({
      success: true,
      data: records.map((record) => ({
        ...record,
        breaks: breaksByDate.get(`${record.userId}:${record.date}`) || []
      })),
      activeBreak: persistedActiveBreak
        ? {
            id: persistedActiveBreak.break_id,
            userId: req.user.id,
            workDate: new Date(persistedActiveBreak.work_date).toISOString().split('T')[0],
            breakType: persistedActiveBreak.break_type,
            startedAtUtc: new Date(persistedActiveBreak.started_at_utc).toISOString()
          }
        : null
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

    const { checkInUtc } = req.body as {
      workDate?: string;
      checkInUtc?: string;
    };

    if (!checkInUtc || !Number.isFinite(new Date(checkInUtc).getTime())) {
      res.status(400).json({ success: false, message: 'A valid checkInUtc instant is required.' });
      return;
    }

    const userPk = toUserPk(req.user.id);
    const dateResult = await query<{ workdate: string }>(
      `SELECT ($2::timestamptz AT TIME ZONE COALESCE(profile.timezoneid, o.timezoneid, $3))::date::text AS workdate
         FROM iam.users u
         JOIN org.organizations o ON o.organizationid = u.organizationid
         LEFT JOIN iam.userprofiles profile ON profile.userid = u.userid
        WHERE u.userid = $1`,
      [userPk, checkInUtc, DEFAULT_BUSINESS_TIME_ZONE]
    );
    const workDate = dateResult.rows[0]?.workdate;
    if (!workDate) {
      res.status(404).json({ success: false, message: 'Attendance user was not found.' });
      return;
    }
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
                   ELSE (ar.workdate + wsd.starttime) AT TIME ZONE COALESCE(profile.timezoneid, o.timezoneid, $4)
                   END AS scheduledstartatutc,
              GREATEST(1, COALESCE(hr.schedule_net_minutes(wsd.starttime, wsd.endtime, wsd.breakminutes), 1))::int AS scheduledminutes,
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
              CASE WHEN wsd.starttime IS NULL THEN NULL
                   ELSE ((ar.workdate + wsd.starttime) AT TIME ZONE COALESCE(profile.timezoneid, o.timezoneid, $4))
                        + (hr.schedule_window_minutes(wsd.starttime, wsd.endtime) / 2.0) * interval '1 minute'
                   END AS halfdayboundaryatutc
         FROM hr.attendancerecords ar
         JOIN iam.users u ON u.userid = ar.userid
         JOIN org.organizations o ON o.organizationid = u.organizationid
         LEFT JOIN iam.userprofiles profile ON profile.userid = u.userid
         LEFT JOIN hr.userworkscheduleassignments uwa ON uwa.userid = ar.userid
          AND uwa.effectivefrom <= ar.workdate
          AND (uwa.effectiveto IS NULL OR uwa.effectiveto >= ar.workdate)
         LEFT JOIN hr.workschedules ws ON ws.workscheduleid = COALESCE(ar.workscheduleid, uwa.workscheduleid)
         LEFT JOIN hr.workscheduledays wsd ON wsd.workscheduleid = ws.workscheduleid
          AND wsd.isoweekday = EXTRACT(ISODOW FROM ar.workdate)
        WHERE ar.attendancerecordid = $1`,
      [recordId, workDate, req.user.id, DEFAULT_BUSINESS_TIME_ZONE]
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
    await ensureBreakStorage();
    await query('DELETE FROM public.worksync_active_attendance_breaks WHERE user_id = $1', [req.user.id]);

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

router.post('/breaks/start', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user || !canUsePersonalAttendance(await getEffectiveRoles(req.user.id))) {
      res.status(403).json({ success: false, message: 'Personal attendance is unavailable.' });
      return;
    }
    const { workDate, id, type, startedAtUtc } = req.body as Record<string, string>;
    const started = new Date(startedAtUtc);
    if (!workDate || !id || !Number.isFinite(started.getTime())) {
      res.status(400).json({ success: false, message: 'Valid active-break data is required.' });
      return;
    }
    const activeAttendance = await query(
      `SELECT 1 FROM hr.attendancerecords
        WHERE userid = $1 AND workdate = $2::date
          AND actualcheckinatutc IS NOT NULL AND actualcheckoutatutc IS NULL`,
      [toUserPk(req.user.id), workDate]
    );
    if (!activeAttendance.rowCount) {
      res.status(409).json({ success: false, message: 'Breaks require an active attendance session.' });
      return;
    }
    await ensureBreakStorage();
    await query(
      `INSERT INTO public.worksync_active_attendance_breaks
         (user_id, work_date, break_id, break_type, started_at_utc, updated_at)
       VALUES ($1, $2::date, $3, $4, $5::timestamptz, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         work_date = EXCLUDED.work_date,
         break_id = EXCLUDED.break_id,
         break_type = EXCLUDED.break_type,
         started_at_utc = EXCLUDED.started_at_utc,
         updated_at = NOW()`,
      [req.user.id, workDate, id, type || 'Other', started.toISOString()]
    );
    res.json({ success: true });
  } catch (err) {
    console.error('[Attendance Break Start Error]', err);
    res.status(500).json({ success: false, message: 'Failed to start break.' });
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
    const existingBreakSeconds = await query<{ total: number }>(
      `SELECT COALESCE(SUM(GREATEST(0, (item->>'durationSeconds')::numeric)), 0)::int AS total
         FROM public.worksync_attendance_breaks wab,
              jsonb_array_elements(wab.breaks) item
        WHERE wab.user_id = $1 AND wab.work_date = $2::date`,
      [req.user.id, workDate]
    );
    const cumulativeBreakSeconds =
      (existingBreakSeconds.rows[0]?.total || 0) + durationSeconds;
    if (cumulativeBreakSeconds > DEFAULT_SHIFT_BREAK_MINUTES * 60) {
      res.status(400).json({
        success: false,
        message: `Cumulative break time cannot exceed ${DEFAULT_SHIFT_BREAK_MINUTES} minutes (${DEFAULT_SHIFT_BREAK_MINUTES * 60} seconds) per shift.`
      });
      return;
    }
    const savedBreak = {
      id, type: type || 'Other',
      startTime: formatBusinessTime(started),
      endTime: formatBusinessTime(ended),
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
    await query(
      'DELETE FROM public.worksync_active_attendance_breaks WHERE user_id = $1 AND break_id = $2',
      [req.user.id, id]
    );
    res.json({ success: true, data: savedBreak });
  } catch (err: any) {
    console.error('[Attendance Break Error]', err);
    res.status(500).json({ success: false, message: 'Failed to persist break.' });
  }
});

// Resolves the caller's organization, its time zone and its active default working schedule
// into the response shape shared by GET/PUT /api/attendance/schedule. Returns null when the
// schedule configuration is missing so callers can decide how to surface it.
const loadWorkingSchedule = async (userPk: number) => {
  const orgResult = await query<{ organizationid: number; timezone: string }>(
    `SELECT u.organizationid, COALESCE(o.timezoneid, $2) AS timezone
       FROM iam.users u
       JOIN org.organizations o ON o.organizationid = u.organizationid
      WHERE u.userid = $1`,
    [userPk, DEFAULT_BUSINESS_TIME_ZONE]
  );
  const org = orgResult.rows[0];
  if (!org) return null;

  const scheduleResult = await query<{
    workscheduleid: number;
    schedulename: string;
    graceminutes: number;
  }>(
    `SELECT ws.workscheduleid, ws.schedulename, ws.graceminutes
       FROM hr.workschedules ws
      WHERE ws.organizationid = $1 AND ws.isdefault
      ORDER BY ws.effectivefrom DESC
      LIMIT 1`,
    [org.organizationid]
  );
  const schedule = scheduleResult.rows[0];
  if (!schedule) return null;

  const daysResult = await query<{
    isoweekday: number;
    isworkingday: boolean;
    starttime: string | null;
    endtime: string | null;
    breakminutes: number;
  }>(
    `SELECT wsd.isoweekday, wsd.isworkingday, wsd.starttime::text AS starttime,
            wsd.endtime::text AS endtime, wsd.breakminutes
       FROM hr.workscheduledays wsd
      WHERE wsd.workscheduleid = $1
      ORDER BY wsd.isoweekday`,
    [schedule.workscheduleid]
  );
  const days = daysResult.rows;
  const workingDay = days.find((day) => day.isworkingday);
  const startTime = workingDay?.starttime || null;
  const endTime = workingDay?.endtime || null;
  const breakMinutes = workingDay?.breakminutes ?? DEFAULT_SHIFT_BREAK_MINUTES;

  return {
    workScheduleId: schedule.workscheduleid,
    scheduleName: schedule.schedulename,
    graceMinutes: schedule.graceminutes,
    timeZone: org.timezone,
    startTime,
    endTime,
    breakMinutes,
    windowMinutes: scheduleWindowMinutes(startTime, endTime) ?? DEFAULT_SHIFT_WINDOW_MINUTES,
    netMinutes: scheduleNetMinutes(startTime, endTime, breakMinutes),
    days: days.map((day) => ({
      isoWeekday: day.isoweekday,
      isWorkingDay: day.isworkingday,
      startTime: day.starttime,
      endTime: day.endtime,
      breakMinutes: day.breakminutes
    }))
  };
};

// GET /api/attendance/schedule — read the organization working schedule. Available to every
// authenticated user (the shift start drives the check-in late flag client-side), while only
// Administrators may change it via PUT below. The 8h window / 60m break / 7h net figures are
// always derived from the same rules used by checkout and corrections.
router.get('/schedule', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }
    const schedule = await loadWorkingSchedule(toUserPk(req.user.id));
    if (!schedule) {
      res.status(404).json({ success: false, message: 'No working schedule is configured for your organization.' });
      return;
    }
    res.json({ success: true, data: schedule });
  } catch (err: any) {
    console.error('[Attendance Schedule Error]', err);
    res.status(500).json({ success: false, message: 'Failed to load the working schedule.' });
  }
});

// PUT /api/attendance/schedule — Admin configures the shift start/end (HH:mm). The 8-hour
// window is enforced, the break allowance is fixed server-side at 60 minutes and the change
// is written to the audit log.
router.put('/schedule', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }
    if (!(await getEffectiveRoles(req.user.id)).isAdmin) {
      res.status(403).json({ success: false, message: 'Only Administrators can update the working schedule.' });
      return;
    }
    const { startTime, endTime } = req.body as { startTime?: unknown; endTime?: unknown };
    if (
      typeof startTime !== 'string' ||
      typeof endTime !== 'string' ||
      !SHIFT_TIME_PATTERN.test(startTime) ||
      !SHIFT_TIME_PATTERN.test(endTime)
    ) {
      res.status(400).json({ success: false, message: 'Shift start and end times are required in HH:mm format.' });
      return;
    }
    if (startTime === endTime) {
      res.status(400).json({ success: false, message: 'Shift start and end times must differ.' });
      return;
    }
    if (scheduleWindowMinutes(startTime, endTime) !== DEFAULT_SHIFT_WINDOW_MINUTES) {
      res.status(400).json({
        success: false,
        message: `Shift length must be exactly ${DEFAULT_SHIFT_WINDOW_MINUTES / 60} hours (${DEFAULT_SHIFT_WINDOW_MINUTES} minutes).`
      });
      return;
    }

    const userPk = toUserPk(req.user.id);
    const orgResult = await query<{ organizationid: number }>(
      `SELECT u.organizationid
         FROM iam.users u
        WHERE u.userid = $1`,
      [userPk]
    );
    const organizationId = orgResult.rows[0]?.organizationid;
    if (!organizationId) {
      res.status(404).json({ success: false, message: 'Organization was not found.' });
      return;
    }

    const existingResult = await query<{
      workscheduleid: number;
      starttime: string | null;
      endtime: string | null;
    }>(
      `SELECT ws.workscheduleid, monday.starttime::text AS starttime, monday.endtime::text AS endtime
         FROM hr.workschedules ws
         LEFT JOIN LATERAL (
           SELECT wsd.starttime, wsd.endtime
             FROM hr.workscheduledays wsd
            WHERE wsd.workscheduleid = ws.workscheduleid AND wsd.isoweekday = 1
         ) monday ON TRUE
        WHERE ws.organizationid = $1 AND ws.isdefault
        ORDER BY ws.effectivefrom DESC
        LIMIT 1`,
      [organizationId]
    );
    const existing = existingResult.rows[0];
    let workScheduleId = existing?.workscheduleid;
    if (!workScheduleId) {
      const created = await query<{ workscheduleid: number }>(
        `INSERT INTO hr.workschedules
           (organizationid, schedulename, effectivefrom, graceminutes, isdefault, createdbyuserid)
         VALUES ($1, 'Default Attendance Work Schedule', CURRENT_DATE, 0, TRUE, $2)
         RETURNING workscheduleid`,
        [organizationId, userPk]
      );
      workScheduleId = created.rows[0]?.workscheduleid;
    }
    if (!workScheduleId) {
      res.status(500).json({ success: false, message: 'Failed to resolve the working schedule.' });
      return;
    }

    await query(
      `INSERT INTO hr.workscheduledays
         (workscheduleid, isoweekday, isworkingday, starttime, endtime, breakminutes)
       VALUES
         ($1, 1, TRUE, $2::time, $3::time, 60),
         ($1, 2, TRUE, $2::time, $3::time, 60),
         ($1, 3, TRUE, $2::time, $3::time, 60),
         ($1, 4, TRUE, $2::time, $3::time, 60),
         ($1, 5, TRUE, $2::time, $3::time, 60),
         ($1, 6, FALSE, NULL, NULL, 0),
         ($1, 7, FALSE, NULL, NULL, 0)
       ON CONFLICT (workscheduleid, isoweekday) DO UPDATE SET
         isworkingday = EXCLUDED.isworkingday,
         starttime = EXCLUDED.starttime,
         endtime = EXCLUDED.endtime,
         breakminutes = EXCLUDED.breakminutes`,
      [workScheduleId, startTime, endTime]
    );

    const actorName = userStore.findById(req.user.id)?.name || req.user.email;
    recordActivitySafe({
      actorId: req.user.id,
      actorName,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      action: 'Updated Working Schedule',
      module: 'Attendance',
      entityType: 'Attendance',
      entityId: String(workScheduleId),
      entityName: 'Default Attendance Work Schedule',
      description: `${actorName} updated the working schedule shift from ${existing?.starttime || startTime} to ${startTime}${existing?.endtime ? ` and ${existing.endtime} to ${endTime}` : ''}.`,
      source: 'Web',
      linkRoute: 'attendance',
      changes: [
        { field: 'startTime', previousValue: existing?.starttime || null, newValue: startTime },
        { field: 'endTime', previousValue: existing?.endtime || null, newValue: endTime },
      ],
    });

    const schedule = await loadWorkingSchedule(userPk);
    res.json({ success: true, data: schedule });
  } catch (err: any) {
    console.error('[Attendance Schedule Update Error]', err);
    res.status(500).json({ success: false, message: 'Failed to update the working schedule.', details: err.message });
  }
});

export default router;
