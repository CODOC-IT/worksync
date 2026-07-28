import { isDatabaseConfigured } from '../db/pool.js';
import { fromProjectPk, fromTaskPk, fromUserPk } from '../utils/idMapping.js';
import { userStore } from '../store/userStore.js';
import * as repo from './activity.repository.js';
import { ActivityDTO, ActivityFilters, ActivityRecordInput } from './activity.types.js';

const SENSITIVE_FIELD = /(password|secret|token|cookie|credential|authorization|api.?key|session)/i;

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

export const recordActivity = async (input: ActivityRecordInput): Promise<string | null> => {
  if (!isDatabaseConfigured()) return null;
  const safeChanges = (input.changes || []).filter((change) => !SENSITIVE_FIELD.test(change.field));
  const safeMetadata = Object.fromEntries(Object.entries(input.metadata || {}).filter(([key]) => !SENSITIVE_FIELD.test(key)));
  return repo.insertActivity({ ...input, changes: safeChanges, metadata: safeMetadata });
};

export const recordActivitySafe = (input: ActivityRecordInput): void => {
  recordActivity(input).catch((error) => console.warn('[activity] Audit write failed.', error));
};

export const listActivities = async (filters: ActivityFilters, viewerId: string, viewerRole: string) => {
  if (!isDatabaseConfigured()) return { items: [], page: filters.page, pageSize: filters.pageSize, total: 0, totalPages: 1 };
  const { rows, total } = await repo.findActivities(filters, viewerId, viewerRole);
  const changes = await repo.findChanges(rows.map((row) => String(row.auditeventid)));
  return {
    items: rows.map((row) => toDto(row, changes.get(String(row.auditeventid)) || [])),
    page: filters.page, pageSize: filters.pageSize, total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize))
  };
};

export const getActivity = async (id: string, viewerId: string, viewerRole: string): Promise<ActivityDTO | null> => {
  if (!isDatabaseConfigured()) return null;
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
