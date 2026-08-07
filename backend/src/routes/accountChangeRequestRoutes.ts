import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { query, withTransaction } from '../db/pool.js';
import { userStore, updateSupabaseAuthEmail } from '../store/userStore.js';
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

export const sanitizeAccountRequestedChanges = (
  changes: Record<string, string>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(changes).filter(([key]) =>
      !/(password|password_hash|current_password_verified|secret|token|credential)/i.test(key)
    )
  );

const mapRow = (row: AccountChangeRequestRow) => {
  const changes = parseChanges(row.requested_changes);
  const passwordChangeRequested = row.requested_field === 'password' ||
    Object.keys(changes).some((key) => /password/i.test(key));
  const displayChanges = sanitizeAccountRequestedChanges(changes);
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
    decidedAt: row.decided_at ? formatDateTime(row.decided_at) : undefined,
  };
};

export const canReviewAccountChangeRequest = (
  reviewerId: string,
  reviewerRole: string,
  request: Pick<AccountChangeRequestRow, 'user_id' | 'assigned_approver_role' | 'status'>
): boolean =>
  request.status === 'Pending' &&
  request.user_id !== reviewerId &&
  request.assigned_approver_role === reviewerRole &&
  (reviewerRole === 'Admin' || reviewerRole === 'HR');

export const cleanRejectionReason = (reason: unknown): string => {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('A rejection reason is required.');
  }
  const cleaned = reason.trim();
  if (cleaned.length > 1000) throw new Error('Rejection reason must not exceed 1000 characters.');
  return cleaned;
};

export const getApprovedProfileChange = (
  field: string | null,
  changes: Record<string, string>
): { field: 'name' | 'email' | 'username'; value: string } => {
  if (field === 'password') {
    throw new Error('Password approval requires the secure password completion flow. No password change was applied.');
  }
  if (field !== 'name' && field !== 'email' && field !== 'username') {
    throw new Error('This request does not contain a supported profile change.');
  }
  const value = changes[field]?.trim();
  if (!value) throw new Error('The requested profile value is missing.');
  return { field, value };
};

export const buildAccountReviewMessages = (
  action: ReviewAction,
  reviewerName: string,
  requesterName: string,
  field: string,
  rejectionReason?: string
) => ({
  notification: action === 'Rejected'
    ? `Your account change request was rejected. Reason: ${rejectionReason}`
    : 'Your account change request was approved.',
  activity: `${reviewerName} ${action.toLowerCase()} ${requesterName}'s account ${field} change request.`,
});

export const shouldApplyAccountProfileChange = (action: ReviewAction): boolean =>
  action === 'Approved';

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

    const allUsers = await userStore.getAllUsers();
    const user = allUsers.find((u) => u.id === req.user.id);
    if (!user) {
      res.status(404).json({ success: false, message: 'User profile not found.' });
      return;
    }
    const userPk = toUserPk(req.user.id);
    const requesterName = user.name || req.user.email;

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

type ReviewAction = 'Approved' | 'Rejected';

class ReviewError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

