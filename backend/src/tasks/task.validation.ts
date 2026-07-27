import { ChangeStatusInput, CreateTaskInput, UpdateTaskInput } from './task.types.js';

export interface ValidationResult {
  valid: boolean;
  message?: string;
  fieldErrors?: Record<string, string>;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const isValidIsoDate = (value: unknown): value is string =>
  typeof value === 'string' && ISO_DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

const VALID_PRIORITIES = new Set(['Low', 'Medium', 'High', 'Urgent']);
const VALID_STATUSES = new Set(['Todo', 'In Progress', 'Review', 'Blocked', 'Done']);
const FRONTEND_TASK_ID_PATTERN = /^tsk-\d+$/;
const FRONTEND_PROJECT_ID_PATTERN = /^prj-\d+$/;
const FRONTEND_USER_ID_PATTERN = /^usr-\d+$/;

export const validateCreateTaskBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const input = body as Partial<CreateTaskInput>;
  const fieldErrors: Record<string, string> = {};

  if (!input.projectId || !FRONTEND_PROJECT_ID_PATTERN.test(input.projectId)) {
    fieldErrors.projectId = 'Select a project.';
  }
  if (!input.title || typeof input.title !== 'string' || !input.title.trim()) {
    fieldErrors.title = 'Enter a task title.';
  } else if (input.title.trim().length > 200) {
    fieldErrors.title = 'Task title cannot exceed 200 characters.';
  }
  if (!input.description || typeof input.description !== 'string' || !input.description.trim()) {
    fieldErrors.description = 'Enter a task description.';
  }
  if (!input.priority || !VALID_PRIORITIES.has(input.priority)) {
    fieldErrors.priority = 'Select a valid priority.';
  }
  if (!isValidIsoDate(input.startDate)) fieldErrors.startDate = 'Select a valid start date.';
  if (!isValidIsoDate(input.dueDate)) fieldErrors.dueDate = 'Select a valid due date.';
  if (isValidIsoDate(input.startDate) && isValidIsoDate(input.dueDate) && input.dueDate! < input.startDate!) {
    fieldErrors.dueDate = 'Due date cannot be before the start date.';
  }
  if (
    !input.assigneeIds
    || !Array.isArray(input.assigneeIds)
    || input.assigneeIds.length === 0
    || input.assigneeIds.some((id) => typeof id !== 'string' || !FRONTEND_USER_ID_PATTERN.test(id))
  ) {
    fieldErrors.assigneeIds = 'Select at least one assignee.';
  }
  if (input.status && !VALID_STATUSES.has(input.status)) {
    fieldErrors.status = 'Select a valid task status.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { valid: false, message: 'Review the highlighted task fields.', fieldErrors };
  }
  return { valid: true };
};

export const validateUpdateTaskBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const input = body as Partial<UpdateTaskInput>;

  if (input.title !== undefined && (typeof input.title !== 'string' || !input.title.trim())) {
    return { valid: false, message: 'title cannot be empty.' };
  }
  if (input.description !== undefined && (typeof input.description !== 'string' || !input.description.trim())) {
    return { valid: false, message: 'description cannot be empty.' };
  }
  if (input.priority !== undefined && !VALID_PRIORITIES.has(input.priority)) {
    return { valid: false, message: 'priority must be one of Low, Medium, High, Urgent.' };
  }
  if (input.startDate !== undefined && !isValidIsoDate(input.startDate)) {
    return { valid: false, message: 'startDate must be a valid YYYY-MM-DD date.' };
  }
  if (input.dueDate !== undefined && !isValidIsoDate(input.dueDate)) {
    return { valid: false, message: 'dueDate must be a valid YYYY-MM-DD date.' };
  }
  if (
    input.assigneeIds !== undefined
    && (!Array.isArray(input.assigneeIds) || input.assigneeIds.some((id) => !FRONTEND_USER_ID_PATTERN.test(id)))
  ) {
    return { valid: false, message: 'assigneeIds must be an array of "usr-<n>" ids.' };
  }
  return { valid: true };
};

export const validateChangeStatusBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const input = body as Partial<ChangeStatusInput>;

  if (!input.status || !VALID_STATUSES.has(input.status)) {
    return { valid: false, message: 'status must be one of Todo, In Progress, Review, Blocked, Done.' };
  }
  if (!input.note || typeof input.note !== 'string' || !input.note.trim()) {
    return { valid: false, message: 'A reason (note) is required for every status change.' };
  }
  return { valid: true };
};

export const validateReviewDecisionBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const { note } = body as { note?: unknown };
  if (!note || typeof note !== 'string' || !note.trim()) {
    return { valid: false, message: 'A reason (note) is required.' };
  }
  return { valid: true };
};

export const isValidTaskId = (value: string): boolean => FRONTEND_TASK_ID_PATTERN.test(value);
