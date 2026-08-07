import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { query, withTransaction } from '../db/pool.js';
import { toUserPk } from '../utils/idMapping.js';
import { attendanceRole, getEffectiveRoles } from '../auth/effectiveRoles.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import { userStore } from '../store/userStore.js';
import {
  totalCorrectionBreakMinutes,
  validateCorrectionValues
} from '../attendance/correctionValidation.js';
import { calculateAttendanceOutcome } from '../attendance/attendancePolicy.js';
import { DEFAULT_BUSINESS_TIME_ZONE } from '../attendance/businessTime.js';
import { validateLeaveOverlap, type LeaveWindow } from '../attendance/leaveOverlap.js';

type RequestType = 'Correction' | 'Leave' | 'Break_Exception';
type RequestStatus = 'Pending' | 'Approved' | 'Rejected';
type ApprovalStage = 'HR' | 'Admin';

interface HRRequestDetails {
  currentCheckIn?: string;
  currentCheckOut?: string;
  requestedCheckIn?: string;
  requestedCheckOut?: string;
  currentBreaks?: unknown[];
  requestedBreaks?: unknown[];
  attendanceChangeReason?: string;
  leaveType?: 'Full Day Leave' | 'Half Day Leave';
  leavePeriod?: 'First Half' | 'Second Half';
  leaveDays?: number;
  extraBreakMinutes?: number;
}

interface HRRequestRow {
  id: string;
  user_id: string;
  user_name: string | null;
  requester_role: string | null;
  request_type: RequestType;
  request_date: string | Date;
  reason: string;
  status: RequestStatus;
  approval_stage: ApprovalStage;
  details: HRRequestDetails | string | null;
  submitted_at: string | Date;
  decided_by: string | null;
  decision_reason: string | null;
}

const router = Router();
const allowedTypes: RequestType[] = ['Correction', 'Leave', 'Break_Exception'];
const normalizeRole = (role: unknown): string =>
  String(role || '').replace(/[\s_-]/g, '').toLowerCase();
const isAdmin = (role: unknown): boolean =>
  ['admin', 'administrator'].includes(normalizeRole(role));
const isHR = (role: unknown): boolean =>
  ['hr', 'hrspecialist', 'hrrepresentative', 'humanresources'].includes(normalizeRole(role));

export const getInitialApprovalStage = (
  requestType: RequestType,
  requesterRole: string
): ApprovalStage =>
  isHR(requesterRole) ? 'Admin' : 'HR';

export const canReviewRequestStage = (
  requestType: RequestType,
  stage: ApprovalStage,
  reviewerRole: string
): boolean =>
  (stage === 'HR' && ['Correction', 'Leave', 'Break_Exception'].includes(requestType) && isHR(reviewerRole)) ||
  (stage === 'Admin' && isAdmin(reviewerRole));

export const canSubmitOwnCorrection = (
  actorId: string,
  recordUserId: string,
  actorRole: string,
  recordIsActive: boolean
): boolean =>
  actorId === recordUserId && !isAdmin(actorRole) && !recordIsActive;

