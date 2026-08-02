import { query, withTransaction } from '../db/pool.js';
import { fromUserPk, toProjectPkOrNull, toTaskPkOrNull, toUserPkOrNull } from '../utils/idMapping.js';
import { ActivityChange, ActivityFilters, ActivityRecordInput } from './activity.types.js';
import { EffectiveRoles } from './activity.rbac.js';

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
  actordisplayname: string | null;
  actoremail: string | null;
  affecteduseridtext: string | null;
  affectedusernamesnapshot: string | null;
  entitynamesnapshot: string | null;
  projectnamesnapshot: string | null;
  tasknamesnapshot: string | null;
  linkroute: string | null;
  metadatajson: Record<string, unknown> | null;
}

interface ChangeRow { auditeventid: string; fieldname: string; oldvalue: string | null; newvalue: string | null }

// ── HR visibility exclusion ───────────────────────────────────────────────────────
// HR sees every organization event except those performed by Administrators. The
// `actorrolesnapshot` check covers events recorded with the actor's role, but legacy
// rows can carry a NULL snapshot while the actor is (or was) an Administrator — e.g.
// task-review approvals recorded without a snapshot. So the exclusion ALSO denies any
// event whose actor currently holds the active `Administrator` role (same window that
// `getEffectiveRoles` uses). `actoruserid IS NULL` events (system/failed logins) stay
// visible to HR, which is why the window check is wrapped in an OR NULL guard.
const HR_EXCLUDED_ACTOR_CLAUSE = `(COALESCE(a.actorrolesnapshot, '') <> 'Admin'
  AND (a.actoruserid IS NULL OR a.actoruserid NOT IN (
    SELECT hrur.userid FROM iam.userroles hrur
    JOIN iam.roles hrr ON hrr.roleid = hrur.roleid
    WHERE hrr.rolecode = 'Administrator'
      AND hrur.revokedatutc IS NULL
      AND hrur.startsatutc <= now()
      AND (hrur.endsatutc IS NULL OR hrur.endsatutc > now())
  )))`;

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

const visibilitySql = (
  viewerPk: number,
  effectiveRoles: EffectiveRoles,
  paramIndex: number
): { clause: string; extraParams: unknown[] } => {
  const params: unknown[] = [viewerPk];
  const pi = paramIndex;

  // ── Admin: unrestricted within the organization ──────────────────────────────
  if (effectiveRoles.permanentRole === 'Admin') {
    return { clause: 'TRUE', extraParams: [] };
  }

  // ── Base scope: events the viewer is the actor for (all roles) ──────────────
  const ownParts: string[] = [
    `a.actoruserid = $${pi}`,
  ];

  // ── Team Member / Team Lead base: own events + events from projects they
  //    are members of (project membership rows only; HR alone does not grant this) ──
  const projectMemberPart = `a.projectid IN (
    SELECT vpm.projectid FROM work.projectmembers vpm
    WHERE vpm.userid = $${pi} AND vpm.leftatutc IS NULL
  )`;

  const taskAssigneePart = `a.projectid IN (
    SELECT vt.projectid FROM work.taskassignees vta
    JOIN work.tasks vt ON vt.taskid = vta.taskid
    WHERE vta.userid = $${pi} AND vta.unassignedatutc IS NULL
  )`;

  // Combine base project/task access with module restriction for plain Team Members
  const buildMemberClause = (): string => {
    const parts = [...ownParts, projectMemberPart, taskAssigneePart];
    const scopeClause = `(${parts.join(' OR ')})`;
    // Restrict to non-sensitive modules for pure Team Members
    if (!effectiveRoles.isActiveTeamLead && !effectiveRoles.isActiveHR) {
      return `${scopeClause} AND a.modulecode NOT IN ('Permissions', 'Authentication', 'Settings', 'System')`;
    }
    return scopeClause;
  };

  // ── HR: near-admin visibility — all organization events except those performed by Admins ──
  // HR can see everything an Admin sees with one exclusion: events where the actor was an
  // Administrator. This applies whether the HR role is permanent or temporary.
  if (effectiveRoles.isActiveHR && !effectiveRoles.isActiveTeamLead) {
    return {
      clause: HR_EXCLUDED_ACTOR_CLAUSE,
      extraParams: params.slice(1),
    };
  }

  // ── HR + Team Lead combined: same near-admin scope ───────────────────────
  // When both are active the HR scope already covers everything the lead scope would; no
  // need to enumerate project membership predicates on top.
  if (effectiveRoles.isHRandTeamLead) {
    return {
      clause: HR_EXCLUDED_ACTOR_CLAUSE,
      extraParams: params.slice(1),
    };
  }

  // ── Team Lead (permanent or temporary): own + project-member + led-project scope ──
  // If also HR, combine both scopes. Plain Team Members who are not Lead/HR also
  // flow through here — buildMemberClause applies the module restriction for them.
  if (!effectiveRoles.isActiveTeamLead && !effectiveRoles.isActiveHR) {
    return { clause: buildMemberClause(), extraParams: params.slice(1) };
  }

  const scopeParts: string[] = [...ownParts, projectMemberPart, taskAssigneePart];

  // Permanent Team Lead: also include formal lead membership rows
  if (effectiveRoles.permanentRole === 'Team_Lead') {
    scopeParts.push(`a.projectid IN (
      SELECT pmlead.projectid FROM work.projectmembers pmlead
      WHERE pmlead.userid = $${pi} AND pmlead.leftatutc IS NULL AND pmlead.memberrolecode = 'TeamLead'
    )`);
  }

  // Temporary Team Lead: include scoped projects from the role assignment
  if (effectiveRoles.isActiveTeamLead && effectiveRoles.leadProjectPks.length > 0) {
    const leadIdx = params.length + 1;
    params.push(effectiveRoles.leadProjectPks);
    scopeParts.push(`a.projectid = ANY($${leadIdx}::int[])`);
  }

  // HR+TeamLead combined: handled above via the isHRandTeamLead branch.
  // Only pure Team Lead (with no HR) reaches this point.

  return {
    clause: `(${scopeParts.join(' OR ')})`,
    extraParams: params.slice(1),
  };
};

