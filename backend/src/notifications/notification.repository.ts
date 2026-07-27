import { query, withTransaction } from '../db/pool.js';
import { toProjectPkOrNull, toTaskPkOrNull, toUserPk, toUserPkOrNull } from '../utils/idMapping.js';
import { NotificationRow } from './notification.mapper.js';
import { ApiPriority, DbPriority, NotificationEvent } from './notification.types.js';

// Repository = data access only (Repository Pattern). No recipient resolution, no priority
// defaulting, no preference-based suppression decisions here — those are
// notification.service.ts's job. This file only knows how to read/write the existing
// notify.* / iam.Users tables (database/10_notify_tables.sql), unmodified.

const SELECT_NOTIFICATION_COLUMNS = `
  un.notificationid,
  un.recipientuserid,
  n.actoruserid,
  actor.displayname AS actordisplayname,
  n.title,
  n.safepreviewtext,
  nt.typecode,
  nt.categorycode,
  n.prioritycode,
  un.readatutc,
  n.createdatutc,
  n.projectid,
  n.taskid
`;

const FROM_NOTIFICATION_JOINS = `
  FROM notify.usernotifications un
  JOIN notify.notifications n ON n.notificationid = un.notificationid
  JOIN notify.notificationtypes nt ON nt.notificationtypeid = n.notificationtypeid
  LEFT JOIN iam.users actor ON actor.userid = n.actoruserid
`;

export interface NotificationTypeMeta {
  notificationTypeId: number;
  categoryCode: string;
  defaultPriority: DbPriority;
}

export const getNotificationTypeMeta = async (typeCode: string): Promise<NotificationTypeMeta | null> => {
  const result = await query<{ notificationtypeid: number; categorycode: string; defaultpriority: DbPriority }>(
    `SELECT notificationtypeid, categorycode, defaultpriority
     FROM notify.notificationtypes
     WHERE typecode = $1`,
    [typeCode]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    notificationTypeId: row.notificationtypeid,
    categoryCode: row.categorycode,
    defaultPriority: row.defaultpriority
  };
};

export interface RecipientPreference {
  recipientUserId: number;
  inAppEnabled: boolean;
}

// Whether each recipient currently has this notification type's in-app delivery enabled.
// Recipients with no explicit preference row fall back to NotificationTypes.DefaultEnabled.
export const getRecipientPreferences = async (
  recipientUserIds: number[],
  notificationTypeId: number,
  defaultEnabled: boolean
): Promise<RecipientPreference[]> => {
  if (recipientUserIds.length === 0) return [];
  const result = await query<{ userid: number; inappenabled: boolean }>(
    `SELECT userid, inappenabled
     FROM notify.usernotificationpreferences
     WHERE notificationtypeid = $1 AND userid = ANY($2::int[])`,
    [notificationTypeId, recipientUserIds]
  );
  const overrides = new Map(result.rows.map((row) => [row.userid, row.inappenabled]));
  return recipientUserIds.map((recipientUserId) => ({
    recipientUserId,
    inAppEnabled: overrides.get(recipientUserId) ?? defaultEnabled
  }));
};

export interface InsertNotificationResult {
  notificationId: number;
  recipients: { recipientUserId: number; deliveryStatus: 'Delivered' | 'Suppressed' }[];
}