const ensureTable = async (): Promise<void> => {
  await query(`
    CREATE TABLE IF NOT EXISTS public.worksync_hr_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT,
      requester_role TEXT,
      request_type TEXT NOT NULL CHECK (request_type IN ('Correction', 'Leave', 'Break_Exception')),
      request_date DATE NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
      approval_stage TEXT NOT NULL DEFAULT 'Admin' CHECK (approval_stage IN ('HR', 'Admin')),
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_by TEXT,
      decision_reason TEXT,
      decided_at TIMESTAMPTZ
    )
  `);
  await query(`ALTER TABLE public.worksync_hr_requests ADD COLUMN IF NOT EXISTS requester_role TEXT`);
  await query(`
    ALTER TABLE public.worksync_hr_requests
    ADD COLUMN IF NOT EXISTS approval_stage TEXT NOT NULL DEFAULT 'Admin'
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_worksync_hr_requests_reviewer
    ON public.worksync_hr_requests (approval_stage, status, submitted_at DESC)
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
  // Existing databases predate Half Day; provision it idempotently without changing reports.
  await query(`
    INSERT INTO hr.attendancestatuses (statuscode, statusname, countsaspresent)
    VALUES ('Half Day', 'Half Day', TRUE)
    ON CONFLICT (statuscode) DO NOTHING
  `);
};

const formatDate = (value: string | Date): string =>
  new Date(value).toISOString().split('T')[0];
const formatDateTime = (value: string | Date): string =>
  new Date(value).toISOString().replace('T', ' ').substring(0, 16);
const parseDetails = (details: HRRequestRow['details']): HRRequestDetails =>
  typeof details === 'string' ? JSON.parse(details) : details || {};
export const validateNotPastDate = (date: string, today: string): string | null =>
  date < today ? 'Leave date cannot be in the past.' : null;
const effectiveBusinessDate = async (): Promise<string> => {
  const result = await query<{ today: string }>('SELECT CURRENT_DATE::text AS today');
  return result.rows[0].today;
};
export const mapHRRequestRow = (row: HRRequestRow) => ({
  id: row.id,
  userId: row.user_id,
  userName: row.user_name || undefined,
  requesterRole: row.requester_role || undefined,
  type: row.request_type,
  date: formatDate(row.request_date),
  reason: row.reason,
  status: row.status,
  approvalStage: row.approval_stage,
  details: parseDetails(row.details),
  submittedAt: formatDateTime(row.submitted_at),
  decidedBy: row.decided_by || undefined,
  decisionReason: row.decision_reason || undefined
});

const loadAttendanceSnapshot = async (
  userId: string,
  date: string
): Promise<{ checkIn: string; checkOut: string }> => {
  const result = await query<{ checkin: string; checkout: string }>(
    `SELECT COALESCE(to_char(ar.actualcheckinatutc AT TIME ZONE COALESCE(profile.timezoneid, o.timezoneid, $3), 'HH24:MI'), '') AS checkin,
            COALESCE(to_char(ar.actualcheckoutatutc AT TIME ZONE COALESCE(profile.timezoneid, o.timezoneid, $3), 'HH24:MI'), '') AS checkout
       FROM hr.attendancerecords ar
       JOIN iam.users u ON u.userid = ar.userid
       JOIN org.organizations o ON o.organizationid = u.organizationid
       LEFT JOIN iam.userprofiles profile ON profile.userid = u.userid
      WHERE ar.userid = $1 AND ar.workdate = $2::date`,
    [toUserPk(userId), date, DEFAULT_BUSINESS_TIME_ZONE]
  );
  return {
    checkIn: result.rows[0]?.checkin || '',
    checkOut: result.rows[0]?.checkout || ''
  };
};

// Reviewers receive only their stage. Requesters retain read access to their own history.
router.get('/', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }
    await ensureTable();
    const effectiveRole = attendanceRole(await getEffectiveRoles(req.user.id));
    let result;
    if (effectiveRole === 'Admin') {
      result = await query<HRRequestRow>(
        `SELECT * FROM public.worksync_hr_requests
          WHERE approval_stage = 'Admin'
          ORDER BY submitted_at DESC`
      );
    } else if (effectiveRole === 'HR') {
      result = await query<HRRequestRow>(
        `SELECT * FROM public.worksync_hr_requests
          WHERE user_id = $1
             OR (approval_stage = 'HR' AND user_id <> $1)
          ORDER BY submitted_at DESC`,
        [req.user.id]
      );
    } else {
      result = await query<HRRequestRow>(
        `SELECT * FROM public.worksync_hr_requests
          WHERE user_id = $1
          ORDER BY submitted_at DESC`,
        [req.user.id]
      );
    }
    res.json({ success: true, requests: result.rows.map(mapHRRequestRow) });
  } catch (error: any) {
    console.error('[HR Requests Load Error]', error?.stack || error?.message || error);
    res.status(500).json({ success: false, message: 'Failed to load approval requests.' });
  }
});

router.post('/', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }
    const { userName, type, date, reason, details } = req.body as {
      userName?: string;
      type?: RequestType;
      date?: string;
      reason?: string;
      details?: HRRequestDetails;
    };
    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (!type || !allowedTypes.includes(type) || !cleanReason) {
      res.status(400).json({ success: false, message: 'A valid request type and reason are required.' });
      return;
    }
    const effectiveRole = attendanceRole(await getEffectiveRoles(req.user.id));
    if (effectiveRole === 'Admin') {
      res.status(403).json({ success: false, message: 'Admins do not submit attendance approval requests.' });
      return;
    }
    if (type === 'Leave' && !['Full Day Leave', 'Half Day Leave'].includes(details?.leaveType || '')) {
      res.status(400).json({ success: false, message: 'A valid leave type is required.' });
      return;
    }
    if (type === 'Leave' && details?.leaveType === 'Half Day Leave' &&
        details.leavePeriod !== undefined &&
        !['First Half', 'Second Half'].includes(details.leavePeriod)) {
      res.status(400).json({ success: false, message: 'A valid half-day leave period is required.' });
      return;
    }
    const requestDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
    if (!requestDate) {
      res.status(400).json({ success: false, message: 'A valid request date is required.' });
      return;
    }
    if (type === 'Leave') {
      const dateError = validateNotPastDate(requestDate, await effectiveBusinessDate());
      if (dateError) {
        res.status(400).json({ success: false, message: dateError });
        return;
      }
    }
    await ensureTable();
    const pending = await query(
      `SELECT 1 FROM public.worksync_hr_requests
        WHERE user_id = $1 AND request_type = $2 AND request_date = $3::date AND status = 'Pending'`,
      [req.user.id, type, requestDate]
    );
    if (pending.rowCount) {
      res.status(409).json({ success: false, message: `A pending ${type.toLowerCase()} request already exists for this date.` });
      return;
    }

    const cleanDetails: HRRequestDetails = { ...(details || {}) };
    if (type === 'Leave' && cleanDetails.leaveType === 'Half Day Leave' && !cleanDetails.leavePeriod) {
      cleanDetails.leavePeriod = 'Second Half';
    }
    if (type === 'Leave') {
      const existingLeave = await query<{ request_date: string | Date; details: HRRequestDetails | string }>(
        `SELECT request_date, details
           FROM public.worksync_hr_requests
          WHERE user_id = $1 AND request_type = 'Leave' AND status IN ('Pending', 'Approved')`,
        [req.user.id]
      );
      const existingWindows: LeaveWindow[] = existingLeave.rows.map((row) => {
        const existingDetails = parseDetails(row.details);
        return {
          date: formatDate(row.request_date),
          leaveType: existingDetails.leaveType || 'Full Day Leave',
          leavePeriod: existingDetails.leavePeriod,
          leaveDays: existingDetails.leaveDays
        };
      });
      const overlapError = validateLeaveOverlap({
        date: requestDate,
        leaveType: cleanDetails.leaveType!,
        leavePeriod: cleanDetails.leavePeriod,
        leaveDays: cleanDetails.leaveDays
      }, existingWindows);
      if (overlapError) {
        res.status(409).json({ success: false, message: overlapError });
        return;
      }
    }
    if (type === 'Correction') {
      const attendance = await query<{ active: boolean }>(
        `SELECT (actualcheckinatutc IS NOT NULL AND actualcheckoutatutc IS NULL) AS active
           FROM hr.attendancerecords
          WHERE userid = $1 AND workdate = $2::date`,
        [toUserPk(req.user.id), requestDate]
      );
      if (!attendance.rowCount) {
        res.status(404).json({ success: false, message: 'Attendance record not found.' });
        return;
      }
      if (attendance.rows[0].active) {
        res.status(409).json({
          success: false,
          message: 'Active attendance sessions cannot be corrected. Check out first.'
        });
        return;
      }
      const correctionError = validateCorrectionValues({
        checkIn: cleanDetails.requestedCheckIn,
        checkOut: cleanDetails.requestedCheckOut,
        breaks: cleanDetails.requestedBreaks || [],
        completed: true
      });
      if (correctionError) {
        res.status(400).json({ success: false, message: correctionError });
        return;
      }
      const current = await loadAttendanceSnapshot(req.user.id, requestDate);
      cleanDetails.currentCheckIn = current.checkIn;
      cleanDetails.currentCheckOut = current.checkOut;
      const breaks = await query<{ breaks: unknown[] | string }>(
        `SELECT breaks FROM public.worksync_attendance_breaks WHERE user_id = $1 AND work_date = $2::date`,
        [req.user.id, requestDate]
      );
      const currentBreaks = breaks.rows[0]?.breaks;
      cleanDetails.currentBreaks = typeof currentBreaks === 'string'
        ? JSON.parse(currentBreaks)
        : currentBreaks || [];
      if (current.checkIn === cleanDetails.requestedCheckIn &&
          current.checkOut === (cleanDetails.requestedCheckOut || '') &&
          JSON.stringify(cleanDetails.currentBreaks) === JSON.stringify(cleanDetails.requestedBreaks || [])) {
        res.status(400).json({ success: false, message: 'No attendance changes were supplied.' });
        return;
      }
    }

    const requesterAttendanceRole = effectiveRole === 'HR' ? 'HR' : 'Team_Member';
    const approvalStage = getInitialApprovalStage(type, requesterAttendanceRole);
    const id = `hrq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const result = await query<HRRequestRow>(
      `INSERT INTO public.worksync_hr_requests (
         id, user_id, user_name, requester_role, request_type, request_date,
         reason, status, approval_stage, details, submitted_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'Pending', $8, $9::jsonb, NOW())
       RETURNING *`,
      [
        id,
        req.user.id,
        typeof userName === 'string' ? userName.trim() : null,
        requesterAttendanceRole,
        type,
        requestDate,
        cleanReason,
        approvalStage,
        JSON.stringify(cleanDetails)
      ]
    );

    if (type === 'Leave') {
      const actorName = typeof userName === 'string' ? userName.trim() : req.user.email;
      recordActivitySafe({
        actorId: req.user.id,
        actorName,
        actorEmail: req.user.email,
        actorRole: req.user.role,
        action: 'Leave Requested',
        module: 'Attendance',
        entityType: 'Leave',
        entityId: id,
        entityName: `Leave ${requestDate}`,
        description: `${actorName} requested leave for ${requestDate}.`,
        source: 'Web',
      });
    }

    res.status(201).json({
      success: true,
      message: `${type === 'Leave' ? 'Leave' : 'Attendance edit'} request submitted successfully.`,
      request: mapHRRequestRow(result.rows[0])
    });
  } catch (error: any) {
    console.error('[HR Request Create Error]', error?.stack || error?.message || error);
    res.status(500).json({ success: false, message: 'Failed to submit approval request.' });
  }
});

