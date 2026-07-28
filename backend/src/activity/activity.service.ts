import { isDatabaseConfigured } from '../db/pool.js';
import { fromProjectPk, fromTaskPk, fromUserPk } from '../utils/idMapping.js';
import { userStore } from '../store/userStore.js';
import * as repo from './activity.repository.js';
import { ActivityChange, ActivityDTO, ActivityFilters, ActivityRecordInput } from './activity.types.js';

const SENSITIVE_FIELD = /(password|secret|token|cookie|credential|authorization|api.?key|session)/i;

type StoredEvent = {
  id: string; correlationId: string; occurredAt: Date;
  actor: { id: string | null; name: string; email: string; avatar?: string; role: string };
  affectedUser?: { id: string | null; name: string }; action: string; module: string;
  entityType: string; entityId: string; entityName: string; description: string;
  project?: { id: string; name: string }; task?: { id: string; name: string };
  result: string; source: string; important: boolean; reason?: string;
  linkRoute?: string; ipAddress?: string; changes: ActivityChange[];
  metadata: Record<string, unknown>;
};

const memStore: StoredEvent[] = [];

const toDto = (row: repo.ActivityRow, changes: ActivityDTO['changes']): ActivityDTO => {
  const knownUser = row.actoruserid ? userStore.findById(fromUserPk(row.actoruserid)) : undefined;
  return {
    id: String(row.auditeventid), correlationId: row.correlationid,
    actor: {
      id: row.actoruserid ? fromUserPk(row.actoruserid) : null,
      name: row.actornamesnapshot || knownUser?.name || 'System',
      email: row.actoremailsnapshot || knownUser?.email || '',
      avatar: knownUser?.avatar,
      role: row.actorrolesnapshot || knownUser?.role || 'System'
    },
    affectedUser: row.affecteduseridtext || row.affectedusernamesnapshot ? {
      id: row.affecteduseridtext, name: row.affectedusernamesnapshot || row.affecteduseridtext || 'Unknown user'
    } : undefined,
    action: row.actioncode, module: row.modulecode, entityType: row.entitytypecode,
    entityId: row.entityidtext, entityName: row.entitynamesnapshot || row.entityidtext,
    description: row.description || `${row.actioncode} ${row.entitytypecode}`,
    project: row.projectid ? { id: fromProjectPk(row.projectid), name: row.projectnamesnapshot || fromProjectPk(row.projectid) } : undefined,
    task: row.taskid ? { id: fromTaskPk(row.taskid), name: row.tasknamesnapshot || fromTaskPk(row.taskid) } : undefined,
    timestamp: new Date(row.occurredatutc).toISOString(), result: row.resultcode,
    source: row.sourcecode, important: row.isimportant, reason: row.reason || undefined,
    linkRoute: row.linkroute || undefined, ipAddress: row.ipaddress || undefined,
    changes, metadata: row.metadatajson || {},
    isNew: Date.now() - new Date(row.occurredatutc).getTime() < 5 * 60 * 1000
  };
};

const memToDto = (event: StoredEvent): ActivityDTO => ({
  id: event.id, correlationId: event.correlationId, actor: event.actor,
  affectedUser: event.affectedUser, action: event.action, module: event.module,
  entityType: event.entityType, entityId: event.entityId, entityName: event.entityName,
  description: event.description, project: event.project, task: event.task,
  timestamp: event.occurredAt.toISOString(),
  result: event.result as ActivityDTO['result'], source: event.source as ActivityDTO['source'],
  important: event.important, reason: event.reason, linkRoute: event.linkRoute,
  ipAddress: event.ipAddress, changes: event.changes, metadata: event.metadata,
  isNew: Date.now() - event.occurredAt.getTime() < 5 * 60 * 1000
});

export const recordActivity = async (input: ActivityRecordInput): Promise<string | null> => {
  const safeChanges = (input.changes || []).filter((change) => !SENSITIVE_FIELD.test(change.field));
  const safeMetadata = Object.fromEntries(Object.entries(input.metadata || {}).filter(([key]) => !SENSITIVE_FIELD.test(key)));
  if (!isDatabaseConfigured()) {
    const event: StoredEvent = {
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      correlationId: input.correlationId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      occurredAt: new Date(),
      actor: {
        id: input.actorId || null, name: input.actorName || 'System',
        email: input.actorEmail || '', role: input.actorRole || 'System'
      },
      affectedUser: input.affectedUserId || input.affectedUserName ? {
        id: input.affectedUserId, name: input.affectedUserName || 'Unknown'
      } : undefined,
      action: input.action, module: input.module, entityType: input.entityType,
      entityId: input.entityId, entityName: input.entityName || input.entityId,
      description: input.description,
      project: input.projectId ? { id: input.projectId, name: input.projectName || input.projectId } : undefined,
      task: input.taskId ? { id: input.taskId, name: input.taskName || input.taskId } : undefined,
      result: input.result || 'Successful', source: input.source || 'API',
      important: Boolean(input.important), reason: input.reason || undefined,
      linkRoute: input.linkRoute || undefined, ipAddress: input.ipAddress || undefined,
      changes: safeChanges, metadata: safeMetadata
    };
    memStore.push(event);
    if (memStore.length > 500) memStore.shift();
    return event.id;
  }
  return repo.insertActivity({ ...input, changes: safeChanges, metadata: safeMetadata });
};