// Inserts one notify.Notifications row plus one notify.UserNotifications fan-out row per
// recipient, atomically. `suppressedUserIds` are recipients whose preference disabled in-app
// delivery for this type — they still get a row (DeliveryStatus='Suppressed') so the event is
// never silently lost / unauditable (NFR-19), they just won't see it in their Notification
// Center (see notification.repository.ts's findByUser, which filters on DeliveryStatus).
export const insertNotificationWithFanout = async (
  event: NotificationEvent,
  notificationTypeId: number,
  priority: DbPriority,
  suppressedUserIds: Set<number>
): Promise<InsertNotificationResult> =>
  withTransaction(async (runQuery) => {
    const inserted = await runQuery<{ notificationid: number }>(
      `INSERT INTO notify.notifications
         (notificationtypeid, actoruserid, projectid, taskid, changerequestid,
          attendancecorrectionid, leaverequestid, title, safepreviewtext, prioritycode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING notificationid`,
      [
        notificationTypeId,
        toUserPkOrNull(event.actorId),
        toProjectPkOrNull(event.projectId),
        toTaskPkOrNull(event.taskId),
        null, // changeRequestId — not yet produced by any existing trigger; column stays NULL
        null, // attendanceCorrectionId — see note above
        null, // leaveRequestId — see note above
        event.title,
        event.message.length > 500 ? event.message.slice(0, 497) + '...' : event.message,
        priority
      ]
    );

    const notificationId = inserted.rows[0].notificationid;
    const uniqueRecipientIds = Array.from(new Set(event.recipientIds.map(toUserPk)));

    const recipients: InsertNotificationResult['recipients'] = [];
    for (const recipientUserId of uniqueRecipientIds) {
      const deliveryStatus: 'Delivered' | 'Suppressed' = suppressedUserIds.has(recipientUserId)
        ? 'Suppressed'
        : 'Delivered';
      // Computed in JS rather than a SQL CASE re-using the same parameter twice — real Postgres
      // (via node-postgres's extended query protocol) rejects that with "inconsistent types
      // deduced for parameter $3", since the parameter appears in two different implicit-cast
      // contexts (a plain column value vs. a comparison operand). pg-mem didn't catch this since
      // it doesn't enforce parameter type consistency the way a real Postgres prepared
      // statement does.
      const deliveredAtUtc = deliveryStatus === 'Delivered' ? new Date() : null;
      await runQuery(
        `INSERT INTO notify.usernotifications (notificationid, recipientuserid, deliverystatus, deliveredatutc)
         VALUES ($1, $2, $3, $4)`,
        [notificationId, recipientUserId, deliveryStatus, deliveredAtUtc]
      );
      recipients.push({ recipientUserId, deliveryStatus });
    }

    return { notificationId, recipients };
  });

export interface FindByUserFilters {
  unreadOnly?: boolean;
  typeCode?: string;
  priority?: DbPriority;
  search?: string;
  page?: number;
  pageSize?: number;
  includeCleared?: boolean;
  // A snoozed notification is hidden from the default view until SnoozedUntilUtc passes — same
  // "hide without deleting" shape as ClearedAtUtc, just time-bound. Set true to see snoozed
  // items anyway (e.g. an "explicitly show snoozed" filter in the UI).
  includeSnoozed?: boolean;
}

export const findByUser = async (
  recipientUserId: number,
  filters: FindByUserFilters = {}
): Promise<{ rows: NotificationRow[]; total: number }> => {
  const conditions = ['un.recipientuserid = $1', "un.deliverystatus <> 'Suppressed'"];
  const params: unknown[] = [recipientUserId];

  if (!filters.includeCleared) {
    conditions.push('un.clearedatutc IS NULL');
  }
  if (!filters.includeSnoozed) {
    conditions.push('(un.snoozeduntilutc IS NULL OR un.snoozeduntilutc <= now())');
  }
  if (filters.unreadOnly) {
    conditions.push('un.readatutc IS NULL');
  }
  if (filters.typeCode) {
    params.push(filters.typeCode);
    conditions.push(`nt.typecode = $${params.length}`);
  }
  if (filters.priority) {
    params.push(filters.priority);
    conditions.push(`n.prioritycode = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(n.title ILIKE $${params.length} OR n.safepreviewtext ILIKE $${params.length})`);
  }

  const whereClause = conditions.join(' AND ');

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count ${FROM_NOTIFICATION_JOINS} WHERE ${whereClause}`,
    params
  );
  const total = Number(countResult.rows[0]?.count || 0);

  const pageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 20;
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const offset = (page - 1) * pageSize;

  const dataResult = await query<NotificationRow>(
    `SELECT ${SELECT_NOTIFICATION_COLUMNS}
     ${FROM_NOTIFICATION_JOINS}
     WHERE ${whereClause}
     ORDER BY n.createdatutc DESC
     LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  return { rows: dataResult.rows, total };
};

export const findUnreadByUser = async (recipientUserId: number): Promise<NotificationRow[]> => {
  const result = await query<NotificationRow>(
    `SELECT ${SELECT_NOTIFICATION_COLUMNS}
     ${FROM_NOTIFICATION_JOINS}
     WHERE un.recipientuserid = $1
       AND un.deliverystatus <> 'Suppressed'
       AND un.clearedatutc IS NULL
       AND un.readatutc IS NULL
       AND (un.snoozeduntilutc IS NULL OR un.snoozeduntilutc <= now())
     ORDER BY n.createdatutc DESC`,
    [recipientUserId]
  );
  return result.rows;
};

const parseNotificationId = (dtoId: string): number => {
  const match = /^notif-(\d+)$/.exec(dtoId);
  if (!match) throw new Error(`Invalid notification id: "${dtoId}"`);
  return Number(match[1]);
};