const applyCorrection = async (
  runQuery: typeof query,
  row: HRRequestRow
): Promise<void> => {
  const details = parseDetails(row.details);
  const validationError = validateCorrectionValues({
    checkIn: details.requestedCheckIn,
    checkOut: details.requestedCheckOut,
    breaks: details.requestedBreaks || [],
    completed: true
  });
  if (validationError) throw Object.assign(new Error(validationError), { statusCode: 400 });
  const breakMinutes = totalCorrectionBreakMinutes(
    (details.requestedBreaks || []) as Array<{ startTime?: unknown; endTime?: unknown }>
  );
  const date = formatDate(row.request_date);
  const scheduleResult = await runQuery<{
    scheduledstarttime: string | null;
    scheduledendtime: string | null;
    graceminutes: number;
    timezoneid: string;
  }>(
    `SELECT scheduledstarttime::text, scheduledendtime::text,
            COALESCE(ws.graceminutes, 0)::int AS graceminutes,
            COALESCE(profile.timezoneid, o.timezoneid, $3) AS timezoneid
       FROM hr.attendancerecords ar
       JOIN iam.users u ON u.userid = ar.userid
       JOIN org.organizations o ON o.organizationid = u.organizationid
       LEFT JOIN iam.userprofiles profile ON profile.userid = u.userid
       LEFT JOIN hr.workschedules ws ON ws.workscheduleid = ar.workscheduleid
      WHERE ar.userid = $1 AND ar.workdate = $2::date`,
    [toUserPk(row.user_id), date, DEFAULT_BUSINESS_TIME_ZONE]
  );
  const schedule = scheduleResult.rows[0];
  const instants = await runQuery<{ checkinutc: Date; checkoututc: Date; scheduledstartutc: Date | null }>(
    `SELECT (($1::date + $2::time) AT TIME ZONE $5) AS checkinutc,
            (($1::date + $3::time) AT TIME ZONE $5) AS checkoututc,
            CASE WHEN NULLIF($4, '') IS NULL THEN NULL
                 ELSE (($1::date + $4::time) AT TIME ZONE $5) END AS scheduledstartutc`,
    [date, details.requestedCheckIn, details.requestedCheckOut, schedule?.scheduledstarttime || '', schedule?.timezoneid || DEFAULT_BUSINESS_TIME_ZONE]
  );
  const checkInUtc = new Date(instants.rows[0].checkinutc);
  const checkOutUtc = new Date(instants.rows[0].checkoututc);
  const scheduledStartUtc = instants.rows[0].scheduledstartutc ? new Date(instants.rows[0].scheduledstartutc!) : null;
  const scheduledMinutes = schedule?.scheduledstarttime && schedule?.scheduledendtime
    ? Math.max(
        1,
        Math.floor((
          new Date(`${date}T${schedule.scheduledendtime}Z`).getTime() -
          new Date(`${date}T${schedule.scheduledstarttime}Z`).getTime()
        ) / 60000)
      )
    : 480;
  const outcome = calculateAttendanceOutcome({
    checkInUtc,
    checkOutUtc,
    scheduledStartUtc,
    scheduledMinutes,
    graceMinutes: schedule?.graceminutes || 0,
    breakSeconds: breakMinutes * 60
  });
  const result = await runQuery<{ attendancerecordid: number }>(
    `UPDATE hr.attendancerecords
        SET actualcheckinatutc = ($2::date + $3::time) AT TIME ZONE $8,
            actualcheckoutatutc = ($2::date + $4::time) AT TIME ZONE $8,
            workingminutes = $5,
            lateminutes = $6,
            attendancestatusid = (
              SELECT attendancestatusid FROM hr.attendancestatuses
               WHERE statuscode = $7
            ),
            sourcecode = 'HRCorrection',
            updatedatutc = CURRENT_TIMESTAMP
      WHERE userid = $1 AND workdate = $2::date
        AND NOT (actualcheckinatutc IS NOT NULL AND actualcheckoutatutc IS NULL)
      RETURNING attendancerecordid`,
    [
      toUserPk(row.user_id),
      formatDate(row.request_date),
      details.requestedCheckIn,
      details.requestedCheckOut,
      outcome.workingMinutes,
      outcome.lateMinutes,
      outcome.status,
      schedule?.timezoneid || DEFAULT_BUSINESS_TIME_ZONE
    ]
  );
  if (!result.rows[0]) {
    throw Object.assign(
      new Error('Active attendance sessions cannot be corrected. The employee must check out first.'),
      { statusCode: 409 }
    );
  }
  await runQuery(
    `INSERT INTO public.worksync_attendance_breaks (user_id, work_date, breaks, updated_at)
     VALUES ($1, $2::date, $3::jsonb, NOW())
     ON CONFLICT (user_id, work_date) DO UPDATE SET breaks = EXCLUDED.breaks, updated_at = NOW()`,
    [row.user_id, formatDate(row.request_date), JSON.stringify(details.requestedBreaks || [])]
  );
};