export const recordActivitySafe = (input: ActivityRecordInput): void => {
  recordActivity(input).catch((error) => console.warn('[activity] Audit write failed.', error));
};

const matchesFilters = (event: StoredEvent, filters: ActivityFilters, viewerId: string, viewerRole: string): boolean => {
  if (viewerRole !== 'Admin' && viewerRole !== 'HR') return true;
  if (filters.module && event.module !== filters.module) return false;
  if (filters.action && event.action !== filters.action) return false;
  if (filters.result && event.result !== filters.result) return false;
  if (filters.source && event.source !== filters.source) return false;
  if (filters.userId && event.actor.id !== filters.userId) return false;
  if (filters.projectId && event.project?.id !== filters.projectId) return false;
  if (filters.taskId && event.task?.id !== filters.taskId) return false;
  if (filters.search) {
    const q = filters.search.toLowerCase();
    if (!event.actor.name.toLowerCase().includes(q) && !event.description.toLowerCase().includes(q) &&
        !event.entityName.toLowerCase().includes(q) && !event.entityId.toLowerCase().includes(q)) return false;
  }
  if (filters.myActivityOnly && event.actor.id !== viewerId) return false;
  if (filters.importantOnly && !event.important) return false;
  if (filters.from && event.occurredAt < new Date(filters.from)) return false;
  if (filters.to && event.occurredAt > new Date(filters.to)) return false;
  return true;
};

export const listActivities = async (filters: ActivityFilters, viewerId: string, viewerRole: string) => {
  if (!isDatabaseConfigured()) {
    const filtered = memStore.filter((event) => matchesFilters(event, filters, viewerId, viewerRole));
    const sorted = filters.sort === 'oldest' ? filtered : [...filtered].reverse();
    const start = (filters.page - 1) * filters.pageSize;
    const items = sorted.slice(start, start + filters.pageSize).map(memToDto);
    return { items, page: filters.page, pageSize: filters.pageSize, total: filtered.length, totalPages: Math.max(1, Math.ceil(filtered.length / filters.pageSize)) };
  }
  const { rows, total } = await repo.findActivities(filters, viewerId, viewerRole);
  const changes = await repo.findChanges(rows.map((row) => String(row.auditeventid)));
  return {
    items: rows.map((row) => toDto(row, changes.get(String(row.auditeventid)) || [])),
    page: filters.page, pageSize: filters.pageSize, total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize))
  };
};

export const getActivity = async (id: string, viewerId: string, viewerRole: string): Promise<ActivityDTO | null> => {
  if (!isDatabaseConfigured()) {
    const event = memStore.find((e) => e.id === id);
    return event ? memToDto(event) : null;
  }
  const row = await repo.findVisibleActivityById(id, viewerId, viewerRole);
  if (!row) return null;
  const changes = await repo.findChanges([String(row.auditeventid)]);
  return toDto(row, changes.get(String(row.auditeventid)) || []);
};

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
export const exportCsv = async (filters: ActivityFilters, viewerId: string, viewerRole: string): Promise<string> => {
  if (viewerRole !== 'Admin') throw new Error('Only administrators can export audit logs.');
  const result = await listActivities({ ...filters, page: 1, pageSize: 5000 }, viewerId, viewerRole);
  const filterSummary = JSON.stringify(Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '')));
  const lines = [
    ['Exported At UTC', new Date().toISOString()].map(csvCell).join(','),
    ['Active Filters', filterSummary].map(csvCell).join(','), '',
    ['Event ID','Timestamp UTC','Actor','Email','Role','Action','Module','Entity Type','Entity ID','Entity','Project','Task','Result','Source','Description','Changes'].map(csvCell).join(',')
  ];
  for (const item of result.items) {
    lines.push([
      item.id, item.timestamp, item.actor.name, item.actor.email, item.actor.role, item.action,
      item.module, item.entityType, item.entityId, item.entityName, item.project?.name,
      item.task?.name, item.result, item.source, item.description,
      item.changes.map((c) => `${c.field}: ${c.previousValue ?? '—'} -> ${c.newValue ?? '—'}`).join('; ')
    ].map(csvCell).join(','));
  }
  recordActivitySafe({
    actorId: viewerId, actorName: userStore.findById(viewerId)?.name, actorRole: viewerRole,
    action: 'Exported', module: 'Activity Log', entityType: 'Audit Export', entityId: `export-${Date.now()}`,
    entityName: 'Filtered activity log CSV', description: `${userStore.findById(viewerId)?.name || 'Admin'} exported ${result.total} audit events.`,
    important: true, metadata: { exportedCount: result.total, filters: filterSummary }
  });
  return lines.join('\r\n');
};
