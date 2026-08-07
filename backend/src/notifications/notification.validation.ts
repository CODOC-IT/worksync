import { NotificationEvent, NotificationPreferencesDTO } from './notification.types.js';

export interface ValidationResult {
  valid: boolean;
  message?: string;
}

const FRONTEND_ID_PATTERN = /^(usr|prj|tsk)-\d+$/;

export const validatePublishEventBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') {
    return { valid: false, message: 'Request body is required.' };
  }
  const event = body as Partial<NotificationEvent>;

  if (!event.type || typeof event.type !== 'string') {
    return { valid: false, message: 'type is required.' };
  }
  if (!event.title || typeof event.title !== 'string' || !event.title.trim()) {
    return { valid: false, message: 'title is required.' };
  }
  if (!event.message || typeof event.message !== 'string' || !event.message.trim()) {
    return { valid: false, message: 'message is required.' };
  }
  if (!Array.isArray(event.recipientIds) || event.recipientIds.length === 0) {
    return { valid: false, message: 'recipientIds must be a non-empty array.' };
  }
  if (!event.recipientIds.every((id) => typeof id === 'string' && /^usr-\d+$/.test(id))) {
    return { valid: false, message: 'Every recipientId must look like "usr-<n>".' };
  }
  if (event.actorId && !/^usr-\d+$/.test(event.actorId)) {
    return { valid: false, message: 'actorId must look like "usr-<n>".' };
  }
  if (event.projectId && !/^prj-\d+$/.test(event.projectId)) {
    return { valid: false, message: 'projectId must look like "prj-<n>".' };
  }
  if (event.taskId && !/^tsk-\d+$/.test(event.taskId)) {
    return { valid: false, message: 'taskId must look like "tsk-<n>".' };
  }
  if (event.priority && !['Critical', 'High', 'Normal', 'Low'].includes(event.priority)) {
    return { valid: false, message: 'priority must be one of Critical, High, Normal, Low.' };
  }
  // Optional expanded-detail payload (see NotificationEvent.detail/metadata). `detail` is free
  // text; `metadata` is a flat label/value bag rendered verbatim in the expanded view, so nested
  // objects/arrays are rejected rather than silently stringified into "[object Object]".
  if (event.detail !== undefined && typeof event.detail !== 'string') {
    return { valid: false, message: 'detail must be a string.' };
  }
  if (event.metadata !== undefined) {
    if (typeof event.metadata !== 'object' || event.metadata === null || Array.isArray(event.metadata)) {
      return { valid: false, message: 'metadata must be an object.' };
    }
    for (const [key, value] of Object.entries(event.metadata)) {
      if (!['string', 'number', 'boolean'].includes(typeof value)) {
        return { valid: false, message: `metadata."${key}" must be a string, number, or boolean.` };
      }
    }
  }

  return { valid: true };
};

export const validatePreferencesBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') {
    return { valid: false, message: 'Request body is required.' };
  }
  const data = body as Partial<NotificationPreferencesDTO>;
  const booleanKeys: (keyof NotificationPreferencesDTO)[] = [
    'toast', 'inApp', 'dueReminders', 'mentions', 'comments', 'assignments', 'email'
  ];
  for (const key of Object.keys(data)) {
    if (!booleanKeys.includes(key as keyof NotificationPreferencesDTO)) {
      return { valid: false, message: `Unknown preference key: "${key}".` };
    }
    if (typeof data[key as keyof NotificationPreferencesDTO] !== 'boolean') {
      return { valid: false, message: `Preference "${key}" must be a boolean.` };
    }
  }
  return { valid: true };
};

export const isValidFrontendId = (value: string): boolean => FRONTEND_ID_PATTERN.test(value);

export const validateSnoozeBody = (body: unknown): ValidationResult => {
  if (!body || typeof body !== 'object') {
    return { valid: false, message: 'Request body is required.' };
  }
  const { until } = body as { until?: unknown };
  if (!until || typeof until !== 'string') {
    return { valid: false, message: '"until" (an ISO date string) is required.' };
  }
  const parsed = new Date(until);
  if (Number.isNaN(parsed.getTime())) {
    return { valid: false, message: '"until" must be a valid date.' };
  }
  if (parsed.getTime() <= Date.now()) {
    return { valid: false, message: '"until" must be in the future.' };
  }
  return { valid: true };
};
