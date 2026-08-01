import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import * as service from './project.service.js';
import * as approvalService from './projectApproval.service.js';
import { getProjectUpdateApprovalType, PROJECT_ARCHIVE_APPROVAL_TYPE } from './projectApproval.routing.js';
import {
  validateCreateMilestoneBody,
  validateCreateProjectBody,
  validateCreateProjectFileBody,
  validateMemberBody,
  validateUpdateMilestoneBody,
  validateUpdateProjectBody
} from './project.validation.js';
import {
  CreateMilestoneInput,
  CreateProjectFileInput,
  CreateProjectInput,
  UpdateMilestoneInput,
  UpdateProjectInput
} from './project.types.js';

// Approval-gating for Team Leads on the five sensitive actions below (Edit/Archive/Delete/
// Restore/Permanent Delete) lives right here at the controller layer, not inside project.service.ts's
// own functions: a Team Lead's call never reaches those functions at all when gated -- it's
// redirected to projectApproval.service.ts's createApprovalRequest instead, which persists a
// Pending request and returns without touching the project. Admin calls (and Team Lead calls
// once approved, executed under the Admin's own identity by projectApproval.service.ts) are
// completely unaffected and reach project.service.ts exactly as before -- every validation rule
// already enforced there keeps working unchanged, at whichever moment the action actually runs.

// Controller = thin HTTP adapter. Every handler: read req, call the service, map the
// result/error to a response. No SQL, no authorization decisions here — those are
// project.service.ts's job (matching backend/src/notifications' layering).

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
    console.error('[project.controller]', error);
    res.status(500).json({ success: false, message: (error as Error)?.message || fallback });
  }
};

export const listProjects = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.listProjectsForUser(user.id, user.role);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load projects.');
  }
};

export const getProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.getProjectForUser(req.params.id, user.id, user.role);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load project.');
  }
};

export const createProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateCreateProjectBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  try {
    const data = await service.createProject(req.body as CreateProjectInput, user.id, user.role);
    res.status(201).json({ success: true, message: 'Project created successfully.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to create project.');
  }
};

export const updateProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateUpdateProjectBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  try {
    // Team Lead is not a separate account role -- a Team_Member becomes a project's lead only by
    // per-project assignment (see project.service.ts's isProjectLead/resolveTeamLeadUserId). The
    // gate here must reflect that: ask "is this caller the lead of *this* project", not "does
    // their account role happen to be Team_Lead or Team_Member" -- the latter routed every
    // Team_Member's call through the approval-request path even when they weren't the project's
    // lead at all.
    if (user.role !== 'Admin' && (await service.isProjectLead(req.params.id, user.id, user.role))) {
      const { reason, ...changes } = (req.body || {}) as UpdateProjectInput & { reason?: string };
      const requestType = getProjectUpdateApprovalType(changes.status);
      const data = await approvalService.createApprovalRequest(
        req.params.id, requestType, requestType === 'PROJECT_ARCHIVE' ? null : changes, reason || '', user.id, user.role
      );
      res.json({
        success: true,
        message: `Your ${requestType === 'PROJECT_ARCHIVE' ? 'archive' : 'edit'} request was submitted for Admin approval.`,
        pendingApproval: true, data
      });
      return;
    }
    const data = await service.updateProject(req.params.id, req.body as UpdateProjectInput, user.id, user.role);
    res.json({ success: true, message: 'Project updated successfully.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to update project.');
  }
};

export const archiveProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const { reason } = (req.body || {}) as { reason?: string };
  try {
    // See updateProject's comment above -- the gate is per-project leadership, not account role.
    if (user.role !== 'Admin' && (await service.isProjectLead(req.params.id, user.id, user.role))) {
      const data = await approvalService.createApprovalRequest(
        req.params.id, PROJECT_ARCHIVE_APPROVAL_TYPE, null, reason || '', user.id, user.role
      );
      res.json({
        success: true, message: 'Your archive request was submitted for Admin approval.',
        pendingApproval: true, data
      });
      return;
    }
    await service.archiveProject(req.params.id, reason || '', user.id, user.role);
    res.json({ success: true, message: 'Project archived successfully.' });
  } catch (error) {
    handleServiceError(error, res, 'Failed to archive project.');
  }
};

