import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import * as service from './project.service.js';
import { validateCreateProjectBody, validateMemberBody, validateUpdateProjectBody } from './project.validation.js';
import { CreateProjectInput, UpdateProjectInput } from './project.types.js';

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
    await service.archiveProject(req.params.id, reason || '', user.id, user.role);
    res.json({ success: true, message: 'Project archived successfully.' });
  } catch (error) {
    handleServiceError(error, res, 'Failed to archive project.');
  }
};

export const listMembers = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const project = await service.getProjectForUser(req.params.id, user.id, user.role);
    res.json({ success: true, data: { teamLeadId: project.teamLeadId, memberIds: project.memberIds } });
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