// Returns true if a row was actually updated (i.e. it existed and belonged to this recipient —
// FR-24 "Secure Notification Access": ownership is verified by the WHERE clause itself, not a
// separate check, so there is no window where a caller could probe another user's notification).
export const markRead = async (recipientUserId: number, dtoId: string): Promise<boolean> => {
  const result = await query(
    `UPDATE notify.usernotifications
     SET readatutc = CURRENT_TIMESTAMP, openedatutc = COALESCE(openedatutc, CURRENT_TIMESTAMP)
     WHERE notificationid = $1 AND recipientuserid = $2 AND readatutc IS NULL`,
    [parseNotificationId(dtoId), recipientUserId]
  );
  return (result.rowCount ?? 0) > 0;
};

export const markAllRead = async (recipientUserId: number): Promise<number> => {
  const result = await query(
    `UPDATE notify.usernotifications
     SET readatutc = CURRENT_TIMESTAMP
     WHERE recipientuserid = $1 AND readatutc IS NULL AND clearedatutc IS NULL`,
    [recipientUserId]
  );
  return result.rowCount ?? 0;
};

// FR-10: soft-delete (ClearedAtUtc) rather than a hard DELETE, preserving the audit trail the
// schema was designed for (NFR-19) — a cleared notification simply stops appearing in
// findByUser. Ownership is enforced the same way as markRead.
export const clearOne = async (recipientUserId: number, dtoId: string): Promise<boolean> => {
  const result = await query(
    `UPDATE notify.usernotifications
     SET clearedatutc = CURRENT_TIMESTAMP
     WHERE notificationid = $1 AND recipientuserid = $2 AND clearedatutc IS NULL`,
    [parseNotificationId(dtoId), recipientUserId]
  );
  return (result.rowCount ?? 0) > 0;
};

export const clearAllForUser = async (recipientUserId: number): Promise<number> => {
  const result = await query(
    `UPDATE notify.usernotifications
     SET clearedatutc = CURRENT_TIMESTAMP
     WHERE recipientuserid = $1 AND clearedatutc IS NULL`,
    [recipientUserId]
  );
  return result.rowCount ?? 0;
};

// "Remind me later" — ownership enforced the same way as markRead/clearOne (the WHERE clause
// itself). `untilUtc` in the past effectively un-snoozes immediately (findByUser's snooze
// condition is `> CURRENT_TIMESTAMP`), which is the same behavior a "cancel snooze" action
// would want, so no separate unsnooze endpoint is needed.
export const snoozeOne = async (
  recipientUserId: number,
  dtoId: string,
  untilUtc: Date
): Promise<boolean> => {
  const result = await query(
    `UPDATE notify.usernotifications
     SET snoozeduntilutc = $3
     WHERE notificationid = $1 AND recipientuserid = $2 AND clearedatutc IS NULL`,
    [parseNotificationId(dtoId), recipientUserId, untilUtc]
  );
  return (result.rowCount ?? 0) > 0;
};

// --- Email delivery (digest + immediate-Critical) ---------------------------------------
// See notification.email.ts for the business logic that consumes these. EmailedAtUtc means
// "the email job has finished evaluating this row" (sent, or skipped because the recipient has
// email disabled) — not strictly "an email was sent" — see the column's comment in
// database/19_notify_enhancements.sql for why one column covers both cases.

export interface EmailCandidateRow {
  notificationid: string;
  recipientuserid: number;
  title: string;
  safepreviewtext: string | null;
  typecode: string;
  prioritycode: DbPriority;
  createdatutc: Date;
  recipientemail: string;
  recipientname: string;
  emailenabled: boolean;
}

// Finds not-yet-processed, non-suppressed, non-cleared notifications at the given priorities,
// alongside whether that recipient currently has the single global "Email" preference toggle on
// (see notification.service.ts's REPRESENTATIVE_TYPE_CODES.email — keyed off the 'system' type,
// since the frontend has no per-category email control).
export const findEmailCandidates = async (priorities: DbPriority[]): Promise<EmailCandidateRow[]> => {
  const result = await query<EmailCandidateRow>(
    `SELECT un.notificationid, un.recipientuserid, n.title, n.safepreviewtext, nt.typecode,
            n.prioritycode, n.createdatutc, u.email AS recipientemail, u.displayname AS recipientname,
            COALESCE(pref.emailenabled, FALSE) AS emailenabled
     FROM notify.usernotifications un
     JOIN notify.notifications n ON n.notificationid = un.notificationid
     JOIN notify.notificationtypes nt ON nt.notificationtypeid = n.notificationtypeid
     JOIN iam.users u ON u.userid = un.recipientuserid
     LEFT JOIN notify.usernotificationpreferences pref
       ON pref.userid = un.recipientuserid
      AND pref.notificationtypeid = (SELECT notificationtypeid FROM notify.notificationtypes WHERE typecode = 'system')
     WHERE un.emailedatutc IS NULL
       AND un.deliverystatus <> 'Suppressed'
       AND un.clearedatutc IS NULL
       AND n.prioritycode = ANY($1::text[])
     ORDER BY un.recipientuserid, n.createdatutc`,
    [priorities]
  );
  return result.rows;
};