const buildWhere = (
  filters: ActivityFilters,
  viewerId: string,
  effectiveRoles: EffectiveRoles
) => {
  const viewerPk = toUserPkOrNull(viewerId);
  if (viewerPk === null) throw new Error('Invalid authenticated user identifier.');

  const { clause: visibilityClause, extraParams } = visibilitySql(viewerPk, effectiveRoles, 1);

  // For Admin and HR the visibility clause needs no $1 viewerPk parameter.
  // For all other roles $1 is the viewerPk used inside the scoped predicates.
  const isParamFreePath = effectiveRoles.permanentRole === 'Admin'
    || effectiveRoles.isActiveHR;
  const values: unknown[] = isParamFreePath ? [] : [viewerPk];
  values.push(...extraParams);

  // Current WorkSync authentication is organization 1 scoped. Keep every read explicitly
  // bounded to the same organization as inserts, including administrator queries.
  const clauses: string[] = ['a.organizationid = 1', `(${visibilityClause})`];

  // Comment deletion is retained as an audit record for oversight, but must never appear in a
  // Team Member's or Team Lead's Activity Log — including the actor's own deletion. HR and
  // Admin retain visibility through their higher-privilege paths above.
  if (effectiveRoles.permanentRole !== 'Admin' && !effectiveRoles.isActiveHR) {
    clauses.push("NOT (a.actioncode = 'Deleted' AND a.entitytypecode = 'Comment')");
  }

  // myActivityOnly uses $1 (viewerPk). For Admin that param slot doesn't exist yet, so we
  // push viewerPk on demand and reference its position dynamically.
  let myActivityOnlyParamIdx: number | null = null;

  const add = (sql: string, value: unknown) => { values.push(value); clauses.push(sql.replace('?', `$${values.length}`)); };

  if (filters.myActivityOnly) {
    values.push(viewerPk);
    myActivityOnlyParamIdx = values.length;
    clauses.push(`a.actoruserid = $${myActivityOnlyParamIdx}`);
  }

  if (filters.from) add('a.occurredatutc >= ?::timestamptz', filters.from);
  if (filters.to) add('a.occurredatutc <= ?::timestamptz', filters.to);
  if (filters.userId) add('a.actoruserid = ?', toUserPkOrNull(filters.userId));
  if (filters.userRole) add('a.actorrolesnapshot = ?', filters.userRole);
  if (filters.projectId) add('a.projectid = ?', toProjectPkOrNull(filters.projectId));
  if (filters.taskId) add('a.taskid = ?', toTaskPkOrNull(filters.taskId));
  if (filters.module) add('a.modulecode = ?', filters.module);
  if (filters.action === 'Priority Changed') {
    // Task creation records the initial priority as a 'Created' event carrying a priority field
    // row — that is an initial value, not a change, so it must not match this filter. Only
    // explicit 'Priority Changed' codes and 'Updated' events that actually modified the
    // priority field count as real priority changes.
    clauses.push("(a.actioncode = 'Priority Changed' OR (a.actioncode = 'Updated' AND a.auditeventid IN (SELECT pc.auditeventid FROM audit.auditeventchanges pc WHERE lower(pc.fieldname) = 'priority')))");
  } else if (filters.action === 'Status Changed') {
    clauses.push("(a.actioncode = 'Status Changed' OR a.auditeventid IN (SELECT sc.auditeventid FROM audit.auditeventchanges sc WHERE lower(sc.fieldname) = 'status'))");
  } else if (filters.action === 'Attendance Corrected') {
    clauses.push("(a.actioncode = 'Attendance Corrected' OR a.actioncode = 'Corrected')");
  } else if (filters.action === 'Assigned/Reassigned') {
    // Tasks record 'Assigned/Reassigned' directly; project member changes are split
    // into separate 'Assigned' and 'Reassigned' codes. Match all three.
    clauses.push("(a.actioncode = 'Assigned/Reassigned' OR a.actioncode = 'Assigned' OR a.actioncode = 'Reassigned')");
  } else if (filters.action === 'Archived') {
    // Project (and task) archives are stored with the 'Deleted' actioncode plus a status
    // field change to 'Archived' — see project.service.archiveProject. Match both the
    // explicit 'Archived' code and archive-as-deleted events so everything actually
    // archived appears under 'Archived' instead of 'Deleted'.
    clauses.push("(a.actioncode = 'Archived' OR a.auditeventid IN (SELECT c.auditeventid FROM audit.auditeventchanges c WHERE lower(c.fieldname) = 'status' AND lower(c.newvalue) = 'archived'))");
  } else if (filters.action === 'Deleted') {
    // 'Deleted' shares its actioncode with archive events; exclude status->'Archived' rows
    // so archives surface only under the 'Archived' option.
    clauses.push("(a.actioncode = 'Deleted' AND a.auditeventid NOT IN (SELECT c.auditeventid FROM audit.auditeventchanges c WHERE lower(c.fieldname) = 'status' AND lower(c.newvalue) = 'archived'))");
  } else if (filters.action === 'Assigned') {
    // Project member additions are recorded as 'Assigned'; task (re)assignments are recorded
    // as 'Assigned/Reassigned' (see task.service.updateTask). Both are assignment events, so
    // the 'Assigned' filter matches them together.
    clauses.push("(a.actioncode IN ('Assigned', 'Assigned/Reassigned'))");
  } else if (filters.action === 'Completed') {
    // Completion is recorded as an explicit 'Completed' code (projects that auto-complete)
    // or as a status field change to 'Completed'/'Done' (projects and tasks). Match all
    // real completions instead of only the explicit code.
    clauses.push("(a.actioncode = 'Completed' OR a.auditeventid IN (SELECT c.auditeventid FROM audit.auditeventchanges c WHERE lower(c.fieldname) = 'status' AND lower(c.newvalue) IN ('completed', 'done')))");
  } else if (filters.action === 'Uploaded Attachment') {
    // No code records 'Uploaded Attachment' as an actioncode. Uploads are captured as
    // 'Commented' events with metadatajson.hasAttachments=true (project chats) and as
    // 'Created' events for ProjectFile entities. Match all three representations.
    clauses.push("(a.actioncode = 'Uploaded Attachment' OR COALESCE(a.metadatajson->>'hasAttachments', 'false') = 'true' OR (a.actioncode = 'Created' AND a.entitytypecode = 'ProjectFile'))");
  } else if (filters.action === 'Deleted Attachment') {
    // Same representation mismatch as 'Uploaded Attachment': deletions are captured as
    // 'Deleted' events for ProjectFile entities (plus legacy attachment codes).
    clauses.push("(a.actioncode IN ('Deleted Attachment', 'Attachment Deleted') OR (a.actioncode = 'Deleted' AND a.entitytypecode = 'ProjectFile'))");
  } else if (filters.action) {
    add('a.actioncode = ?', filters.action);
  }
  if (filters.entityType) add('a.entitytypecode = ?', filters.entityType);
  if (filters.result) add('a.resultcode = ?', filters.result);
  if (filters.source) add('a.sourcecode = ?', filters.source);
  if (filters.importantOnly) {
    // "Important" means high-impact activity: events the recording site explicitly flagged as
    // important, plus failed/blocked operations and destructive or security-sensitive actions
    // regardless of how they were flagged at write time.
    clauses.push("(a.isimportant = TRUE OR a.resultcode IN ('Failed', 'Blocked') OR a.actioncode IN ('Deleted', 'Archived', 'Unauthorized Access', 'Failed Operation'))");
  }
  if (filters.deletedOnly) clauses.push("a.actioncode IN ('Deleted', 'Archived', 'Attachment Deleted', 'Deleted Attachment')");
  if (filters.failedOrBlockedOnly) clauses.push("a.resultcode IN ('Failed', 'Blocked')");
  if (filters.hrActivityOnly) clauses.push("a.modulecode IN ('Attendance', 'HR')");
  if (filters.hasAttachments) clauses.push("COALESCE(a.metadatajson->>'hasAttachments', 'false') = 'true'");
  if (filters.hasMentions) clauses.push("COALESCE(a.metadatajson->>'hasMentions', 'false') = 'true'");
  if (filters.status) add(`EXISTS (SELECT 1 FROM audit.auditeventchanges sc WHERE sc.auditeventid=a.auditeventid AND lower(sc.fieldname)='status' AND lower(sc.newvalue) = lower(?))`, filters.status);
  if (filters.priority) add(`EXISTS (SELECT 1 FROM audit.auditeventchanges pc WHERE pc.auditeventid=a.auditeventid AND lower(pc.fieldname)='priority' AND lower(pc.newvalue) = lower(?))`, filters.priority);
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
  actor.displayname AS actordisplayname, actor.email AS actoremail,
  a.projectnamesnapshot, a.tasknamesnapshot, a.linkroute, a.metadatajson`;

const ACTIVITY_FROM = `audit.auditevents a
  LEFT JOIN iam.users actor ON actor.userid = a.actoruserid AND actor.organizationid = a.organizationid`;

export const findActivities = async (
  filters: ActivityFilters,
  effectiveRoles: EffectiveRoles,
  viewerId: string
) => {
  const built = buildWhere(filters, viewerId, effectiveRoles);
  const countResult = await query<{ total: string }>(`SELECT count(*)::text total FROM audit.auditevents a WHERE ${built.where}`, built.values);
  const values = [...built.values, filters.pageSize, (filters.page - 1) * filters.pageSize];
  const direction = filters.sort === 'oldest' ? 'ASC' : 'DESC';
  const rows = await query<ActivityRow>(
    `SELECT ${SELECT_COLUMNS} FROM ${ACTIVITY_FROM} WHERE ${built.where}
     ORDER BY a.occurredatutc ${direction}, a.auditeventid ${direction}
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return { rows: rows.rows, total: Number(countResult.rows[0]?.total || 0) };
};

