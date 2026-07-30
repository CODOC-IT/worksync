import { query } from '../db/pool.js';
import { fromUserPk } from '../utils/idMapping.js';

export interface ActivityLogRow {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  action: string;
  targetType: string;
  targetId: string;
  targetTitle: string;
  timestamp: string;
}

export interface ActivityLogFullRow extends ActivityLogRow {
  diffField?: string;
  diffOldVal?: string;
  diffNewVal?: string;
}

const DEFAULT_AVATAR = '';

export const getActivityLogs = async (
  userPk: number,
  from: string,
  to: string,
  limit: number = 200
): Promise<ActivityLogFullRow[]> => {
  const result = await query<{
    auditeventid: number;
    actoruserid: number | null;
    actioncode: string;
    entitytypecode: string;
    entityidtext: string;
    reason: string | null;
    occurredatutc: string;
    displayname: string | null;
    changefield: string | null;
    changeoldval: string | null;
    changenewval: string | null;
  }>(
    `SELECT
       ae.auditeventid,
       ae.actoruserid,
       ae.actioncode,
       ae.entitytypecode,
       ae.entityidtext,
       ae.reason,
       ae.occurredatutc,
       u.displayname,
       aec.fieldname AS "changefield",
       aec.oldvalue AS "changeoldval",
       aec.newvalue AS "changenewval"
     FROM audit.auditevents ae
     LEFT JOIN iam.users u ON u.userid = ae.actoruserid
     LEFT JOIN audit.auditeventchanges aec ON aec.auditeventid = ae.auditeventid
     WHERE ae.actoruserid = $1
       AND ae.occurredatutc >= $2::date
       AND ae.occurredatutc <= ($3::date + interval '1 day')
     ORDER BY ae.occurredatutc DESC, ae.auditeventid DESC
     LIMIT $4`,
    [userPk, from, to, limit]
  );

  return result.rows.map((r) => ({
    id: `act-${r.auditeventid}`,
    userId: r.actoruserid ? fromUserPk(r.actoruserid) : '',
    userName: r.displayname || 'System',
    userAvatar: DEFAULT_AVATAR,
    action: r.actioncode,
    targetType: mapEntityType(r.entitytypecode),
    targetId: r.entityidtext || '',
    targetTitle: r.reason || '',
    timestamp: r.occurredatutc ? new Date(r.occurredatutc).toLocaleDateString('en-CA') + ' ' +
      new Date(r.occurredatutc).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '',
    diffField: r.changefield || undefined,
    diffOldVal: r.changeoldval || undefined,
    diffNewVal: r.changenewval || undefined,
  }));
};

export const createActivityLog = async (
  actorUserPk: number,
  actionCode: string,
  entityTypeCode: string,
  entityIdText: string,
  reason: string | null,
  diffField?: string,
  diffOldVal?: string,
  diffNewVal?: string
): Promise<number> => {
  const orgId = 1;

  const result = await query<{ auditeventid: number }>(
    `INSERT INTO audit.auditevents
       (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, reason, occurredatutc)
     VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
     RETURNING auditeventid`,
    [orgId, actorUserPk, actionCode, entityTypeCode, entityIdText, reason]
  );

  const eventId = result.rows[0].auditeventid;

  if (diffField) {
    await query(
      `INSERT INTO audit.auditeventchanges
         (auditeventid, fieldname, oldvalue, newvalue)
       VALUES ($1, $2, $3, $4)`,
      [eventId, diffField, diffOldVal || null, diffNewVal || null]
    );
  }

  return eventId;
};

const ENTITY_TYPE_MAP: Record<string, string> = {
  Project: 'Project',
  Task: 'Task',
  Attendance: 'Attendance',
  Approval: 'Approval',
  Settings: 'Settings',
  Chat: 'Settings',
};

function mapEntityType(code: string): string {
  return ENTITY_TYPE_MAP[code] || 'Settings';
}

const FRONTEND_TYPE_MAP: Record<string, string> = {
  Project: 'Project',
  Task: 'Task',
  Attendance: 'Attendance',
  Approval: 'Approval',
  Settings: 'Settings',
};

export function toDbEntityType(frontendType: string): string {
  return FRONTEND_TYPE_MAP[frontendType] || frontendType;
}
