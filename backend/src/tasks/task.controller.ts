import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import * as service from './task.service.js';
import { createTaskApprovalRequest } from '../projects/projectApproval.service.js';
import {
  validateChangeStatusBody,
  validateCreateTaskBody,
  validateRejectDecisionBody,
  validateReopenBody,
  validateReviewDecisionBody,
  validateUpdateTaskBody
} from './task.validation.js';
import {
  ApiTaskStatus,
  ChangeStatusInput,
  CreateTaskInput,
  SubtaskReviewDecisionInput,
  TaskEditApprovalInput,
  UpdateTaskInput
} from './task.types.js';

// Controller = thin HTTP adapter (matches backend/src/notifications / backend/src/projects).

const requireUser = (req: AuthenticatedRequest, res: Response): { id: string; role: string } | null => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated.' });
    return null;
  }
  return req.user;
};

const handleServiceError = (error: unknown, res: Response, fallback: string): void => {
  if (error instanceof service.TaskNotFoundError) {
    res.status(404).json({ success: false, message: error.message });
  } else if (error instanceof service.TaskAuthorizationError) {
    res.status(403).json({ success: false, message: error.message });
  } else if (error instanceof service.TaskValidationError) {
    res.status(400).json({ success: false, message: error.message });
  } else {
    console.error('[task.controller]', error);
    res.status(500).json({ success: false, message: (error as Error)?.message || fallback });
  }
};

export const listTasks = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const archived = req.query.archived === 'true';
    const data = await service.listTasksForUser(user.id, user.role, projectId, archived);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load tasks.');
  }
};

export const getTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.getTaskForUser(req.params.id, user.id, user.role);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load task.');
  }
};

export const createTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateCreateTaskBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message, fieldErrors: validation.fieldErrors });
    return;
  }

  try {
    if (user.role !== 'Admin') {
      const data = await createTaskApprovalRequest(req.body as CreateTaskInput, user.id, user.role);
      res.status(202).json({ success: true, message: 'Task submitted for Admin approval.', data, pendingApproval: true });
      return;
    }
    const data = await service.createTask(req.body as CreateTaskInput, user.id, user.role);
    res.status(201).json({ success: true, message: 'Task created successfully.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to create task.');
  }
};

export const updateTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateUpdateTaskBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  try {
    const data = await service.updateTask(req.params.id, req.body as UpdateTaskInput, user.id, user.role);
    res.json({ success: true, message: 'Task updated successfully.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to update task.');
  }
};

export const deleteTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    await service.deleteTask(req.params.id, user.id, user.role);
    res.json({ success: true, message: 'Task deleted successfully.' });
  } catch (error) {
    handleServiceError(error, res, 'Failed to delete task.');
  }
};

export const changeStatus = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateChangeStatusBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  try {
    const data = await service.changeTaskStatus(req.params.id, req.body as ChangeStatusInput, user.id, user.role);
    res.json({ success: true, message: 'Task status updated successfully.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to update task status.');
  }
};

// PATCH /api/tasks/:id/reopen — the only route out of Done (Team Lead only, reason mandatory).
export const reopenTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateReopenBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  try {
    const { status, reason } = req.body as { status: ApiTaskStatus; reason: string };
    const data = await service.reopenTask(req.params.id, { status, reason }, user.id, user.role);
    res.json({ success: true, message: `Task reopened to ${status}.`, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to reopen task.');
  }
};

export const approveTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateReviewDecisionBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  try {
    const { note } = req.body as { note: string };
    const data = await service.approveTask(req.params.id, note, user.id, user.role);
    res.json({ success: true, message: 'Task approved and marked Done.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to approve task.');
  }
};

export const rejectTask = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateRejectDecisionBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  try {
    const { note, subtaskDecisions } = req.body as { note: string; subtaskDecisions?: SubtaskReviewDecisionInput[] };
    const data = await service.rejectTask(req.params.id, note, user.id, user.role, subtaskDecisions);
    res.json({ success: true, message: 'Task rejected and returned to In Progress.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to reject task.');
  }
};

export const getHistory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.getTaskHistory(req.params.id, user.id, user.role);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load task history.');
  }
};

export const createTaskEditApproval = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.createTaskEditApproval(
      req.params.id,
      req.body as TaskEditApprovalInput,
      user.id,
      user.role
    );
    res.status(201).json({ success: true, message: 'Task update requested.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to submit task update request.');
  }
};

export const listTaskEditApprovals = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.listTaskEditApprovals(user.id, user.role);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load task update requests.');
  }
};

export const decideTaskEditApproval = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  const decision = req.body?.decision;
  if (decision !== 'Approved' && decision !== 'Rejected') {
    res.status(400).json({ success: false, message: 'Decision must be Approved or Rejected.' });
    return;
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (decision === 'Rejected' && !reason) {
    res.status(400).json({ success: false, message: 'A rejection reason is required.' });
    return;
  }
  try {
    const data = await service.decideTaskEditApproval(req.params.approvalId, decision, user.id, user.role, reason || undefined);
    res.json({ success: true, message: `Task update ${decision.toLowerCase()}.`, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to decide task update request.');
  }
};

export const requestSubtaskTransfer = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  const toTeamId = req.body?.toTeamId;
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (!toTeamId || typeof toTeamId !== 'string' || !/^tm-\d+$/.test(toTeamId)) {
    res.status(400).json({ success: false, message: 'toTeamId must look like "tm-<n>".' });
    return;
  }
  try {
    const data = await service.requestSubtaskTransfer(req.params.id, toTeamId, reason, user.id, user.role);
    res.status(201).json({ success: true, message: 'Subtask transfer requested for Admin approval.', data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to request subtask transfer.');
  }
};

export const listSubtaskTransfers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.listPendingSubtaskTransfers(user.role);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load subtask transfer requests.');
  }
};

export const decideSubtaskTransfer = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  const decision = req.body?.decision;
  if (decision !== 'Approved' && decision !== 'Rejected') {
    res.status(400).json({ success: false, message: 'Decision must be Approved or Rejected.' });
    return;
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
  if (decision === 'Rejected' && !reason) {
    res.status(400).json({ success: false, message: 'A rejection reason is required.' });
    return;
  }
  try {
    const data = await service.decideSubtaskTransfer(
      req.params.requestId, decision, reason || null, user.id, user.role
    );
    res.json({ success: true, message: `Subtask transfer ${decision.toLowerCase()}.`, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to decide subtask transfer request.');
  }
};