const reviewRequest = async (
  req: AuthenticatedRequest,
  res: Response,
  action: ReviewAction
): Promise<void> => {
  try {
    if (!req.user) throw new ReviewError(401, 'Not authenticated.');

    const decisionReason = action === 'Rejected'
      ? cleanRejectionReason(req.body?.reason)
      : undefined;

    await ensureTable();
    let approvedProfileChange: ReturnType<typeof getApprovedProfileChange> | undefined;
    const reviewed = await withTransaction(async (runQuery) => {
      const selected = await runQuery<AccountChangeRequestRow>(
        `SELECT * FROM public.worksync_account_change_requests
         WHERE id = $1
         FOR UPDATE`,
        [req.params.id]
      );
      const request = selected.rows[0];
      if (!request) throw new ReviewError(404, 'Account change request not found.');
      if (request.status !== 'Pending') {
        throw new ReviewError(409, 'This account change request has already been reviewed.');
      }
      if (request.user_id === req.user!.id) {
        throw new ReviewError(403, 'You cannot review your own account change request.');
      }
      if (!canReviewAccountChangeRequest(req.user!.id, req.user!.role, request)) {
        throw new ReviewError(403, 'Only the assigned approver can review this account change request.');
      }

      if (shouldApplyAccountProfileChange(action)) {
        const changes = parseChanges(request.requested_changes);
        try {
          approvedProfileChange = getApprovedProfileChange(request.requested_field, changes);
        } catch (error: any) {
          throw new ReviewError(request.requested_field === 'password' ? 409 : 400, error.message);
        }
        const { field, value } = approvedProfileChange;
        const userPk = toUserPk(request.user_id);

        if (field === 'name') {
          const sanitizedName = value.replace(/<[^>]*>/g, '').trim();
          if (sanitizedName.length < 2 || sanitizedName.length > 170) {
            throw new ReviewError(400, 'The requested display name is invalid.');
          }
          const [givenName, ...familyParts] = sanitizedName.split(/\s+/);
          await runQuery(
            `UPDATE iam.users
             SET displayname = $1, givenname = $2, familyname = $3, updatedatutc = CURRENT_TIMESTAMP
             WHERE userid = $4 AND organizationid = 1`,
            [sanitizedName, givenName, familyParts.join(' ') || givenName, userPk]
          );
        } else if (field === 'email') {
          const normalizedEmail = value.toLowerCase();
          if (!emailPattern.test(normalizedEmail) || normalizedEmail.length > 254) {
            throw new ReviewError(400, 'The requested email address is invalid.');
          }
          const duplicate = await runQuery<{ exists: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM iam.users
               WHERE organizationid = 1 AND lower(email) = $1 AND userid <> $2
             ) AS exists`,
            [normalizedEmail, userPk]
          );
          if (duplicate.rows[0]?.exists) {
            throw new ReviewError(409, 'An account already exists for the requested email.');
          }
          await runQuery(
            `UPDATE iam.users SET email = $1, updatedatutc = CURRENT_TIMESTAMP
             WHERE userid = $2 AND organizationid = 1`,
            [normalizedEmail, userPk]
          );
        } else {
          const normalizedUsername = value.toLowerCase();
          if (!usernamePattern.test(normalizedUsername)) {
            throw new ReviewError(400, 'The requested username is invalid.');
          }
          const duplicate = await runQuery<{ exists: boolean }>(
            `SELECT EXISTS (
               SELECT 1 FROM iam.users
               WHERE organizationid = 1 AND lower(username) = $1 AND userid <> $2
             ) AS exists`,
            [normalizedUsername, userPk]
          );
          if (duplicate.rows[0]?.exists) {
            throw new ReviewError(409, 'The requested username is already in use.');
          }
          await runQuery(
            `UPDATE iam.users SET username = $1, updatedatutc = CURRENT_TIMESTAMP
             WHERE userid = $2 AND organizationid = 1`,
            [normalizedUsername, userPk]
          );
        }
      }

      const updated = await runQuery<AccountChangeRequestRow>(
        `UPDATE public.worksync_account_change_requests
         SET status = $2, decided_by = $3, decision_reason = $4, decided_at = NOW()
         WHERE id = $1 AND status = 'Pending'
         RETURNING *`,
        [request.id, action, req.user!.id, decisionReason || null]
      );
      if (!updated.rows[0]) {
        throw new ReviewError(409, 'This account change request has already been reviewed.');
      }
      return updated.rows[0];
    });

    if (shouldApplyAccountProfileChange(action)) {
      // Keep the Supabase Auth identity's email in sync when the iam.users email is approved,
      // otherwise the requester still signs in with the old email.
      if (approvedProfileChange?.field === 'email') {
        const authRow = await query<{ authuserid: string | null }>(
          'SELECT authuserid FROM iam.users WHERE userid = $1 AND organizationid = 1',
          [toUserPk(reviewed.user_id)]
        );
        if (authRow.rows[0]?.authuserid) {
          await updateSupabaseAuthEmail(authRow.rows[0].authuserid, approvedProfileChange.value.toLowerCase());
        }
      }
      await userStore.refreshUserFromDb(reviewed.user_id);
    }

    const requesterName = reviewed.user_name || 'Requester';
    const reviewer = userStore.findById(req.user.id);
    const field = reviewed.requested_field || 'profile';
    const reviewMessages = buildAccountReviewMessages(
      action,
      reviewer?.name || req.user.email,
      requesterName,
      field,
      decisionReason
    );

    await notificationService.publishEvent({
      type: 'approval',
      title: `Account Change Request ${action}`,
      message: reviewMessages.notification,
      recipientIds: [reviewed.user_id],
      actorId: req.user.id,
    }).catch((error) => {
      console.error('[accountChangeRequest] Failed to notify requester of review.', error);
    });

    recordActivitySafe({
      actorId: req.user.id,
      actorName: reviewer?.name || req.user.email,
      actorEmail: req.user.email,
      actorRole: req.user.role,
      affectedUserId: reviewed.user_id,
      affectedUserName: requesterName,
      action,
      module: 'Profile',
      entityType: 'Account Change Request',
      entityId: reviewed.id,
      entityName: requesterName,
      description: reviewMessages.activity,
      reason: decisionReason,
      linkRoute: 'approvals',
      metadata: { requestedField: field },
    });

    res.json({
      success: true,
      message: `Account change request ${action.toLowerCase()} successfully.`,
      request: mapRow(reviewed),
    });
  } catch (error: any) {
    if (error instanceof ReviewError) {
      res.status(error.statusCode).json({ success: false, message: error.message });
      return;
    }
    if (error?.code === '23505') {
      res.status(409).json({ success: false, message: 'The requested account value is already in use.' });
      return;
    }
    console.error('[Account Change Request Review Error]', error?.stack || error?.message || error);
    res.status(500).json({ success: false, message: `Failed to review account change request.` });
  }
};

router.patch('/:id/approve', authenticateJWT, (req, res) => reviewRequest(req, res, 'Approved'));
router.patch('/:id/reject', authenticateJWT, (req, res) => reviewRequest(req, res, 'Rejected'));

export default router;