export const findActivityById = async (id: string): Promise<ActivityRow | null> => {
  const result = await query<ActivityRow>(`SELECT ${SELECT_COLUMNS} FROM ${ACTIVITY_FROM} WHERE a.auditeventid = $1`, [id]);
  return result.rows[0] || null;
};

export const findVisibleActivityById = async (
  id: string,
  viewerId: string,
  effectiveRoles: EffectiveRoles
): Promise<ActivityRow | null> => {
  const built = buildWhere({ page: 1, pageSize: 1 }, viewerId, effectiveRoles);
  const values = [...built.values, id];
  const result = await query<ActivityRow>(
    `SELECT ${SELECT_COLUMNS} FROM ${ACTIVITY_FROM}
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

// Resolves current IAM display names for affected-user / user-entity references. Older events
// were recorded with a bare frontend id (e.g. "usr-46") when the in-memory user store had not
// warmed up, so the Activity Log falls back to the live IAM row at read time.
export const findUserDisplayNames = async (frontendIds: string[]): Promise<Map<string, string>> => {
  const map = new Map<string, string>();
  const unique = [...new Set(frontendIds.filter(Boolean))];
  // Not every "User" entity reference is a usr-<n> id — failed-login events, for example,
  // store the attempted email in entityidtext. Non-usr ids must be skipped, never thrown on,
  // or the whole feed fails for the filter that surfaces them.
  const pks = unique.flatMap((id) => {
    try {
      const pk = toUserPkOrNull(id);
      return pk === null ? [] : [pk];
    } catch {
      return [];
    }
  });
  if (pks.length === 0) return map;
  const placeholders = pks.map((_, index) => `$${index + 1}`).join(', ');
  const result = await query<{ userid: number; displayname: string }>(
    `SELECT userid, displayname FROM iam.users WHERE organizationid = 1 AND userid IN (${placeholders})`,
    pks
  );
  for (const row of result.rows) map.set(fromUserPk(row.userid), row.displayname);
  return map;
};