export const permanentlyDeleteProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    // See updateProject's comment above -- the gate is per-project leadership, not account role.
    if (user.role !== 'Admin' && (await service.isProjectLead(req.params.id, user.id, user.role))) {
      const { reason } = (req.body || {}) as { reason?: string };
      const data = await approvalService.createApprovalRequest(
        req.params.id, 'PROJECT_PERMANENT_DELETE', null, reason || '', user.id, user.role
      );
      res.json({
        success: true, message: 'Your permanent delete request was submitted for Admin approval.',
        pendingApproval: true, data
      });
      return;
    }
    await service.permanentlyDeleteProject(req.params.id, user.id, user.role);
    res.json({ success: true, message: 'Project permanently deleted.' });
  } catch (error) {
    handleServiceError(error, res, 'Failed to permanently delete project.');
  }
};

export const restoreProject = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    // See updateProject's comment above -- the gate is per-project leadership, not account role.
    if (user.role !== 'Admin' && (await service.isProjectLead(req.params.id, user.id, user.role))) {
      const { reason } = (req.body || {}) as { reason?: string };
      const data = await approvalService.createApprovalRequest(
        req.params.id, 'PROJECT_RESTORE', null, reason || '', user.id, user.role
      );
      res.json({
        success: true, message: 'Your restore request was submitted for Admin approval.',
        pendingApproval: true, data
      });
      return;
    }
    await service.restoreProject(req.params.id, user.id, user.role);
    res.json({ success: true, message: 'Project restored successfully.' });
  } catch (error) {
    handleServiceError(error, res, 'Failed to restore project.');
  }
};

export const listMembers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const directory = await service.getProjectMemberDirectoryForUser(req.params.id, user.id, user.role);
    res.json({ success: true, data: directory });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load project members.');
  }
};

export const addMember = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateMemberBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  try {
    const { userId, role } = req.body as { userId: string; role?: 'Owner' | 'TeamLead' | 'Member' | 'Reviewer' | 'Observer' };
    const data = await service.addMember(req.params.id, userId, role, user.id, user.role);
    res.status(201).json({ success: true, message: 'Member added successfully.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to add project member.');
  }
};

export const removeMember = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    const { reason } = (req.body || {}) as { reason?: string };
    const data = await service.removeMember(req.params.id, req.params.userId, reason || '', user.id, user.role);
    res.json({ success: true, message: 'Member removed successfully.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to remove project member.');
  }
};

// Milestones are never approval-gated, same as members above -- reuses assertCanManage directly
// (Admin, or this project's own lead), not the Team Lead/Admin approval-request workflow.
export const addMilestone = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateCreateMilestoneBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  try {
    const data = await service.addMilestone(req.params.id, req.body as CreateMilestoneInput, user.id, user.role);
    res.status(201).json({ success: true, message: 'Milestone added successfully.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to add milestone.');
  }
};

export const updateMilestone = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateUpdateMilestoneBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  try {
    const data = await service.updateMilestone(
      req.params.id, req.params.milestoneId, req.body as UpdateMilestoneInput, user.id, user.role
    );
    res.json({ success: true, message: 'Milestone updated successfully.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to update milestone.');
  }
};

export const deleteMilestone = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    await service.deleteMilestone(req.params.id, req.params.milestoneId, user.id, user.role);
    res.json({ success: true, message: 'Milestone deleted successfully.' });
  } catch (error) {
    handleServiceError(error, res, 'Failed to delete milestone.');
  }
};

// Attachments are never approval-gated, same as members/milestones above -- reuses
// assertCanManage directly (Admin, or this project's own lead).
export const addProjectFile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateCreateProjectFileBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  try {
    const data = await service.addProjectFile(req.params.id, req.body as CreateProjectFileInput, user.id, user.role);
    res.status(201).json({ success: true, message: 'File attached successfully.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to attach file.');
  }
};

export const removeProjectFile = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  try {
    await service.removeProjectFile(req.params.id, req.params.fileId, user.id, user.role);
    res.json({ success: true, message: 'File removed successfully.' });
  } catch (error) {
    handleServiceError(error, res, 'Failed to remove file.');
  }
};
