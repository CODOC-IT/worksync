import PDFDocument from 'pdfkit';
import { isDatabaseConfigured } from '../db/pool.js';
import { fromProjectPk, fromTaskPk, fromUserPk, toUserPk } from '../utils/idMapping.js';
import { userStore } from '../store/userStore.js';
import * as repo from './activity.repository.js';
import { getEffectiveRoles, EffectiveRoles } from './activity.rbac.js';
import { ActivityChange, ActivityDTO, ActivityFilters, ActivityRecordInput } from './activity.types.js';

const SENSITIVE_FIELD = /(password|secret|token|cookie|credential|authorization|api.?key|session)/i;
const MAX_METADATA_DEPTH = 5;
const MAX_METADATA_ARRAY_ITEMS = 100;
const MAX_METADATA_STRING_LENGTH = 2_000;

const sanitizeMetadataValue = (value: unknown, depth = 0): unknown => {
  if (depth > MAX_METADATA_DEPTH) return '[truncated]';
  if (typeof value === 'string') {
    return value.length > MAX_METADATA_STRING_LENGTH
      ? `${value.slice(0, MAX_METADATA_STRING_LENGTH)}…`
      : value;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_METADATA_ARRAY_ITEMS)
      .map((item) => sanitizeMetadataValue(item, depth + 1));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !SENSITIVE_FIELD.test(key))
        .map(([key, nestedValue]) => [key, sanitizeMetadataValue(nestedValue, depth + 1)])
    );
  }
  return value;
};

const sanitizeMetadata = (metadata: Record<string, unknown>): Record<string, unknown> =>
  sanitizeMetadataValue(metadata) as Record<string, unknown>;

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

