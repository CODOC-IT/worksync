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
  actor: { id: string | null; name: string; email: string; role: string };
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
  const actorId = row.actoruserid ? fromUserPk(row.actoruserid) : null;
  // The audit snapshot is useful for historical records, but a current IAM display name is
  // authoritative for live actors. This also fixes cold-starts where userStore has not warmed
  // its in-memory cache yet. Only actorless events should be labelled System.
  const actorName = row.actordisplayname || row.actornamesnapshot || knownUser?.name || (actorId ? actorId : 'System');
  const actorEmail = row.actoremail || row.actoremailsnapshot || knownUser?.email || '';
  return {
    id: String(row.auditeventid), correlationId: row.correlationid,
    actor: {
      id: actorId,
      name: actorName,
      email: actorEmail,
      avatar: knownUser?.avatar,
      role: row.actorrolesnapshot || knownUser?.role || (actorId ? 'Unknown' : 'System')
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

export interface ViewerScope {
  permanentRole: string;
  isActiveTeamLead: boolean;
  isActiveHR: boolean;
  isHRandTeamLead: boolean;
  leadProjectPks: number[];
  canExport: boolean;
}

export const getViewerScope = async (viewerId: string): Promise<ViewerScope> => {
  const roles = await getEffectiveRoles(viewerId);
  return {
    permanentRole: roles.permanentRole,
    isActiveTeamLead: roles.isActiveTeamLead,
    isActiveHR: roles.isActiveHR,
    isHRandTeamLead: roles.isHRandTeamLead,
    leadProjectPks: roles.leadProjectPks,
    canExport:
      roles.permanentRole === 'Admin' ||
      roles.permanentRole === 'HR' ||
      roles.isActiveHR,
  };
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

// ─── PDF colour palette (clean professional white theme) ─────────────────────
const PDF = {
  // Page
  pageBg:        '#FFFFFF',
  // Cover / header band
  brandDark:     '#0F172A',   // slate-900
  brandAccent:   '#0EA5E9',   // sky-500
  brandLight:    '#F0F9FF',   // sky-50
  // Table
  tableHeaderBg: '#1E293B',   // slate-800
  tableHeaderFg: '#F8FAFC',   // slate-50
  rowEven:       '#F8FAFC',   // slate-50
  rowOdd:        '#FFFFFF',
  rowBorder:     '#E2E8F0',   // slate-200
  // Text
  textPrimary:   '#0F172A',   // slate-900
  textSecondary: '#475569',   // slate-600
  textMuted:     '#94A3B8',   // slate-400
  // Result badges
  success:       '#15803D',   // green-700
  successBg:     '#DCFCE7',   // green-100
  danger:        '#B91C1C',   // red-700
  dangerBg:      '#FEE2E2',   // red-100
  warning:       '#B45309',   // amber-700
  warningBg:     '#FEF3C7',   // amber-100
  // Module badge
  moduleBg:      '#EFF6FF',   // blue-50
  moduleFg:      '#1D4ED8',   // blue-700
};

// Readable human date
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';

// Truncate text with ellipsis
const trunc = (text: string, maxLen: number) =>
  text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;

// Keep export cells to one physical line. Unbounded values can make PDFKit paginate while
// rendering a table cell, which turns a compact report into many nearly empty pages.
const pdfCellValue = (value: string, maxLength: number): string =>
  trunc(value.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim(), maxLength);

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
  const exportedAt = new Date();

  // ── Document setup ──────────────────────────────────────────────────────
  const doc = new PDFDocument({
    size: 'A4',
    layout: 'landscape',
    margin: 0,
    info: {
      Title: 'WorkSync Activity Log Export',
      Author: userStore.findById(viewerId)?.name || 'WorkSync',
      Subject: 'Audit Trail',
      Creator: 'WorkSync',
    },
  });
  const buffers: Buffer[] = [];
  doc.on('data', (chunk: Buffer) => buffers.push(chunk));

  const PW = doc.page.width;   // 841.89
  const PH = doc.page.height;  // 595.28
  const MARGIN   = 32;
  const CONTENT  = PW - MARGIN * 2;

  // ── Column definitions ──────────────────────────────────────────────────
  // Keep the printable report compact and readable instead of squeezing every audit field
  // into tiny columns that can overflow across pages.
  const COLS = [
    { header: 'Timestamp',      key: 'ts',      w: 112 },
    { header: 'Member',         key: 'actor',   w: 106 },
    { header: 'Action',         key: 'action',  w: 112 },
    { header: 'Project / Task', key: 'context', w: 158 },
    { header: 'Result',         key: 'result',  w: 72  },
    { header: 'Details',        key: 'details', w: 0   }, // fills remainder
  ] as const;

  // Calculate description column width
  const fixedW = COLS.slice(0, -1).reduce((s, c) => s + c.w, 0);
  const descW  = CONTENT - fixedW;

  const colWidths = [...COLS.slice(0, -1).map((c) => c.w), descW];

  const ROW_H       = 14;
  const HEADER_H    = 16;
  const BAND_H      = 44;
  const COVER_H     = 90;
  const TABLE_TOP_P1 = COVER_H + 4;
  const TABLE_TOP_PN = BAND_H + 4;
  const FOOTER_H    = 20;

  let pageNum = 0;
  let y       = 0;

  // ── Page-level helpers ──────────────────────────────────────────────────
  const drawBrandBand = (height: number) => {
    // Gradient-like effect: two rectangles
    doc.rect(0, 0, PW, height).fill(PDF.brandDark);
    doc.rect(0, height - 3, PW, 3).fill(PDF.brandAccent);
    // Logo area
    doc.fillColor(PDF.brandAccent).fontSize(13).font('Helvetica-Bold')
      .text('WorkSync', MARGIN, 10, { lineBreak: false });
    doc.fillColor(PDF.pageBg).fontSize(7).font('Helvetica')
      .text('Activity Log Export', MARGIN + 80, 13, { lineBreak: false });
    // Right: page number
    doc.fillColor(PDF.textMuted).fontSize(7).font('Helvetica')
      .text(`Page ${pageNum}`, PW - MARGIN - 40, 13, { width: 40, align: 'right', lineBreak: false });
  };

  const drawCoverMeta = () => {
    // White meta block
    const metaY = BAND_H + 8;
    const metaH = COVER_H - BAND_H - 12;
    doc.rect(MARGIN, metaY, CONTENT, metaH).fill(PDF.brandLight);
    doc.rect(MARGIN, metaY, 4, metaH).fill(PDF.brandAccent);

    const col1 = MARGIN + 14;
    const col2 = MARGIN + CONTENT / 2;
    const lineH = 12;
    let metaLine = metaY + 6;

    const drawMeta = (label: string, value: string, x: number) => {
      doc.fillColor(PDF.textMuted).fontSize(6).font('Helvetica')
        .text(label.toUpperCase(), x, metaLine, { lineBreak: false });
      doc.fillColor(PDF.textPrimary).fontSize(7).font('Helvetica-Bold')
        .text(value, x, metaLine + 6, { lineBreak: false });
    };

    drawMeta('Exported at',      fmtDate(exportedAt.toISOString()),    col1);
    drawMeta('Exported by',      userStore.findById(viewerId)?.name || 'System', col2);
    metaLine += lineH + 8;
    drawMeta('Records exported', `${result.items.length} of ${result.total} matching`, col1);
    drawMeta('Export limit',     `${EXPORT_LIMIT.toLocaleString()} rows`, col2);

    if (filterSummary !== '{}') {
      metaLine += lineH + 4;
      doc.fillColor(PDF.textMuted).fontSize(7).font('Helvetica')
        .text('ACTIVE FILTERS', col1, metaLine, { lineBreak: false });
      doc.fillColor(PDF.textSecondary).fontSize(7).font('Helvetica')
        .text(pdfCellValue(filterSummary, 220), col1, metaLine + 9, {
          width: CONTENT - 18, height: 9, lineBreak: false, ellipsis: true,
        });
    }
  };

  const drawTableHeader = (topY: number) => {
    doc.rect(MARGIN, topY, CONTENT, HEADER_H).fill(PDF.tableHeaderBg);
    let x = MARGIN;
    COLS.slice(0, -1).forEach((col, i) => {
      doc.fillColor(PDF.tableHeaderFg).fontSize(6).font('Helvetica-Bold')
        .text(col.header, x + 4, topY + 5, { width: colWidths[i] - 8, lineBreak: false });
      x += colWidths[i];
    });
    // Details header
    doc.fillColor(PDF.tableHeaderFg).fontSize(7).font('Helvetica-Bold')
      .text('Details', x + 4, topY + 5, { width: descW - 8, height: 8, lineBreak: false, ellipsis: true });
  };

  const drawFooterBar = () => {
    doc.rect(0, PH - FOOTER_H, PW, FOOTER_H).fill(PDF.brandLight);
    doc.rect(0, PH - FOOTER_H, PW, 1).fill(PDF.rowBorder);
    doc.fillColor(PDF.textMuted).fontSize(7).font('Helvetica')
      .text(
        `WorkSync Audit Export  ·  ${fmtDate(exportedAt.toISOString())}  ·  Page ${pageNum}`,
        MARGIN, PH - FOOTER_H + 8,
        { width: CONTENT, align: 'center', lineBreak: false },
      );
  };

  // ── First page ───────────────────────────────────────────────────────────
  const newPage = (isFirst = false) => {
    pageNum++;
    doc.rect(0, 0, PW, PH).fill(PDF.pageBg);
    const bandH = isFirst ? COVER_H : BAND_H;
    drawBrandBand(isFirst ? BAND_H : BAND_H);
    if (isFirst) drawCoverMeta();
    y = (isFirst ? TABLE_TOP_P1 : TABLE_TOP_PN);
    drawTableHeader(y);
    y += HEADER_H;
    drawFooterBar();
  };

  newPage(true);

  // ── Data rows ────────────────────────────────────────────────────────────
  let rowNum = 0;
  for (const item of result.items) {
    const availH = PH - FOOTER_H - y;
    if (availH < ROW_H) {
      doc.addPage({ size: 'A4', layout: 'landscape' });
      newPage(false);
    }

    const bg = rowNum % 2 === 0 ? PDF.rowEven : PDF.rowOdd;
    doc.rect(MARGIN, y, CONTENT, ROW_H).fill(bg);

    // Bottom border
    doc.rect(MARGIN, y + ROW_H - 0.5, CONTENT, 0.5).fill(PDF.rowBorder);

    const projectTask = [item.project?.name, item.task?.name].filter(Boolean).join(' / ') || '—';
    const cellData = [
      fmtDate(item.timestamp),
      item.actor.name,
      `${item.action} • ${item.module}`,
      projectTask,
      item.result,
      item.description,
    ];

    let x = MARGIN;
    cellData.forEach((cell, i) => {
      const cx = x + 4;
      const cy = y + (ROW_H - 9) / 2;   // vertically centered
      const cw = colWidths[i] - 8;

      doc.fillColor(i === 0 || i === 4 ? PDF.textSecondary : PDF.textPrimary)
        .fontSize(i === 5 ? 6 : 6.5)
        .font('Helvetica')
        .text(pdfCellValue(cell, i === 5 ? 150 : 42), cx, cy, {
          width: cw,
          height: 8,
          lineBreak: false,
          ellipsis: true,
        });
      x += colWidths[i];
    });

    y += ROW_H;
    rowNum++;
  }

  // ── Trailing summary ─────────────────────────────────────────────────────
  if (result.items.length === 0) {
    doc.fillColor(PDF.textMuted).fontSize(10).font('Helvetica')
      .text('No events matched the applied filters.', MARGIN, y + 20, {
        width: CONTENT, align: 'center',
      });
  }

  doc.end();

  const content = await new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);
  });

  const exportedCount = result.items.length;
  recordExport('PDF', viewerId, effectiveRoles.permanentRole, exportedCount, result.total, filterSummary);
  return { content, exportedCount, total: result.total };
};
