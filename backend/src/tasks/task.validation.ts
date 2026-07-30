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

const SUBTASK_TITLE_PATTERN = /^.{1,200}$/;

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
  if (input.subtasks !== undefined) {
    if (!Array.isArray(input.subtasks) || input.subtasks.length > 10) {
      fieldErrors.subtasks = 'Add between 1 and 10 subtasks.';
    } else {
      input.subtasks.forEach((subtask, index) => {
        const prefix = `subtasks.${index}`;
        if (!subtask || typeof subtask !== 'object' || !subtask.title?.trim()) fieldErrors[`${prefix}.title`] = 'Enter a subtask title.';
        if (!subtask || typeof subtask !== 'object' || !subtask.description?.trim()) fieldErrors[`${prefix}.description`] = 'Enter a subtask description.';
        if (!subtask || !isValidIsoDate(subtask.startDate)) fieldErrors[`${prefix}.startDate`] = 'Select a valid start date.';
        if (!subtask || !isValidIsoDate(subtask.dueDate) || (isValidIsoDate(subtask.startDate) && subtask.dueDate < subtask.startDate)) fieldErrors[`${prefix}.dueDate`] = 'Select a valid due date.';
        if (!subtask || !VALID_PRIORITIES.has(subtask.priority)) fieldErrors[`${prefix}.priority`] = 'Select a valid priority.';
        if (!subtask || !Array.isArray(subtask.assigneeIds) || subtask.assigneeIds.length === 0 || subtask.assigneeIds.some((id) => typeof id !== 'string' || !FRONTEND_USER_ID_PATTERN.test(id))) fieldErrors[`${prefix}.assigneeIds`] = 'Select at least one assignee.';
        if (subtask?.status && !VALID_STATUSES.has(subtask.status)) fieldErrors[`${prefix}.status`] = 'Select a valid status.';
      });
    }
  }

  if (input.subtasks && Array.isArray(input.subtasks)) {
    for (let i = 0; i < input.subtasks.length; i++) {
      const sub = input.subtasks[i];
      if (!sub.title || typeof sub.title !== 'string' || !sub.title.trim()) {
        fieldErrors[`subtasks.${i}.title`] = 'Enter a subtask title.';
      } else if (sub.title.trim().length > 200) {
        fieldErrors[`subtasks.${i}.title`] = 'Subtask title cannot exceed 200 characters.';
      }
    }
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
  if (input.assigneeIds !== undefined) {
    return { valid: false, message: 'Task assignments cannot be changed from the assignee edit form.' };
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

// Reopen carries a `reason` rather than the `note` every other transition uses: the board
// surfaces it as a distinct, mandatory "why are you reopening this?" prompt, and keeping the
// field name different makes an accidentally-reused status-change payload fail loudly here
// instead of silently reopening a task with a note meant for something else.
const REOPEN_TARGETS = new Set(['Review', 'In Progress', 'Todo']);

export const validateReopenBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const input = body as { status?: unknown; reason?: unknown };

  if (typeof input.status !== 'string' || !REOPEN_TARGETS.has(input.status)) {
    return { valid: false, message: 'status must be one of Review, In Progress, Todo.' };
  }
  if (typeof input.reason !== 'string' || !input.reason.trim()) {
    return { valid: false, message: 'A reason is required to reopen a completed task.' };
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
