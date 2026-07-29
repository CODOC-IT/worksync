import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { query } from '../db/pool.js';

interface HRRequestDetails {
  requestedCheckIn?: string;
  requestedCheckOut?: string;
  attendanceChangeReason?: string;
  leaveType?: string;
  leaveDays?: number;
  extraBreakMinutes?: number;
}

interface HRRequest {
  id: string;
  userId: string;
  userName?: string;
  type: 'Correction' | 'Leave' | 'Break_Exception';
  date: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  details: HRRequestDetails;
  submittedAt: string;
  decidedBy?: string;
  decisionReason?: string;
}

interface HRRequestRow {
  id: string;
  user_id: string;
  user_name: string | null;
  request_type: HRRequest['type'];
  request_date: string | Date;
  reason: string;
  status: HRRequest['status'];
  details: HRRequestDetails | string | null;
  submitted_at: string | Date;
  decided_by: string | null;
  decision_reason: string | null;
}

const router = Router();
const allowedTypes: HRRequest['type'][] = ['Correction', 'Leave', 'Break_Exception'];

const ensureTable = async (): Promise<void> => {
  await query(`
    CREATE TABLE IF NOT EXISTS public.worksync_hr_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT,
      request_type TEXT NOT NULL CHECK (request_type IN ('Correction', 'Leave', 'Break_Exception')),
      request_date DATE NOT NULL,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_by TEXT,
      decision_reason TEXT,
      decided_at TIMESTAMPTZ
    )
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_worksync_hr_requests_user_id
    ON public.worksync_hr_requests (user_id)
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_worksync_hr_requests_status
    ON public.worksync_hr_requests (status)
  `);
};

const formatDate = (value: string | Date): string =>
  new Date(value).toISOString().split('T')[0];

const formatDateTime = (value: string | Date): string =>
  new Date(value).toISOString().replace('T', ' ').substring(0, 16);

const mapRow = (row: HRRequestRow): HRRequest => ({
  id: row.id,
  userId: row.user_id,
  userName: row.user_name || undefined,
  type: row.request_type,
  date: formatDate(row.request_date),
  reason: row.reason,
  status: row.status,
  details:
    typeof row.details === 'string'
      ? JSON.parse(row.details)
      : row.details || {},
  submittedAt: formatDateTime(row.submitted_at),
  decidedBy: row.decided_by || undefined,
  decisionReason: row.decision_reason || undefined
});

const normalizeRole = (role: unknown): string =>
  String(role || '')
    .replace(/[\s_-]/g, '')
    .toLowerCase();

const canReviewRequests = (req: AuthenticatedRequest): boolean => {
  const role = normalizeRole(req.user?.role);

  return [
    'hr',
    'hrrepresentative',
    'admin',
    'administrator'
  ].includes(role);
};

// GET /api/hr-requests
// HR/Admin receive every request. Other users receive only their own requests.
router.get('/', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }

    await ensureTable();

    const result = canReviewRequests(req)
      ? await query<HRRequestRow>(`
          SELECT *
          FROM public.worksync_hr_requests
          ORDER BY submitted_at DESC
        `)
      : await query<HRRequestRow>(`
          SELECT *
          FROM public.worksync_hr_requests
          WHERE user_id = $1
          ORDER BY submitted_at DESC
        `, [req.user.id]);

    res.json({
      success: true,
      requests: result.rows.map(mapRow)
    });
  } catch (error: any) {
    console.error('[HR Requests Load Error]', error?.stack || error?.message || error);
    res.status(500).json({ success: false, message: 'Failed to load HR requests.' });
  }
});

// POST /api/hr-requests
router.post('/', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }

    const { userName, type, date, reason, details } = req.body;
    const cleanReason = typeof reason === 'string' ? reason.trim() : '';

    if (!allowedTypes.includes(type) || !cleanReason) {
      res.status(400).json({
        success: false,
        message: 'A valid request type and reason are required.'
      });
      return;
    }

    const requestDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
      ? date
      : new Date().toISOString().split('T')[0];
    const id = `hrq-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    await ensureTable();

    const result = await query<HRRequestRow>(`
      INSERT INTO public.worksync_hr_requests (
        id, user_id, user_name, request_type, request_date,
        reason, status, details, submitted_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, 'Pending', $7::jsonb, NOW())
      RETURNING *
    `, [
      id,
      req.user.id,
      typeof userName === 'string' ? userName.trim() : null,
      type,
      requestDate,
      cleanReason,
      JSON.stringify(details || {})
    ]);

    res.status(201).json({
      success: true,
      message: 'HR request submitted successfully.',
      request: mapRow(result.rows[0])
    });
  } catch (error: any) {
    console.error('[HR Request Create Error]', error?.stack || error?.message || error);
    res.status(500).json({ success: false, message: 'Failed to submit HR request.' });
  }
});

const decideRequest = async (
  req: AuthenticatedRequest,
  res: Response,
  status: 'Approved' | 'Rejected'
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated.' });
    return;
  }

  if (!canReviewRequests(req)) {
    res.status(403).json({ success: false, message: 'Only HR or Admin can review HR requests.' });
    return;
  }

  const decisionReason = typeof req.body.decisionReason === 'string'
    ? req.body.decisionReason.trim()
    : '';

  if (status === 'Rejected' && !decisionReason) {
    res.status(400).json({ success: false, message: 'A rejection reason is required.' });
    return;
  }

  await ensureTable();

  const result = await query<HRRequestRow>(`
    UPDATE public.worksync_hr_requests
    SET status = $1,
        decided_by = $2,
        decision_reason = $3,
        decided_at = NOW()
    WHERE id = $4
    RETURNING *
  `, [status, req.user.id, decisionReason || null, req.params.id]);

  if (result.rowCount === 0) {
    res.status(404).json({ success: false, message: 'HR request not found.' });
    return;
  }

  res.json({
    success: true,
    message: `HR request ${status.toLowerCase()} successfully.`,
    request: mapRow(result.rows[0])
  });
};

router.patch('/:id/approve', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await decideRequest(req, res, 'Approved');
  } catch (error: any) {
    console.error('[HR Request Approve Error]', error?.stack || error?.message || error);
    res.status(500).json({ success: false, message: 'Failed to approve HR request.' });
  }
});

router.patch('/:id/reject', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    await decideRequest(req, res, 'Rejected');
  } catch (error: any) {
    console.error('[HR Request Reject Error]', error?.stack || error?.message || error);
    res.status(500).json({ success: false, message: 'Failed to reject HR request.' });
  }
});

export default router;