const applyLeave = async (
  runQuery: typeof query,
  row: HRRequestRow
): Promise<void> => {
  const details = parseDetails(row.details);
  const statusCode = details.leaveType === 'Half Day Leave' ? 'Half Day' : 'Leave';
  await runQuery(
    `INSERT INTO hr.attendancerecords
       (userid, workdate, attendancestatusid, workingminutes, sourcecode, updatedatutc)
     VALUES ($1, $2::date,
       (SELECT attendancestatusid FROM hr.attendancestatuses WHERE statuscode = $3),
       0, 'HRCorrection', CURRENT_TIMESTAMP)
     ON CONFLICT (userid, workdate) DO UPDATE SET
       attendancestatusid = EXCLUDED.attendancestatusid,
       workingminutes = CASE WHEN $3 = 'Leave' THEN 0 ELSE hr.attendancerecords.workingminutes END,
       sourcecode = 'HRCorrection',
       updatedatutc = CURRENT_TIMESTAMP`,
    [toUserPk(row.user_id), formatDate(row.request_date), statusCode]
  );
};

const decideRequest = async (
  req: AuthenticatedRequest,
  res: Response,
  decision: 'Approved' | 'Rejected'
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated.' });
    return;
  }
  const decisionReason = typeof req.body.decisionReason === 'string' ? req.body.decisionReason.trim() : '';
  if (decision === 'Rejected' && !decisionReason) {
    res.status(400).json({ success: false, message: 'A rejection reason is required.' });
    return;
  }
  await ensureTable();

  try {
    const updated = await withTransaction(async (runQuery) => {
      const locked = await runQuery<HRRequestRow>(
        `SELECT * FROM public.worksync_hr_requests WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const row = locked.rows[0];
      if (!row) throw Object.assign(new Error('Approval request not found.'), { statusCode: 404 });
      if (row.status !== 'Pending') {
        throw Object.assign(new Error('This request is no longer pending.'), { statusCode: 409 });
      }
      if (row.user_id === req.user!.id) {
        throw Object.assign(new Error('You cannot approve your own request.'), { statusCode: 403 });
      }
      const reviewer = attendanceRole(await getEffectiveRoles(req.user!.id));
      const authorized = canReviewRequestStage(row.request_type, row.approval_stage, reviewer);
      if (!authorized) {
        throw Object.assign(new Error(`Only ${row.approval_stage} can decide this request.`), { statusCode: 403 });
      }

      const forwardLeaveToAdmin =
        decision === 'Approved' && row.request_type === 'Leave' && row.approval_stage === 'HR';
      if (decision === 'Approved' && row.request_type === 'Leave') {
        const details = parseDetails(row.details);
        const approvedRows = await runQuery<{ request_date: string | Date; details: HRRequestDetails | string }>(
          `SELECT request_date, details
             FROM public.worksync_hr_requests
            WHERE user_id = $1 AND request_type = 'Leave' AND status = 'Approved' AND id <> $2`,
          [row.user_id, row.id]
        );
        const overlapError = validateLeaveOverlap({
          date: formatDate(row.request_date),
          leaveType: details.leaveType || 'Full Day Leave',
          leavePeriod: details.leavePeriod,
          leaveDays: details.leaveDays
        }, approvedRows.rows.map((existing) => {
          const existingDetails = parseDetails(existing.details);
          return {
            date: formatDate(existing.request_date),
            leaveType: existingDetails.leaveType || 'Full Day Leave',
            leavePeriod: existingDetails.leavePeriod,
            leaveDays: existingDetails.leaveDays
          };
        }));
        if (overlapError) throw Object.assign(new Error(overlapError), { statusCode: 409 });
      }
      if (decision === 'Approved' && !forwardLeaveToAdmin) {
        if (row.request_type === 'Correction') await applyCorrection(runQuery, row);
        if (row.request_type === 'Leave') await applyLeave(runQuery, row);
      }
      const final = await runQuery<HRRequestRow>(
        `UPDATE public.worksync_hr_requests
            SET status = $2,
                approval_stage = $3,
                decided_by = CASE WHEN $2 = 'Pending' THEN NULL ELSE $4 END,
                decision_reason = CASE WHEN $2 = 'Pending' THEN NULL ELSE $5 END,
                decided_at = CASE WHEN $2 = 'Pending' THEN NULL ELSE NOW() END
          WHERE id = $1
          RETURNING *`,
        [
          row.id,
          forwardLeaveToAdmin ? 'Pending' : decision,
          forwardLeaveToAdmin ? 'Admin' : row.approval_stage,
          req.user!.id,
          decisionReason || null
        ]
      );
      return final.rows[0];
    });
    res.json({
      success: true,
      forwarded: updated.status === 'Pending' && updated.approval_stage === 'Admin',
      message: updated.status === 'Pending'
        ? 'Leave request approved by HR and forwarded to Admin.'
        : `Request ${decision.toLowerCase()} successfully.`,
      request: mapHRRequestRow(updated)
    });

    if (updated.status !== 'Pending') {
      const requesterName = updated.user_name || updated.user_id;
      const deciderName = userStore.findById(req.user.id)?.name || req.user.email;
      const requestDateStr = formatDate(updated.request_date);
      if (updated.request_type === 'Leave') {
        const leaveDetails = parseDetails(updated.details);
        const leaveLabel = leaveDetails.leaveType === 'Half Day Leave'
          ? `Half Day (${leaveDetails.leavePeriod || 'Second Half'})`
          : 'Full Day';
        recordActivitySafe({
          actorId: req.user.id,
          actorName: deciderName,
          actorEmail: req.user.email,
          actorRole: req.user.role,
          affectedUserId: updated.user_id,
          affectedUserName: requesterName,
          action: decision === 'Approved' ? 'Leave Approved' : 'Leave Rejected',
          module: 'Attendance',
          entityType: 'Leave',
          entityId: updated.id,
          entityName: `Leave ${requestDateStr}`,
          description: decision === 'Approved'
            ? `${deciderName} approved ${leaveLabel} leave request for ${requesterName} on ${requestDateStr}.`
            : `${deciderName} rejected ${leaveLabel} leave request for ${requesterName} on ${requestDateStr}.`,
          source: 'Web',
          important: true,
          reason: decisionReason || undefined,
        });
      } else if (updated.request_type === 'Correction') {
        recordActivitySafe({
          actorId: req.user.id,
          actorName: deciderName,
          actorEmail: req.user.email,
          actorRole: req.user.role,
          affectedUserId: updated.user_id,
          affectedUserName: requesterName,
          action: decision === 'Approved' ? 'Attendance Corrected' : 'Rejected',
          module: 'Attendance',
          entityType: 'Attendance',
          entityId: updated.id,
          entityName: `Attendance ${requestDateStr}`,
          description: decision === 'Approved'
            ? `${deciderName} approved attendance correction for ${requesterName} on ${requestDateStr}.`
            : `${deciderName} rejected attendance correction for ${requesterName} on ${requestDateStr}.`,
          source: 'Web',
          important: true,
          reason: decisionReason || undefined,
        });
      }
    }
  } catch (error: any) {
    const statusCode = Number(error?.statusCode) || 500;
    if (statusCode === 500) console.error('[HR Request Decision Error]', error);
    res.status(statusCode).json({ success: false, message: error?.message || 'Failed to decide request.' });
  }
};

router.patch('/:id/approve', authenticateJWT, (req, res) => void decideRequest(req, res, 'Approved'));
router.patch('/:id/reject', authenticateJWT, (req, res) => void decideRequest(req, res, 'Rejected'));

export default router;
