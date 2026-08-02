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

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Replaces bare frontend ids (e.g. "usr-46") inside a stored description with the resolved
// display names. Older events were written with id fallbacks when the in-memory user store
// had not warmed up yet; the Activity Log corrects those at read time.
const withResolvedNames = (
  description: string,
  names: Array<{ id: string; name: string } | null | undefined>
): string => {
  let out = description;
  for (const entry of names) {
    if (!entry || !entry.name || entry.name === entry.id) continue;
    out = out.replace(new RegExp(`\\b${escapeRegExp(entry.id)}\\b`, 'g'), entry.name);
  }
  return out;
};

const toDto = (
  row: repo.ActivityRow,
  changes: ActivityDTO['changes'],
  nameMap: Map<string, string> = new Map()
): ActivityDTO => {
  const knownUser = row.actoruserid ? userStore.findById(fromUserPk(row.actoruserid)) : undefined;
  const actorId = row.actoruserid ? fromUserPk(row.actoruserid) : null;
  // The audit snapshot is useful for historical records, but a current IAM display name is
  // authoritative for live actors. This also fixes cold-starts where userStore has not warmed
  // its in-memory cache yet. Only actorless events should be labelled System.
  const actorName = row.actordisplayname || row.actornamesnapshot || knownUser?.name || (actorId ? actorId : 'System');
  const actorEmail = row.actoremail || row.actoremailsnapshot || knownUser?.email || '';
  const affectedName = row.affectedusernamesnapshot
    || (row.affecteduseridtext ? nameMap.get(row.affecteduseridtext) : undefined)
    || row.affecteduseridtext
    || 'Unknown user';
  const entityName = row.entitynamesnapshot
    || (row.entitytypecode === 'User' && row.entityidtext ? nameMap.get(row.entityidtext) : undefined)
    || row.entityidtext;
  const description = withResolvedNames(
    row.description || `${row.actioncode} ${row.entitytypecode}`,
    [
      actorId ? { id: actorId, name: actorName } : null,
      row.affecteduseridtext ? { id: row.affecteduseridtext, name: affectedName } : null,
    ]
  );
  return {
    id: String(row.auditeventid), correlationId: row.correlationid,
    actor: {
      id: actorId,
      name: actorName,
      email: actorEmail,
      role: row.actorrolesnapshot || knownUser?.role || (actorId ? 'Unknown' : 'System')
    },
    affectedUser: row.affecteduseridtext || row.affectedusernamesnapshot ? {
      id: row.affecteduseridtext, name: affectedName
    } : undefined,
    action: row.actioncode, module: row.modulecode, entityType: row.entitytypecode,
    entityId: row.entityidtext, entityName,
    description,
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
  const nameMap = await repo.findUserDisplayNames(
    rows.flatMap((row) => [
      row.affecteduseridtext,
      row.entitytypecode === 'User' ? row.entityidtext : undefined,
    ]).filter((id): id is string => Boolean(id))
  );
  const changes = await repo.findChanges(rows.map((row) => String(row.auditeventid)));
  return {
    items: rows.map((row) => {
      const dto = toDto(row, changes.get(String(row.auditeventid)) || [], nameMap);
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
  const nameMap = await repo.findUserDisplayNames([
    row.affecteduseridtext,
    row.entitytypecode === 'User' ? row.entityidtext : undefined,
  ].filter((id): id is string => Boolean(id)));
  return toDto(row, changes.get(String(row.auditeventid)) || [], nameMap);
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
  // Result is grouped with the event so the description can remain readable at a practical
  // font size. Every column is kept inside the landscape A4 printable area.
  const COLS = [
    { header: 'Timestamp', key: 'ts',      w: 108 },
    { header: 'Actor',     key: 'actor',   w: 110 },
    { header: 'Event',     key: 'event',   w: 148 },
    { header: 'Context',   key: 'context', w: 154 },
    { header: 'Details',   key: 'details', w: 0   }, // fills remainder
  ] as const;

  // Calculate description column width
  const fixedW = COLS.slice(0, -1).reduce((s, c) => s + c.w, 0);
  const descW  = CONTENT - fixedW;

  const colWidths = [...COLS.slice(0, -1).map((c) => c.w), descW];

  const PAGE_HEADER_H = 42;
  const SUMMARY_H = 28;
  const HEADER_H = 20;
  const FOOTER_H = 22;
  const CELL_PAD_X = 5;
  const CELL_PAD_Y = 5;
  const CELL_LINE_H = 9;
  const MIN_ROW_H = 28;
  const MAX_ROW_H = 42;
  const TABLE_BOTTOM = PH - FOOTER_H - 7;

  let pageNum = 0;
  let y       = 0;

  // ── Page-level helpers ──────────────────────────────────────────────────
  const drawBrandBand = () => {
    doc.rect(0, 0, PW, PAGE_HEADER_H).fill(PDF.brandDark);
    doc.rect(0, PAGE_HEADER_H - 3, PW, 3).fill(PDF.brandAccent);
    doc.fillColor(PDF.brandAccent).fontSize(14).font('Helvetica-Bold')
      .text('WorkSync', MARGIN, 12, { lineBreak: false });
    doc.fillColor(PDF.pageBg).fontSize(9).font('Helvetica-Bold')
      .text('Activity Log', MARGIN + 84, 15, { lineBreak: false });
    doc.fillColor(PDF.textMuted).fontSize(7).font('Helvetica')
      .text(`Exported ${fmtDate(exportedAt.toISOString())}  |  Page ${pageNum}`, PW - MARGIN - 220, 16, {
        width: 220, align: 'right', lineBreak: false,
      });
  };

  const drawSummary = (topY: number) => {
    doc.rect(MARGIN, topY, CONTENT, SUMMARY_H).fill(PDF.brandLight);
    doc.rect(MARGIN, topY, 4, SUMMARY_H).fill(PDF.brandAccent);
    const exportedBy = userStore.findById(viewerId)?.name || 'System';
    const activeFilters = filterSummary === '{}' ? 'No active filters' : pdfCellValue(filterSummary, 175);
    doc.fillColor(PDF.textPrimary).fontSize(7.5).font('Helvetica-Bold')
      .text(`${result.items.length} of ${result.total} matching activities`, MARGIN + 12, topY + 10, { lineBreak: false });
    doc.fillColor(PDF.textSecondary).fontSize(7).font('Helvetica')
      .text(`Exported by ${exportedBy}  |  ${activeFilters}`, MARGIN + CONTENT / 2 - 24, topY + 10, {
        width: CONTENT / 2 + 10, align: 'right', lineBreak: false, ellipsis: true,
      });
  };

  const drawTableHeader = (topY: number) => {
    doc.rect(MARGIN, topY, CONTENT, HEADER_H).fill(PDF.tableHeaderBg);
    let x = MARGIN;
    COLS.forEach((col, i) => {
      doc.fillColor(PDF.tableHeaderFg).fontSize(7).font('Helvetica-Bold')
        .text(col.header, x + CELL_PAD_X, topY + 6, { width: colWidths[i] - CELL_PAD_X * 2, lineBreak: false });
      if (i > 0) doc.rect(x, topY, 0.5, HEADER_H).fill('#334155');
      x += colWidths[i];
    });
  };

  const drawFooterBar = () => {
    doc.rect(0, PH - FOOTER_H, PW, FOOTER_H).fill(PDF.brandLight);
    doc.rect(0, PH - FOOTER_H, PW, 1).fill(PDF.rowBorder);
    doc.fillColor(PDF.textMuted).fontSize(7).font('Helvetica')
      .text(
        `WorkSync Activity Log  ·  ${result.items.length} exported  ·  Page ${pageNum}`,
        MARGIN, PH - FOOTER_H + 8,
        { width: CONTENT, align: 'center', lineBreak: false },
      );
  };

  // ── First page ───────────────────────────────────────────────────────────
  const newPage = (isFirst = false) => {
    pageNum++;
    // PDFKit otherwise retains the footer's cursor position while a page is being drawn,
    // which can trigger an automatic blank page when the next table header is rendered.
    doc.x = MARGIN;
    doc.y = 0;
    doc.rect(0, 0, PW, PH).fill(PDF.pageBg);
    drawBrandBand();
    y = PAGE_HEADER_H + 8;
    if (isFirst) {
      drawSummary(y);
      y += SUMMARY_H + 8;
    }
    drawTableHeader(y);
    y += HEADER_H;
    drawFooterBar();
  };

  newPage(true);

  // PDFKit's wrapped text renderer can add a page while a table cell is being drawn. Wrap into
  // a bounded number of lines ourselves and draw each one at a fixed coordinate instead.
  const cellLines = (value: string, width: number, maxLength: number): string[] => {
    const text = pdfCellValue(value, maxLength);
    const words = text.split(' ').filter(Boolean);
    const maxLines = Math.floor((MAX_ROW_H - CELL_PAD_Y * 2) / CELL_LINE_H);
    const lines: string[] = [];
    let current = '';

    const fit = (source: string, suffix = ''): string => {
      let fitted = source;
      while (fitted && doc.widthOfString(`${fitted}${suffix}`) > width) fitted = fitted.slice(0, -1);
      return `${fitted}${suffix}`;
    };

    for (let index = 0; index < words.length; index++) {
      const candidate = current ? `${current} ${words[index]}` : words[index];
      if (doc.widthOfString(candidate) <= width) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (lines.length === maxLines) {
        lines[maxLines - 1] = fit(`${lines[maxLines - 1]}…`);
        return lines;
      }
      current = fit(words[index]);
    }

    if (current) lines.push(current);
    return lines.length ? lines : ['—'];
  };

  // ── Data rows ────────────────────────────────────────────────────────────
  let rowNum = 0;
  for (const item of result.items) {
    const projectTask = [item.project?.name, item.task?.name].filter(Boolean).join(' / ') || '—';
    const cellData = [
      fmtDate(item.timestamp),
      item.actor.name,
      `${item.action} • ${item.module}\n${item.result}`,
      projectTask,
      item.description,
    ];

    // Measure the content before drawing so a complete row moves to the next page instead of
    // leaving a clipped row, orphaned text, or a mostly blank trailing page.
    const cellText = cellData.map((cell, i) => {
      const width = colWidths[i] - CELL_PAD_X * 2;
      doc.font('Helvetica').fontSize(i === 4 ? 7.5 : 7);
      return cellLines(cell, width, i === 4 ? 240 : 90);
    });
    const rowHeight = Math.max(
      MIN_ROW_H,
      Math.min(MAX_ROW_H, Math.max(...cellText.map((lines) => lines.length * CELL_LINE_H)) + CELL_PAD_Y * 2),
    );
    if (y + rowHeight > TABLE_BOTTOM) {
      doc.addPage({ size: 'A4', layout: 'landscape', margin: 0 });
      newPage(false);
    }

    const bg = rowNum % 2 === 0 ? PDF.rowEven : PDF.rowOdd;
    doc.rect(MARGIN, y, CONTENT, rowHeight).fill(bg);
    doc.lineWidth(0.5).strokeColor(PDF.rowBorder).rect(MARGIN, y, CONTENT, rowHeight).stroke();

    let x = MARGIN;
    cellText.forEach((lines, i) => {
      const cx = x + CELL_PAD_X;
      const cy = y + CELL_PAD_Y;

      doc.fillColor(i === 0 ? PDF.textSecondary : PDF.textPrimary)
        .fontSize(i === 4 ? 7.5 : 7)
        .font('Helvetica');
      lines.forEach((line, lineIndex) => {
        doc.text(line, cx, cy + lineIndex * CELL_LINE_H, { lineBreak: false });
      });
      if (i > 0) doc.rect(x, y, 0.5, rowHeight).fill(PDF.rowBorder);
      x += colWidths[i];
    });

    y += rowHeight;
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
