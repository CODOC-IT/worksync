import { query, withTransaction } from '../db/pool.js';
import { toProjectPkOrNull, toTaskPkOrNull, toUserPkOrNull } from '../utils/idMapping.js';
import { ActivityChange, ActivityFilters, ActivityRecordInput } from './activity.types.js';

export interface ActivityRow {
  auditeventid: string;
  actoruserid: number | null;
  actioncode: string;
  entitytypecode: string;
  entityidtext: string;
  projectid: number | null;
  taskid: number | null;
  reason: string | null;
  correlationid: string;
  ipaddress: string | null;
  occurredatutc: Date;
  modulecode: string;
  description: string | null;
  resultcode: 'Successful' | 'Failed' | 'Blocked';
  sourcecode: 'Web' | 'API' | 'System';
  isimportant: boolean;
  actornamesnapshot: string | null;
  actoremailsnapshot: string | null;
  actorrolesnapshot: string | null;
  affecteduseridtext: string | null;
  affectedusernamesnapshot: string | null;
  entitynamesnapshot: string | null;
  projectnamesnapshot: string | null;
  tasknamesnapshot: string | null;
  linkroute: string | null;
  metadatajson: Record<string, unknown> | null;
}

interface ChangeRow { auditeventid: string; fieldname: string; oldvalue: string | null; newvalue: string | null }

export const insertActivity = async (input: ActivityRecordInput): Promise<string> =>
  withTransaction(async (runQuery) => {
    const result = await runQuery<{ auditeventid: string }>(
      `INSERT INTO audit.auditevents (
         organizationid, actoruserid, actioncode, entitytypecode, entityidtext,
         projectid, taskid, reason, correlationid, ipaddress, modulecode, description,
         resultcode, sourcecode, isimportant, actornamesnapshot, actoremailsnapshot,
         actorrolesnapshot, affecteduseridtext, affectedusernamesnapshot, entitynamesnapshot,
         projectnamesnapshot, tasknamesnapshot, linkroute, metadatajson
       ) VALUES (
         1, $1, $2, $3, $4, $5, $6, $7, COALESCE($8::uuid, gen_random_uuid()), $9,
         $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24::jsonb
       ) RETURNING auditeventid`,
      [
        toUserPkOrNull(input.actorId), input.action, input.entityType, input.entityId,
        toProjectPkOrNull(input.projectId), toTaskPkOrNull(input.taskId), input.reason || null,
        input.correlationId || null, input.ipAddress || null, input.module, input.description,
        input.result || 'Successful', input.source || 'API', Boolean(input.important),
        input.actorName || null, input.actorEmail || null, input.actorRole || null,
        input.affectedUserId || null, input.affectedUserName || null, input.entityName || null,
        input.projectName || null, input.taskName || null, input.linkRoute || null,
        JSON.stringify(input.metadata || {})
      ]
    );
    const eventId = result.rows[0].auditeventid;
    for (const change of input.changes || []) {
      await runQuery(
        `INSERT INTO audit.auditeventchanges (auditeventid, fieldname, oldvalue, newvalue, issensitive)
         VALUES ($1, $2, $3, $4, FALSE)`,
        [eventId, change.field, change.previousValue, change.newValue]
      );
    }
    return eventId;
  });

const visibilitySql = (role: string, userParam: number): string => {
  if (role === 'Admin') return 'TRUE';
  if (role === 'HR') {
    return `(a.actoruserid = $${userParam} OR a.modulecode = 'Attendance')`;
  }
  if (role === 'Team_Lead') {
    return `(a.actoruserid = $${userParam} OR EXISTS (
      SELECT 1 FROM work.projects vp
      LEFT JOIN work.projectmembers vpm ON vpm.projectid = vp.projectid AND vpm.leftatutc IS NULL
      WHERE vp.projectid = a.projectid AND
        (vp.owneruserid = $${userParam} OR (vpm.userid = $${userParam} AND vpm.memberrolecode = 'TeamLead'))
    ))`;
  }
  return `((a.actoruserid = $${userParam} OR EXISTS (
    SELECT 1 FROM work.projectmembers vpm
    WHERE vpm.projectid = a.projectid AND vpm.userid = $${userParam} AND vpm.leftatutc IS NULL
  )) AND (a.modulecode NOT IN ('Permissions', 'Authentication') OR a.actoruserid = $${userParam}))`;
};

