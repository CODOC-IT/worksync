import { DiscussionType } from './discussion.types.js';

// Basic request-shape validation only (matching project.validation.ts's layering) — membership
// checks, task/project relationships, and other data-dependent rules live in
// discussion.service.ts, since they need a database round trip.

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

export const MAX_COMMENT_LENGTH = 250;
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
export const ALLOWED_ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);
export const DISCUSSION_TYPES = new Set<DiscussionType>([
  'General', 'Progress Update', 'Blocker', 'Review Feedback', 'Clarification', 'Decision'
]);

const FRONTEND_USER_ID_PATTERN = /^usr-\d+$/;
const FRONTEND_PROJECT_ID_PATTERN = /^prj-\d+$/;
const FRONTEND_TASK_ID_PATTERN = /^tsk-\d+$/;
const FRONTEND_TEAM_ID_PATTERN = /^tm-\d+$/;
const SAFE_FILE_NAME = /^[\w. -]+$/;

export const isValidAttachmentShape = (value: unknown): value is { id?: string; name: string; mimeType: string; size: number; url?: string } => {
  if (!value || typeof value !== 'object') return false;
  const attachment = value as Record<string, unknown>;
  return (
    typeof attachment.name === 'string' &&
    SAFE_FILE_NAME.test(attachment.name) &&
    typeof attachment.mimeType === 'string' &&
    ALLOWED_ATTACHMENT_TYPES.has(attachment.mimeType) &&
    typeof attachment.size === 'number' &&
    Number.isFinite(attachment.size) &&
    attachment.size > 0 &&
    attachment.size <= MAX_ATTACHMENT_SIZE &&
    (attachment.url === undefined || typeof attachment.url === 'string')
  );
};

export const validateCreateThreadBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const input = body as Record<string, unknown>;

  if (typeof input.projectId !== 'string' || !FRONTEND_PROJECT_ID_PATTERN.test(input.projectId)) {
    return { valid: false, message: 'Select a valid project.' };
  }
  if (input.taskId !== undefined && (typeof input.taskId !== 'string' || !FRONTEND_TASK_ID_PATTERN.test(input.taskId))) {
    return { valid: false, message: 'Select a valid task.' };
  }
  if (input.teamId !== undefined && (typeof input.teamId !== 'string' || !FRONTEND_TEAM_ID_PATTERN.test(input.teamId))) {
    return { valid: false, message: 'Select a valid team.' };
  }
  if (input.taskId !== undefined && input.teamId !== undefined) {
    return { valid: false, message: 'A discussion can be scoped to a task or a team, not both.' };
  }
  if (typeof input.title !== 'string' || !input.title.trim() || input.title.trim().length > 200) {
    return { valid: false, message: 'Enter a discussion title of up to 200 characters.' };
  }
  if (typeof input.type !== 'string' || !DISCUSSION_TYPES.has(input.type as DiscussionType)) {
    return { valid: false, message: 'Select a valid discussion type.' };
  }
  if (typeof input.body !== 'string' || !input.body.trim() || input.body.trim().length > MAX_COMMENT_LENGTH) {
    return { valid: false, message: `Enter a message of up to ${MAX_COMMENT_LENGTH} characters.` };
  }
  if (input.mentionIds !== undefined && (!Array.isArray(input.mentionIds) || input.mentionIds.some((id) => typeof id !== 'string' || !FRONTEND_USER_ID_PATTERN.test(id)))) {
    return { valid: false, message: 'Mentions must be valid user identifiers.' };
  }
  if (input.attachments !== undefined && (!Array.isArray(input.attachments) || input.attachments.some((a) => !isValidAttachmentShape(a)))) {
    return { valid: false, message: 'Each attachment must have a safe name, an allowed type, and be 10 MB or smaller.' };
  }
  return { valid: true };
};

export const validateAddCommentBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const input = body as Record<string, unknown>;

  if (typeof input.body !== 'string' || !input.body.trim() || input.body.trim().length > MAX_COMMENT_LENGTH) {
    return { valid: false, message: `Enter a reply of up to ${MAX_COMMENT_LENGTH} characters.` };
  }
  if (input.parentCommentId !== undefined && typeof input.parentCommentId !== 'string') {
    return { valid: false, message: 'Replies must reference a comment in this discussion.' };
  }
  if (input.mentionIds !== undefined && (!Array.isArray(input.mentionIds) || input.mentionIds.some((id) => typeof id !== 'string' || !FRONTEND_USER_ID_PATTERN.test(id)))) {
    return { valid: false, message: 'Mentions must be valid user identifiers.' };
  }
  if (input.attachments !== undefined && (!Array.isArray(input.attachments) || input.attachments.some((a) => !isValidAttachmentShape(a)))) {
    return { valid: false, message: 'Each attachment must have a safe name, an allowed type, and be 10 MB or smaller.' };
  }
  return { valid: true };
};

export const validateEditCommentBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') return { valid: false, message: 'Request body is required.' };
  const input = body as Record<string, unknown>;
  if (typeof input.body !== 'string' || !input.body.trim() || input.body.trim().length > MAX_COMMENT_LENGTH) {
    return { valid: false, message: `Enter a message of up to ${MAX_COMMENT_LENGTH} characters.` };
  }
  return { valid: true };
};
