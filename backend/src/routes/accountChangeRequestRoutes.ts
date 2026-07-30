import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { query } from '../db/pool.js';
import { userStore } from '../store/userStore.js';
import * as notificationService from '../notifications/notification.service.js';
import { recordActivitySafe } from '../activity/activity.service.js';

type RequestStatus = 'Pending' | 'Approved' | 'Rejected';

interface AccountChangeRequestRow {
  id: string;
  user_id: string;
  user_name: string | null;
  requester_role: string | null;
  request_type: string;
  requested_changes: Record<string, string> | string | null;
  reason: string;
  status: RequestStatus;
  assigned_approver_role: string;
  submitted_at: string | Date;
  decided_by: string | null;
  decision_reason: string | null;
  decided_at: string | Date | null;
}

const router = Router();

const ensureTable = async (): Promise<void> => {
  await query(`
    CREATE TABLE IF NOT EXISTS public.worksync_account_change_requests (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT,
      requester_role TEXT,
      request_type TEXT NOT NULL DEFAULT 'Account_Change',
      requested_changes JSONB NOT NULL DEFAULT '{}'::jsonb,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected')),
      assigned_approver_role TEXT NOT NULL CHECK (assigned_approver_role IN ('Admin', 'HR')),
      submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      decided_by TEXT,
      decision_reason TEXT,
      decided_at TIMESTAMPTZ
    )
  `);
  await query(`
    CREATE INDEX IF NOT EXISTS idx_worksync_acc_req_reviewer
    ON public.worksync_account_change_requests (assigned_approver_role, status, submitted_at DESC)
  `);
};

const formatDateTime = (value: string | Date): string =>
  new Date(value).toISOString().replace('T', ' ').substring(0, 16);

const parseChanges = (changes: AccountChangeRequestRow['requested_changes']): Record<string, string> =>
  typeof changes === 'string' ? JSON.parse(changes) : changes || {};

const mapRow = (row: AccountChangeRequestRow) => {
  const changes = parseChanges(row.requested_changes);
  const passwordChangeRequested = 'password_hash' in changes;
  const displayChanges: Record<string, string> = {};
  for (const [key, val] of Object.entries(changes)) {
    if (key === 'password_hash') continue;
    displayChanges[key] = val;
  }
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || undefined,
    requesterRole: row.requester_role || undefined,
    requestType: row.request_type,
    requestedChanges: displayChanges,
    passwordChangeRequested,
    reason: row.reason,
    status: row.status,
    assignedApproverRole: row.assigned_approver_role,
    submittedAt: formatDateTime(row.submitted_at),
    decidedBy: row.decided_by || undefined,
    decisionReason: row.decision_reason || undefined,
  };
};

const determineApproverRole = (requesterRole: string): string => {
  if (requesterRole === 'HR') return 'Admin';
  return 'HR';
};

const VALID_CHANGE_FIELDS = ['name', 'username', 'email', 'password'];

const ROUTING_NOTIFY_MAP: Record<string, string[]> = {
  HR: ['Admin'],
  Team_Lead: ['HR', 'Admin'],
  Team_Member: ['HR', 'Admin'],
};

const notifyApprovers = (
  requesterRole: string,
  event: Omit<Parameters<typeof notificationService.publishEvent>[0], 'recipientIds'>
) => {
  const roleKeys = ROUTING_NOTIFY_MAP[requesterRole];
  if (!roleKeys || roleKeys.length === 0) return;

  (async () => {
    const allUsers = await userStore.getAllUsers();
    const recipientIds = allUsers
      .filter((u) => roleKeys.includes(u.role) && u.status === 'active')
      .map((u) => u.id);
    if (recipientIds.length === 0) return;

    notificationService.publishEvent({ ...event, recipientIds })
      .catch((error) => console.error('[accountChangeRequest] Failed to notify approvers.', error));
  })().catch((error) => console.error('[accountChangeRequest] Notification error.', error));
};