// Takes the raw DB id (EmailCandidateRow.notificationid, a bare numeric string straight from
// Postgres) — NOT a "notif-N" DTO id, unlike markRead/clearOne/snoozeOne. This is always called
// with rows fetched directly from findEmailCandidates, never with a frontend-supplied id.
export const markEmailProcessed = async (recipientUserId: number, notificationId: string | number): Promise<void> => {
  await query(
    `UPDATE notify.usernotifications
     SET emailedatutc = CURRENT_TIMESTAMP
     WHERE notificationid = $1 AND recipientuserid = $2`,
    [Number(notificationId), recipientUserId]
  );
};

// --- Admin delivery analytics ------------------------------------------------------------

export interface NotificationAnalyticsRow {
  typecode: string;
  categorycode: string;
  total: number;
  delivered: number;
  suppressed: number;
  read: number;
}

export const getDeliveryAnalytics = async (): Promise<NotificationAnalyticsRow[]> => {
  const result = await query<{
    typecode: string;
    categorycode: string;
    total: string;
    delivered: string;
    suppressed: string;
    read: string;
  }>(
    `SELECT nt.typecode, nt.categorycode,
            COUNT(*)::text AS total,
            SUM(CASE WHEN un.deliverystatus = 'Delivered' THEN 1 ELSE 0 END)::text AS delivered,
            SUM(CASE WHEN un.deliverystatus = 'Suppressed' THEN 1 ELSE 0 END)::text AS suppressed,
            SUM(CASE WHEN un.readatutc IS NOT NULL THEN 1 ELSE 0 END)::text AS read
     FROM notify.usernotifications un
     JOIN notify.notifications n ON n.notificationid = un.notificationid
     JOIN notify.notificationtypes nt ON nt.notificationtypeid = n.notificationtypeid
     GROUP BY nt.typecode, nt.categorycode
     ORDER BY total DESC`
  );
  return result.rows.map((row) => ({
    typecode: row.typecode,
    categorycode: row.categorycode,
    total: Number(row.total),
    delivered: Number(row.delivered),
    suppressed: Number(row.suppressed),
    read: Number(row.read)
  }));
};

// --- Preferences -------------------------------------------------------------------------
// The schema's UserNotificationPreferences is per (User, NotificationType) — far more granular
// than the existing frontend's 7-toggle NotificationPreferences UI (which this branch must not
// redesign). Each coarse toggle is backed by one representative TypeCode's row; see
// notification.service.ts's REPRESENTATIVE_TYPE_CODES for the mapping and rationale.
export interface PreferenceRow {
  typeCode: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
}

export const getPreferencesForTypes = async (
  userId: number,
  typeCodes: string[]
): Promise<PreferenceRow[]> => {
  const result = await query<{ typecode: string; inappenabled: boolean; emailenabled: boolean }>(
    `SELECT nt.typecode, unp.inappenabled, unp.emailenabled
     FROM notify.notificationtypes nt
     LEFT JOIN notify.usernotificationpreferences unp
       ON unp.notificationtypeid = nt.notificationtypeid AND unp.userid = $1
     WHERE nt.typecode = ANY($2::text[])`,
    [userId, typeCodes]
  );
  return result.rows.map((row) => ({
    typeCode: row.typecode,
    // NULL means "no explicit row yet" — default to enabled in-app, disabled email, matching
    // the frontend's original in-memory defaults (see AppContext's notificationPreferences
    // initial state prior to this branch).
    inAppEnabled: row.inappenabled ?? true,
    emailEnabled: row.emailenabled ?? false
  }));
};

export const upsertPreference = async (
  userId: number,
  typeCode: string,
  inAppEnabled: boolean,
  emailEnabled: boolean
): Promise<void> => {
  const typeMeta = await getNotificationTypeMeta(typeCode);
  if (!typeMeta) throw new Error(`Unknown notification type code: "${typeCode}"`);

  await query(
    `INSERT INTO notify.usernotificationpreferences (userid, notificationtypeid, inappenabled, emailenabled)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (userid, notificationtypeid)
     DO UPDATE SET inappenabled = EXCLUDED.inappenabled, emailenabled = EXCLUDED.emailenabled`,
    [userId, typeMeta.notificationTypeId, inAppEnabled, emailEnabled]
  );
};
