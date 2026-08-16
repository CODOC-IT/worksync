import {
  CreateMilestoneInput,
  CreateProjectFileInput,
  CreateProjectInput,
  UpdateMilestoneInput,
  UpdateProjectInput
} from './project.types.js';

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isValidIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const VALID_PRIORITIES = new Set(['Low', 'Medium', 'High', 'Urgent']);
const VALID_STATUSES = new Set(['Draft', 'Active', 'On Hold', 'Archived', 'Pending Approval', 'Completed']);
const FRONTEND_ID_PATTERN = /^usr-\d+$/;

export const validateCreateProjectBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const input = body as Partial<CreateProjectInput>;

  if (!input.title || typeof input.title !== 'string' || !input.title.trim()) {
    return { valid: false, message: 'title is required.' };
  }
  if (!input.description || typeof input.description !== 'string' || !input.description.trim()) {
    return { valid: false, message: 'description is required.' };
  }
  if (!input.startDate || !isValidIsoDate(input.startDate)) {
    return { valid: false, message: 'startDate must be a valid YYYY-MM-DD date.' };
  }
  if (!input.targetDate || !isValidIsoDate(input.targetDate)) {
    return { valid: false, message: 'targetDate must be a valid YYYY-MM-DD date.' };
  }
  if (input.priority && !VALID_PRIORITIES.has(input.priority)) {
    return { valid: false, message: 'priority must be one of Low, Medium, High, Urgent.' };
  }
  if (input.teamLeadId && !FRONTEND_ID_PATTERN.test(input.teamLeadId)) {
    return { valid: false, message: 'teamLeadId must look like "usr-<n>".' };
  }
  if (input.memberIds && (!Array.isArray(input.memberIds) || input.memberIds.some((id) => !FRONTEND_ID_PATTERN.test(id)))) {
    return { valid: false, message: 'memberIds must be an array of "usr-<n>" ids.' };
  }
  if (input.teams !== undefined) {
    if (!Array.isArray(input.teams)) return { valid: false, message: 'teams must be an array.' };
    for (const rawTeam of input.teams) {
      if (!rawTeam || typeof rawTeam !== 'object') return { valid: false, message: 'Each team must be an object.' };
      const team = rawTeam as {
        name?: unknown;
        description?: unknown;
        leadId?: unknown;
        memberIds?: unknown;
      };
      if (!team.name || typeof team.name !== 'string' || !team.name.trim()) {
        return { valid: false, message: 'Each team must have a name.' };
      }
      if (!team.description || typeof team.description !== 'string' || !team.description.trim()) {
        return { valid: false, message: `Team "${String(team.name)}" must have a description.` };
      }
      if (!team.leadId || typeof team.leadId !== 'string' || !FRONTEND_ID_PATTERN.test(team.leadId)) {
        return { valid: false, message: `Team "${String(team.name)}" must have a valid "usr-<n>" Team Lead.` };
      }
      if (!Array.isArray(team.memberIds) || team.memberIds.some((id) => !FRONTEND_ID_PATTERN.test(id))) {
        return { valid: false, message: `Team "${String(team.name)}" memberIds must be an array of "usr-<n>" ids.` };
      }
    }
  }
  return { valid: true };
};

export const validateUpdateProjectBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const input = body as Partial<UpdateProjectInput>;

  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim())) {
    return { valid: false, message: 'title cannot be empty.' };
  }
  if (input.description !== undefined && (typeof input.description !== 'string' || !input.description.trim())) {
    return { valid: false, message: 'description cannot be empty.' };
  }
  if (input.startDate !== undefined && !isValidIsoDate(input.startDate)) {
    return { valid: false, message: 'startDate must be a valid YYYY-MM-DD date.' };
  }
  if (input.targetDate !== undefined && !isValidIsoDate(input.targetDate)) {
    return { valid: false, message: 'targetDate must be a valid YYYY-MM-DD date.' };
  }
  if (input.priority !== undefined && !VALID_PRIORITIES.has(input.priority)) {
    return { valid: false, message: 'priority must be one of Low, Medium, High, Urgent.' };
  }
  if (input.status !== undefined && !VALID_STATUSES.has(input.status)) {
    return { valid: false, message: 'status is not a recognized project status.' };
  }
  if (input.teamLeadId !== undefined && !FRONTEND_ID_PATTERN.test(input.teamLeadId)) {
    return { valid: false, message: 'teamLeadId must look like "usr-<n>".' };
  }
  if (input.memberIds !== undefined &&
      (!Array.isArray(input.memberIds) || input.memberIds.some((id) => !FRONTEND_ID_PATTERN.test(id)))) {
    return { valid: false, message: 'memberIds must be an array of "usr-<n>" ids.' };
  }
  return { valid: true };
};

export const validateMemberBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const { userId, role } = body as { userId?: unknown; role?: unknown };
  if (!userId || typeof userId !== 'string' || !FRONTEND_ID_PATTERN.test(userId)) {
    return { valid: false, message: 'userId must look like "usr-<n>".' };
  }
  if (role !== undefined && !['Owner', 'TeamLead', 'Member', 'Reviewer', 'Observer'].includes(role as string)) {
    return { valid: false, message: 'role is not a recognized project member role.' };
  }
  return { valid: true };
};

export const validateMoveMemberBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const { userId, toTeamId } = body as { userId?: unknown; toTeamId?: unknown };
  if (!userId || typeof userId !== 'string' || !FRONTEND_ID_PATTERN.test(userId)) {
    return { valid: false, message: 'userId must look like "usr-<n>".' };
  }
  if (!toTeamId || typeof toTeamId !== 'string' || !/^tm-\d+$/.test(toTeamId)) {
    return { valid: false, message: 'toTeamId must look like "tm-<n>".' };
  }
  return { valid: true };
};

export const validateReplaceTeamLeadBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const { userId } = body as { userId?: unknown };
  if (!userId || typeof userId !== 'string' || !FRONTEND_ID_PATTERN.test(userId)) {
    return { valid: false, message: 'userId must look like "usr-<n>".' };
  }
  return { valid: true };
};

export const validateCreateMilestoneBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const input = body as Partial<CreateMilestoneInput>;

  if (!input.title || typeof input.title !== 'string' || !input.title.trim()) {
    return { valid: false, message: 'title is required.' };
  }
  if (!input.dueDate || !isValidIsoDate(input.dueDate)) {
    return { valid: false, message: 'dueDate must be a valid YYYY-MM-DD date.' };
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    return { valid: false, message: 'description must be a string.' };
  }
  return { valid: true };
};

export const validateCreateProjectFileBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const input = body as Partial<CreateProjectFileInput>;

  if (!input.name || typeof input.name !== 'string' || !input.name.trim()) {
    return { valid: false, message: 'name is required.' };
  }
  if (!input.url || typeof input.url !== 'string' || !input.url.trim()) {
    return { valid: false, message: 'url (file content) is required.' };
  }
  if (input.mimeType !== undefined && typeof input.mimeType !== 'string') {
    return { valid: false, message: 'mimeType must be a string.' };
  }
  return { valid: true };
};

export const validateUpdateMilestoneBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const input = body as Partial<UpdateMilestoneInput>;

  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim())) {
    return { valid: false, message: 'title cannot be empty.' };
  }
  if (input.dueDate !== undefined && !isValidIsoDate(input.dueDate)) {
    return { valid: false, message: 'dueDate must be a valid YYYY-MM-DD date.' };
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    return { valid: false, message: 'description must be a string.' };
  }
  return { valid: true };
};