router.get('/', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }
    await ensureTable();

    const role = req.user.role;
    let result;

    if (role === 'Admin') {
      result = await query<AccountChangeRequestRow>(
        `SELECT * FROM public.worksync_account_change_requests
          WHERE assigned_approver_role = 'Admin'
          ORDER BY submitted_at DESC`
      );
    } else if (role === 'HR') {
      result = await query<AccountChangeRequestRow>(
        `SELECT * FROM public.worksync_account_change_requests
          WHERE user_id = $1
             OR (assigned_approver_role = 'HR' AND user_id <> $1)
          ORDER BY submitted_at DESC`,
        [req.user.id]
      );
    } else {
      result = await query<AccountChangeRequestRow>(
        `SELECT * FROM public.worksync_account_change_requests
          WHERE user_id = $1
          ORDER BY submitted_at DESC`,
        [req.user.id]
      );
    }

    res.json({ success: true, requests: result.rows.map(mapRow) });
  } catch (error: any) {
    console.error('[Account Change Request Load Error]', error?.stack || error?.message || error);
    res.status(500).json({ success: false, message: 'Failed to load account change requests.' });
  }
});

router.post('/', authenticateJWT, async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ success: false, message: 'Not authenticated.' });
      return;
    }

    const role = req.user.role;
    if (role === 'Admin') {
      res.status(403).json({ success: false, message: 'Administrators can edit their account directly. No request needed.' });
      return;
    }

    const { requestedChanges, reason } = req.body as {
      requestedChanges?: Record<string, string>;
      reason?: string;
    };

    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (!cleanReason) {
      res.status(400).json({ success: false, message: 'A reason is required for the change request.' });
      return;
    }

    if (!requestedChanges || typeof requestedChanges !== 'object' || Object.keys(requestedChanges).length === 0) {
      res.status(400).json({ success: false, message: 'At least one change must be requested.' });
      return;
    }

    const storedChanges: Record<string, string> = {};
    const changedFieldNames: string[] = [];

    for (const [field, value] of Object.entries(requestedChanges)) {
      if (!VALID_CHANGE_FIELDS.includes(field)) {
        res.status(400).json({ success: false, message: `Field "${field}" is not a valid change field.` });
        return;
      }
      if (typeof value !== 'string' || !value.trim()) {
        res.status(400).json({ success: false, message: `Field "${field}" must have a non-empty value.` });
        return;
      }
      changedFieldNames.push(field);
      if (field === 'password') {
        const hash = bcrypt.hashSync(value.trim(), 10);
        storedChanges.password_hash = hash;
      } else {
        storedChanges[field] = value.trim();
      }
    }

    await ensureTable();

    const user = userStore.findById(req.user.id);
    const requesterName = user?.name || req.user.email;

    const approverRole = determineApproverRole(role);
    const id = `acr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const result = await query<AccountChangeRequestRow>(
      `INSERT INTO public.worksync_account_change_requests (
         id, user_id, user_name, requester_role, request_type,
         requested_changes, reason, status, assigned_approver_role, submitted_at
       ) VALUES ($1, $2, $3, $4, 'Account_Change', $5::jsonb, $6, 'Pending', $7, NOW())
       RETURNING *`,
      [
        id,
        req.user.id,
        requesterName,
        role,
        JSON.stringify(storedChanges),
        cleanReason,
        approverRole,
      ]
    );

    recordActivitySafe({
      actorId: req.user.id,
      actorName: requesterName,
      actorEmail: req.user.email,
      actorRole: role,
      action: 'Requested Change',
      module: 'Profile',
      entityType: 'User',
      entityId: req.user.id,
      entityName: requesterName,
      description: `${requesterName} requested a change to their account/profile information.`,
      linkRoute: 'approvals',
      metadata: { changedFields: changedFieldNames },
    });

    notifyApprovers(role, {
      type: 'approval' as const,
      title: 'Account Change Request',
      message: `${requesterName} (${role}) has requested an account change. Review in your Approval Inbox.`,
      actorId: req.user.id,
    });

    res.status(201).json({
      success: true,
      message: 'Account change request submitted successfully. It will be reviewed by the appropriate team.',
      request: mapRow(result.rows[0]),
    });
  } catch (error: any) {
    console.error('[Account Change Request Create Error]', error?.stack || error?.message || error);
    res.status(500).json({ success: false, message: 'Failed to submit account change request.' });
  }
});

export default router;