export const recordActivity = async (input: ActivityRecordInput): Promise<string | null> => {
  const safeChanges = (input.changes || []).filter((change) => !SENSITIVE_FIELD.test(change.field));
  const safeMetadata = sanitizeMetadata(input.metadata || {});
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

const getEffectiveRolesForViewer = async (viewerId: string): Promise<EffectiveRoles> => {
  // Database role assignments are authoritative. Never widen Activity Log access using a
  // potentially stale role embedded in an older JWT.
  return getEffectiveRoles(viewerId);
};

export const listActivities = async (filters: ActivityFilters, viewerId: string, _viewerRole: string) => {
  const effectiveRoles = await getEffectiveRolesForViewer(viewerId);
  if (!isDatabaseConfigured()) {
    throw new Error('Activity Log requires a database. Database is not configured.');
  }
  const { rows, total } = await repo.findActivities(filters, effectiveRoles, viewerId);
  const changes = await repo.findChanges(rows.map((row) => String(row.auditeventid)));
  return {
    items: rows.map((row) => {
      const dto = toDto(row, changes.get(String(row.auditeventid)) || []);
      return dto;
    }),
    page: filters.page, pageSize: filters.pageSize, total,
    totalPages: Math.max(1, Math.ceil(total / filters.pageSize))
  };
};

export const getActivity = async (id: string, viewerId: string, _viewerRole: string): Promise<ActivityDTO | null> => {
  const effectiveRoles = await getEffectiveRolesForViewer(viewerId);
  if (!isDatabaseConfigured()) {
    throw new Error('Activity Log requires a database. Database is not configured.');
  }
  const row = await repo.findVisibleActivityById(id, viewerId, effectiveRoles);
  if (!row) return null;
  const changes = await repo.findChanges([String(row.auditeventid)]);
  return toDto(row, changes.get(String(row.auditeventid)) || []);
};

const EXPORT_LIMIT = 5_000;

interface ActivityExport<T> {
  content: T;
  exportedCount: number;
  total: number;
}

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

const activeFilterSummary = (filters: ActivityFilters): string => JSON.stringify(
  Object.fromEntries(
    Object.entries(filters).filter(([key, value]) =>
      !['page', 'pageSize'].includes(key)
      && value !== undefined
      && value !== ''
      && value !== false
    )
  )
);

const assertCanExport = async (viewerId: string): Promise<EffectiveRoles> => {
  const effectiveRoles = await getEffectiveRolesForViewer(viewerId);
  const canExport = effectiveRoles.permanentRole === 'Admin'
    || effectiveRoles.permanentRole === 'HR'
    || effectiveRoles.isActiveHR;
  if (!canExport) throw new Error('Only administrators and HR can export audit logs.');
  return effectiveRoles;
};

const recordExport = (
  format: 'CSV' | 'PDF',
  viewerId: string,
  viewerRole: string,
  exportedCount: number,
  total: number,
  filterSummary: string
): void => {
  const actor = userStore.findById(viewerId);
  recordActivitySafe({
    actorId: viewerId,
    actorName: actor?.name,
    actorEmail: actor?.email,
    actorRole: viewerRole,
    action: 'Exported',
    module: 'Activity Log',
    entityType: 'Audit Export',
    entityId: `export-${Date.now()}`,
    entityName: `Filtered activity log ${format}`,
    description: `${actor?.name || 'Authorized user'} exported ${exportedCount} of ${total} matching audit events as ${format}.`,
    source: 'Web',
    important: true,
    metadata: { format, exportedCount, totalMatching: total, limit: EXPORT_LIMIT, filters: filterSummary },
  });
};

export const exportCsv = async (
  filters: ActivityFilters,
  viewerId: string,
  viewerRole: string
): Promise<ActivityExport<string>> => {
  const effectiveRoles = await assertCanExport(viewerId);
  const result = await listActivities(
    { ...filters, page: 1, pageSize: EXPORT_LIMIT },
    viewerId,
    effectiveRoles.permanentRole
  );
  const filterSummary = activeFilterSummary(filters);
  const lines = [
    ['Exported At UTC', new Date().toISOString()].map(csvCell).join(','),
    ['Exported Events', result.items.length].map(csvCell).join(','),
    ['Total Matching Events', result.total].map(csvCell).join(','),
    ['Export Limit', EXPORT_LIMIT].map(csvCell).join(','),
    ['Active Filters', filterSummary].map(csvCell).join(','),
    '',
    ['Event ID','Timestamp UTC','Actor','Email','Role','Action','Module','Entity Type','Entity ID','Entity','Project','Task','Result','Source','Description','Changes'].map(csvCell).join(',')
  ];
  for (const item of result.items) {
    lines.push([
      item.id, item.timestamp, item.actor.name, item.actor.email, item.actor.role, item.action,
      item.module, item.entityType, item.entityId, item.entityName, item.project?.name,
      item.task?.name, item.result, item.source, item.description,
      item.changes.map((change) => `${change.field}: ${change.previousValue ?? '—'} -> ${change.newValue ?? '—'}`).join('; ')
    ].map(csvCell).join(','));
  }

  const exportedCount = result.items.length;
  recordExport('CSV', viewerId, effectiveRoles.permanentRole, exportedCount, result.total, filterSummary);
  return { content: lines.join('\r\n'), exportedCount, total: result.total };
};

const PDF_COLORS = {
  header: '#0a1628', rowEven: '#0d1e33', rowOdd: '#0a1628',
  border: '#1e3a5f', text: '#e2e8f0', muted: '#94a3b8', accent: '#22d3ee',
  success: '#34d399', danger: '#f87171', warning: '#fbbf24',
};

export const exportPdf = async (
  filters: ActivityFilters,
  viewerId: string,
  viewerRole: string
): Promise<ActivityExport<Buffer>> => {
  const effectiveRoles = await assertCanExport(viewerId);
  const result = await listActivities(
    { ...filters, page: 1, pageSize: EXPORT_LIMIT },
    viewerId,
    effectiveRoles.permanentRole
  );
  const filterSummary = activeFilterSummary(filters);

  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 30 });
  const buffers: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => buffers.push(chunk));

  const docHeight = doc.page.height;
  const docWidth = doc.page.width;
  const usableWidth = docWidth - 60;
  const tableTop = 70;
  const rowHeight = 18;
  const bottomMargin = 40;

  const headers = ['Event ID', 'Timestamp', 'Actor', 'Role', 'Action', 'Module', 'Entity', 'Project / Task', 'Result', 'Description'];
  const colWidths = [70, 130, 100, 55, 80, 75, 90, 110, 55, 0];
  colWidths[9] = usableWidth - colWidths.slice(0, 9).reduce((a, b) => a + b, 0);

  let pageNum = 0;
  let y = 0;

  const drawHeader = () => {
    pageNum++;
    doc.rect(0, 0, docWidth, 60).fill(PDF_COLORS.header);
    doc.fillColor(PDF_COLORS.accent).fontSize(18).font('Helvetica-Bold')
      .text('WorkSync — Activity Log Export', 30, 18);
    doc.fillColor(PDF_COLORS.muted).fontSize(8).font('Helvetica')
      .text(`Exported at: ${new Date().toISOString()}`, docWidth - 250, 22, { width: 220, align: 'right' });
    if (filterSummary !== '{}') {
      doc.fillColor(PDF_COLORS.muted).fontSize(7)
        .text(`Filters: ${filterSummary}`, 30, 44, { width: docWidth - 60 });
    }

    let x = 30;
    doc.rect(30, tableTop, usableWidth, rowHeight).fill('#1a2744');
    doc.fillColor(PDF_COLORS.accent).fontSize(7).font('Helvetica-Bold');
    headers.forEach((h, i) => {
      doc.text(h, x + 4, tableTop + 5, { width: colWidths[i] - 8, lineBreak: false });
      x += colWidths[i];
    });
    y = tableTop + rowHeight;
  };

  const drawFooter = () => {
    doc.fontSize(7).fillColor(PDF_COLORS.muted).font('Helvetica');
    doc.text(
      `Page ${pageNum} | WorkSync Audit Export | ${result.items.length} of ${result.total} matching events`,
      30, docHeight - 30,
      { width: docWidth - 60, align: 'center' }
    );
  };

  drawHeader();

  let rowNum = 0;
  for (const item of result.items) {
    if (y + rowHeight > docHeight - bottomMargin) {
      drawFooter();
      doc.addPage();
      drawHeader();
    }

    const bg = rowNum % 2 === 0 ? PDF_COLORS.rowEven : PDF_COLORS.rowOdd;
    doc.rect(30, y, usableWidth, rowHeight).fill(bg);

    let x = 34;
    const row = [
      item.id.slice(0, 8), new Date(item.timestamp).toLocaleString(),
      item.actor.name, item.actor.role.replace('_', ' '), item.action,
      item.module, `${item.entityType}: ${item.entityName}`,
      [item.project?.name, item.task?.name].filter(Boolean).join(' / ') || '—',
      item.result, item.description.slice(0, 80),
    ];
    doc.fillColor(PDF_COLORS.text).fontSize(6.5).font('Helvetica');
    row.forEach((cell, i) => {
      doc.text(cell, x, y + 5, { width: colWidths[i] - 4, lineBreak: false });
      x += colWidths[i];
    });

    y += rowHeight;
    rowNum++;
  }

  drawFooter();
  doc.end();

  const content = await new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
  });

  const exportedCount = result.items.length;
  recordExport('PDF', viewerId, effectiveRoles.permanentRole, exportedCount, result.total, filterSummary);
  return { content, exportedCount, total: result.total };
};
