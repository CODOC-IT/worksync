import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import * as service from './projectApproval.service.js';

// Controller = thin HTTP adapter, matching project.controller.ts's layering. No SQL, no
// authorization decisions here -- those are projectApproval.service.ts's job.

const requireUser = (req: AuthenticatedRequest, res: Response): { id: string; role: string } | null => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated.' });
    return null;
  }
  return req.user;
};

const handleServiceError = (error: unknown, res: Response, fallback: string): void => {
  if (error instanceof service.ProjectNotFoundError) {
    res.status(404).json({ success: false, message: error.message });
  } else if (error instanceof service.ProjectAuthorizationError) {
    res.status(403).json({ success: false, message: error.message });
  } else if (error instanceof service.ProjectValidationError) {
    res.status(400).json({ success: false, message: error.message });
  } else {
    console.error('[projectApproval.controller]', error);
    res.status(500).json({ success: false, message: (error as Error)?.message || fallback });
  }
};

// GET /api/projects/approval-requests -- Admin's Approval Inbox (all Pending requests).
export const listPending = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const rawStatus = typeof req.query.status === 'string' ? req.query.status : undefined;
    const status = rawStatus === 'Pending' || rawStatus === 'Approved' || rawStatus === 'Rejected' ? rawStatus : undefined;
    const data = await service.listApprovalsForAdmin(user.role, status);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load pending approval requests.');
  }
};

export const changeSetup = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.changePendingSetup(req.params.id, req.body || {}, user.id, user.role);
    res.json({ success: true, message: 'Setup saved. The request remains pending.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to save setup.');
  }
};

// GET /api/projects/approval-requests/mine -- the calling Team Lead's own submitted requests
// (any status), so they can see what's pending/approved/rejected.
export const listMine = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.listMyApprovalRequests(user.id);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load your approval requests.');
  }
};

const decide = async (req: AuthenticatedRequest, res: Response, decision: 'Approved' | 'Rejected'): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  const { reason } = (req.body || {}) as { reason?: string };
  if (decision === 'Rejected' && !reason?.trim()) {
    res.status(400).json({ success: false, message: 'A rejection reason is required.' });
    return;
  }
  try {
    const data = await service.decideApprovalRequest(req.params.id, decision, user.id, user.role, reason || null);
    res.json({
      success: true,
      message: decision === 'Approved' ? 'Request approved and applied.' : 'Request rejected.',
      data
    });
  } catch (error) {
    handleServiceError(error, res, `Failed to ${decision === 'Approved' ? 'approve' : 'reject'} the request.`);
  }
};

// PATCH /api/projects/approval-requests/:id/approve
export const approve = (req: AuthenticatedRequest, res: Response): void => {
  void decide(req, res, 'Approved');
};

// PATCH /api/projects/approval-requests/:id/reject
export const reject = (req: AuthenticatedRequest, res: Response): void => {
  void decide(req, res, 'Rejected');
};