const buildWhere = (filters: ActivityFilters, viewerId: string, viewerRole: string) => {
  const values: unknown[] = [toUserPkOrNull(viewerId)];
  const clauses = [visibilitySql(viewerRole, 1)];
  const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace('?', `$${values.length}`)); };
  if (filters.from) add('a.occurredatutc >= ?::timestamptz', filters.from);
  if (filters.to) add('a.occurredatutc <= ?::timestamptz', filters.to);
  if (filters.userId) add('a.actoruserid = ?', toUserPkOrNull(filters.userId));
  if (filters.userRole) add('a.actorrolesnapshot = ?', filters.userRole);
  if (filters.projectId) add('a.projectid = ?', toProjectPkOrNull(filters.projectId));
  if (filters.taskId) add('a.taskid = ?', toTaskPkOrNull(filters.taskId));
  if (filters.module) add('a.modulecode = ?', filters.module);
  if (filters.action) add('a.actioncode = ?', filters.action);
  if (filters.entityType) add('a.entitytypecode = ?', filters.entityType);
  if (filters.result) add('a.resultcode = ?', filters.result);
  if (filters.source) add('a.sourcecode = ?', filters.source);
  if (filters.myActivityOnly) clauses.push('a.actoruserid = $1');
  if (filters.importantOnly) clauses.push('a.isimportant = TRUE');
  if (filters.deletedOnly) clauses.push("a.actioncode IN ('Deleted', 'Archived', 'Attachment Deleted')");
  if (filters.failedOrBlockedOnly) clauses.push("a.resultcode IN ('Failed', 'Blocked')");
  if (filters.hasAttachments) clauses.push("COALESCE(a.metadatajson->>'hasAttachments', 'false') = 'true'");
  if (filters.hasMentions) clauses.push("COALESCE(a.metadatajson->>'hasMentions', 'false') = 'true'");
  if (filters.status) add(`EXISTS (SELECT 1 FROM audit.auditeventchanges sc WHERE sc.auditeventid=a.auditeventid AND lower(sc.fieldname)='status' AND sc.newvalue = ?)`, filters.status);
  if (filters.priority) add(`EXISTS (SELECT 1 FROM audit.auditeventchanges pc WHERE pc.auditeventid=a.auditeventid AND lower(pc.fieldname)='priority' AND pc.newvalue = ?)`, filters.priority);
  if (filters.changedField) add(`EXISTS (SELECT 1 FROM audit.auditeventchanges fc WHERE fc.auditeventid=a.auditeventid AND lower(fc.fieldname)=lower(?))`, filters.changedField);
  if (filters.search) {
    add(`(a.actornamesnapshot ILIKE '%' || ? || '%' OR a.actoremailsnapshot ILIKE '%' || $VALUE || '%'
      OR a.description ILIKE '%' || $VALUE || '%' OR a.entityidtext ILIKE '%' || $VALUE || '%'
      OR a.entitynamesnapshot ILIKE '%' || $VALUE || '%' OR a.projectnamesnapshot ILIKE '%' || $VALUE || '%'
      OR a.tasknamesnapshot ILIKE '%' || $VALUE || '%' OR EXISTS (
        SELECT 1 FROM audit.auditeventchanges xc WHERE xc.auditeventid=a.auditeventid AND
        (xc.fieldname ILIKE '%' || $VALUE || '%' OR xc.oldvalue ILIKE '%' || $VALUE || '%' OR xc.newvalue ILIKE '%' || $VALUE || '%')
      ))`, filters.search);
    const n = values.length;
    clauses[clauses.length - 1] = clauses[clauses.length - 1].replaceAll('$VALUE', `$${n}`);
  }
  return { where: clauses.join(' AND '), values };
};

const SELECT_COLUMNS = `a.auditeventid, a.actoruserid, a.actioncode, a.entitytypecode,
  a.entityidtext, a.projectid, a.taskid, a.reason, a.correlationid, a.ipaddress,
  a.occurredatutc, a.modulecode, a.description, a.resultcode, a.sourcecode,
  a.isimportant, a.actornamesnapshot, a.actoremailsnapshot, a.actorrolesnapshot,
  a.affecteduseridtext, a.affectedusernamesnapshot, a.entitynamesnapshot,
  a.projectnamesnapshot, a.tasknamesnapshot, a.linkroute, a.metadatajson`;

export const findActivities = async (filters: ActivityFilters, viewerId: string, viewerRole: string) => {
  const built = buildWhere(filters, viewerId, viewerRole);
  const countResult = await query<{ total: string }>(`SELECT count(*)::text total FROM audit.auditevents a WHERE ${built.where}`, built.values);
  const values = [...built.values, filters.pageSize, (filters.page - 1) * filters.pageSize];
  const direction = filters.sort === 'oldest' ? 'ASC' : 'DESC';
  const rows = await query<ActivityRow>(
    `SELECT ${SELECT_COLUMNS} FROM audit.auditevents a WHERE ${built.where}
     ORDER BY a.occurredatutc ${direction}, a.auditeventid ${direction}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return { rows: rows.rows, total: Number(countResult.rows[0]?.total || 0) };
};

export const findActivityById = async (id: string): Promise<ActivityRow | null> => {
  const result = await query<ActivityRow>(`SELECT ${SELECT_COLUMNS} FROM audit.auditevents a WHERE a.auditeventid = $1`, [id]);
  return result.rows[0] || null;
};

export const findVisibleActivityById = async (
  id: string,
  viewerId: string,
  viewerRole: string
): Promise<ActivityRow | null> => {
  const built = buildWhere({ page: 1, pageSize: 1 }, viewerId, viewerRole);
  const values = [...built.values, id];
  const result = await query<ActivityRow>(
    `SELECT ${SELECT_COLUMNS} FROM audit.auditevents a
     WHERE ${built.where} AND a.auditeventid = $${values.length}`,
    values
  );
  return result.rows[0] || null;
};

export const findChanges = async (eventIds: string[]): Promise<Map<string, ActivityChange[]>> => {
  const grouped = new Map<string, ActivityChange[]>();
  if (!eventIds.length) return grouped;
  const result = await query<ChangeRow>(
    `SELECT auditeventid, fieldname, oldvalue, newvalue FROM audit.auditeventchanges
     WHERE auditeventid = ANY($1::bigint[]) AND issensitive = FALSE ORDER BY auditeventchangeid`,
    [eventIds]
  );
  for (const row of result.rows) {
    const list = grouped.get(String(row.auditeventid)) || [];
    list.push({ field: row.fieldname, previousValue: row.oldvalue, newValue: row.newvalue });
    grouped.set(String(row.auditeventid), list);
  }
  return grouped;
};
