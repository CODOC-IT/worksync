import { ActivityFilters } from './activity.types.js';

const one = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const bool = (value: unknown): boolean => value === 'true' || value === true;

export const parseActivityFilters = (query: Record<string, unknown>): ActivityFilters => ({
  from: one(query.from), to: one(query.to), userId: one(query.userId), userRole: one(query.userRole),
  projectId: one(query.projectId), taskId: one(query.taskId), module: one(query.module),
  action: one(query.action), entityType: one(query.entityType), status: one(query.status),
  priority: one(query.priority), result: one(query.result) as ActivityFilters['result'],
  source: one(query.source) as ActivityFilters['source'], search: one(query.search),
  changedField: one(query.changedField), myActivityOnly: bool(query.myActivityOnly),
  importantOnly: bool(query.importantOnly), hasAttachments: bool(query.hasAttachments),
  hasMentions: bool(query.hasMentions), deletedOnly: bool(query.deletedOnly),
  failedOrBlockedOnly: bool(query.failedOrBlockedOnly), sort: query.sort === 'oldest' ? 'oldest' : 'newest',
  page: Math.max(1, Number(query.page) || 1), pageSize: Math.min(100, Math.max(1, Number(query.pageSize) || 20))
});

