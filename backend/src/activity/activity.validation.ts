import { ActivityFilters, ActivityResult, ActivitySource } from './activity.types.js';
import { toProjectPk, toTaskPk, toUserPk } from '../utils/idMapping.js';

export class ActivityFilterValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ActivityFilterValidationError';
  }
}

const one = (value: unknown, name: string, maxLength = 200): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new ActivityFilterValidationError(`${name} must be a single string value.`);
  }
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > maxLength) {
    throw new ActivityFilterValidationError(`${name} must not exceed ${maxLength} characters.`);
  }
  return normalized;
};

const bool = (value: unknown, name: string): boolean => {
  if (value === undefined || value === null || value === '' || value === false || value === 'false') return false;
  if (value === true || value === 'true') return true;
  throw new ActivityFilterValidationError(`${name} must be true or false.`);
};

const integer = (value: unknown, name: string, fallback: number): number => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !/^-?\d+$/.test(value.trim())) {
    throw new ActivityFilterValidationError(`${name} must be an integer.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new ActivityFilterValidationError(`${name} is outside the supported integer range.`);
  }
  return parsed;
};

const mappedId = (
  value: unknown,
  name: string,
  mapper: (id: string) => number
): string | undefined => {
  const normalized = one(value, name, 100);
  if (!normalized) return undefined;
  try {
    mapper(normalized);
    return normalized;
  } catch {
    throw new ActivityFilterValidationError(`${name} has an invalid identifier format.`);
  }
};

const timestamp = (value: unknown, name: string): string | undefined => {
  const normalized = one(value, name, 64);
  if (!normalized) return undefined;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new ActivityFilterValidationError(`${name} must be a valid ISO date and time.`);
  }
  return parsed.toISOString();
};

const enumValue = <T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[]
): T | undefined => {
  const normalized = one(value, name, 40);
  if (!normalized) return undefined;
  if (!allowed.includes(normalized as T)) {
    throw new ActivityFilterValidationError(`${name} must be one of: ${allowed.join(', ')}.`);
  }
  return normalized as T;
};

export const parseActivityId = (value: unknown): string => {
  const id = one(value, 'Activity ID', 30);
  if (!id || !/^\d+$/.test(id)) {
    throw new ActivityFilterValidationError('Activity ID must be a positive integer.');
  }
  const numericId = BigInt(id);
  if (numericId <= 0n || numericId > 9_223_372_036_854_775_807n) {
    throw new ActivityFilterValidationError('Activity ID is outside the supported range.');
  }
  return id;
};

export const parseActivityFilters = (query: Record<string, unknown>): ActivityFilters => {
  const from = timestamp(query.from, 'from');
  const to = timestamp(query.to, 'to');
  if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
    throw new ActivityFilterValidationError('from must be earlier than or equal to to.');
  }

  const requestedPage = integer(query.page, 'page', 1);
  const requestedPageSize = integer(query.pageSize, 'pageSize', 20);
  const page = Math.max(1, requestedPage);
  const pageSize = requestedPageSize <= 0 ? 20 : Math.min(100, requestedPageSize);

  return {
    from,
    to,
    userId: mappedId(query.userId, 'userId', toUserPk),
    userRole: one(query.userRole, 'userRole', 50),
    projectId: mappedId(query.projectId, 'projectId', toProjectPk),
    taskId: mappedId(query.taskId, 'taskId', toTaskPk),
    module: one(query.module, 'module', 80),
    action: one(query.action, 'action', 100),
    entityType: one(query.entityType, 'entityType', 80),
    status: one(query.status, 'status', 80),
    priority: one(query.priority, 'priority', 80),
    result: enumValue<ActivityResult>(query.result, 'result', ['Successful', 'Failed', 'Blocked']),
    source: enumValue<ActivitySource>(query.source, 'source', ['Web', 'API', 'System']),
    search: one(query.search, 'search', 200),
    changedField: one(query.changedField, 'changedField', 100),
    myActivityOnly: bool(query.myActivityOnly, 'myActivityOnly'),
    importantOnly: bool(query.importantOnly, 'importantOnly'),
    hasAttachments: bool(query.hasAttachments, 'hasAttachments'),
    hasMentions: bool(query.hasMentions, 'hasMentions'),
    deletedOnly: bool(query.deletedOnly, 'deletedOnly'),
    failedOrBlockedOnly: bool(query.failedOrBlockedOnly, 'failedOrBlockedOnly'),
    hrActivityOnly: bool(query.hrActivityOnly, 'hrActivityOnly'),
    sort: enumValue(query.sort, 'sort', ['newest', 'oldest'] as const) || 'newest',
    page,
    pageSize,
  };
};
