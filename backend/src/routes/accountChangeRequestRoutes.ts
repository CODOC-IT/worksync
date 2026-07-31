import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { query } from '../db/pool.js';
import { userStore } from '../store/userStore.js';
import { toUserPk } from '../utils/idMapping.js';
import * as notificationService from '../notifications/notification.service.js';
import { recordActivitySafe } from '../activity/activity.service.js';

type RequestStatus = 'Pending' | 'Approved' | 'Rejected';

const REQUEST_FIELDS = ['name', 'email', 'username', 'password'] as const;
type RequestField = typeof REQUEST_FIELDS[number];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,79}$/i;

interface AccountChangeRequestRow {
  id: string;
  user_id: string;
  user_name: string | null;
  requester_role: string | null;
  request_type: string;
  requested_field: string | null;
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
      requested_field TEXT,
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
  await query(`ALTER TABLE public.worksync_account_change_requests ADD COLUMN IF NOT EXISTS requested_field TEXT`);
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
  const passwordChangeRequested = row.requested_field === 'password' || 'password_hash' in changes;
  const displayChanges: Record<string, string> = {};
  for (const [key, val] of Object.entries(changes)) {
    if (key === 'password_hash' || key === 'current_password_verified') continue;
    displayChanges[key] = val;
  }
  return {
    id: row.id,
    userId: row.user_id,
    userName: row.user_name || undefined,
    requesterRole: row.requester_role || undefined,
    requestType: row.request_type,
    requestedField: (row.requested_field as RequestField) || undefined,
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

    const { requestedField, requestedValue, currentPassword, reason } = req.body as {
      requestedField?: unknown;
      requestedValue?: unknown;
      currentPassword?: unknown;
      reason?: unknown;
    };

    const cleanReason = typeof reason === 'string' ? reason.trim() : '';
    if (!cleanReason) {
      res.status(400).json({ success: false, message: 'A reason is required for the change request.' });
      return;
    }

    if (!REQUEST_FIELDS.includes(requestedField as RequestField)) {
      res.status(400).json({ success: false, message: 'Select what you want to change.' });
      return;
    }
    const field = requestedField as RequestField;

    if (field !== 'password' && (typeof requestedValue !== 'string' || !requestedValue.trim())) {
      res.status(400).json({ success: false, message: 'A value is required for the requested change.' });
      return;
    }
    const requestedValueString = typeof requestedValue === 'string' ? requestedValue : '';

    const user = userStore.findById(req.user.id);
    if (!user) {
      res.status(404).json({ success: false, message: 'User profile not found.' });
      return;
    }
    const userPk = toUserPk(req.user.id);
    const requesterName = user?.name || req.user.email;

    const storedChanges: Record<string, string> = {};

    if (field === 'name') {
      const sanitizedName = requestedValueString.replace(/<[^>]*>/g, '').trim();
      if (sanitizedName.length < 2 || sanitizedName.length > 170) {
        res.status(400).json({ success: false, message: 'Display name must be between 2 and 170 characters.' });
        return;
      }
      if (sanitizedName === (user.name || '').trim()) {
        res.status(400).json({ success: false, message: 'New display name must be different from your current display name.' });
        return;
      }
      storedChanges.name = sanitizedName;
    }

    if (field === 'email') {
      const normalizedEmail = requestedValueString.replace(/<[^>]*>/g, '').trim().toLowerCase();
      if (!emailPattern.test(normalizedEmail) || normalizedEmail.length > 254) {
        res.status(400).json({ success: false, message: 'Enter a valid email address.' });
        return;
      }
      if (normalizedEmail === (user.email || '').trim().toLowerCase()) {
        res.status(400).json({ success: false, message: 'New email must be different from your current email.' });
        return;
      }
      const duplicate = await query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM iam.users
           WHERE organizationid = 1 AND lower(email) = $1 AND userid <> $2
         ) AS exists`,
        [normalizedEmail, userPk]
      );
      if (duplicate.rows[0]?.exists) {
        res.status(409).json({ success: false, message: 'An account already exists for this email.' });
        return;
      }
      storedChanges.email = normalizedEmail;
    }

    if (field === 'username') {
      const normalizedUsername = requestedValueString.replace(/<[^>]*>/g, '').trim().toLowerCase();
      if (!usernamePattern.test(normalizedUsername)) {
        res.status(400).json({ success: false, message: 'Username must be 3-80 letters, numbers, dots, hyphens, or underscores.' });
        return;
      }
      if (normalizedUsername === (user.username || '').trim().toLowerCase()) {
        res.status(400).json({ success: false, message: 'New username must be different from your current username.' });
        return;
      }
      const duplicate = await query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM iam.users
           WHERE organizationid = 1 AND lower(username) = $1 AND userid <> $2
         ) AS exists`,
        [normalizedUsername, userPk]
      );
      if (duplicate.rows[0]?.exists) {
        res.status(409).json({ success: false, message: 'This username is already in use.' });
        return;
      }
      storedChanges.username = normalizedUsername;
    }

    if (field === 'password') {
      if (typeof currentPassword !== 'string' || !currentPassword) {
        res.status(400).json({ success: false, message: 'Current password is required to request a password change.' });
        return;
      }
      if (!user.passwordHash) {
        res.status(400).json({ success: false, message: 'Current password could not be verified for this account.' });
        return;
      }
      const isValidCurrent = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isValidCurrent) {
        res.status(403).json({ success: false, message: 'Current password is incorrect.' });
        return;
      }
      storedChanges.current_password_verified = 'true';
    }

    await ensureTable();

    const approverRole = determineApproverRole(role);
    const id = `acr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    const result = await query<AccountChangeRequestRow>(
      `INSERT INTO public.worksync_account_change_requests (
         id, user_id, user_name, requester_role, request_type,
         requested_field, requested_changes, reason, status, assigned_approver_role, submitted_at
       ) VALUES ($1, $2, $3, $4, 'Account_Change', $5, $6::jsonb, $7, 'Pending', $8, NOW())
       RETURNING *`,
      [
        id,
        req.user.id,
        requesterName,
        role,
        field,
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
      description: `${requesterName} requested a change to their account ${field}.`,
      linkRoute: 'approvals',
      metadata: { requestedField: field },
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
