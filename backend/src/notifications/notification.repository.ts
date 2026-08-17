import { query, withTransaction } from '../db/pool.js';
import { toProjectPk, toProjectPkOrNull, toTaskPkOrNull, toUserPk, toUserPkOrNull } from '../utils/idMapping.js';
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
  n.detailtext,
  n.metadatajson,
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

const truncate = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 3)}...` : value;

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
          attendancecorrectionid, leaverequestid, title, safepreviewtext, detailtext,
          metadatajson, prioritycode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
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
        truncate(event.message, 500),
        // DetailText is varchar(4000) — long enough for any rejection reason or review comment
        // we produce, but truncated defensively rather than letting a pathological input turn a
        // notification insert into a 22001 error that would roll back the whole publish.
        event.detail ? truncate(event.detail, 4000) : null,
        event.metadata ? JSON.stringify(event.metadata) : null,
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
// alongside whether that recipient currently has the single global "Email" preference toggle on.
// Defaults to TRUE (opt-out) when the recipient has no preference row yet -- Critical/High
// events (task review requests, approvals, etc.) must actually reach a real inbox out of the
// box, not silently depend on every user first discovering and enabling a settings toggle.
// (see notification.service.ts's REPRESENTATIVE_TYPE_CODES.email — keyed off the 'system' type,
// since the frontend has no per-category email control).
export const findEmailCandidates = async (priorities: DbPriority[]): Promise<EmailCandidateRow[]> => {
  const result = await query<EmailCandidateRow>(
    `SELECT un.notificationid, un.recipientuserid, n.title, n.safepreviewtext, nt.typecode,
            n.prioritycode, n.createdatutc, u.email AS recipientemail, u.displayname AS recipientname,
            COALESCE(pref.emailenabled, TRUE) AS emailenabled
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

// Drops recipients who cannot actually receive a notification: the seeded system actor
// (AccountStatus 'Locked'), plus any deactivated/pending account. Without this, a locked
// service account that happens to be listed as a task assignee silently accumulates
// notifications forever and skews the Admin per-user analytics -- it can never sign in to read
// them. Returns the subset of `userIds` that are genuinely deliverable.
export const filterDeliverableRecipients = async (userIds: number[]): Promise<number[]> => {
  if (userIds.length === 0) return [];
  const result = await query<{ userid: number }>(
    `SELECT userid FROM iam.users
     WHERE userid = ANY($1::int[]) AND accountstatus = 'Active' AND deactivatedatutc IS NULL`,
    [userIds]
  );
  return result.rows.map((row) => row.userid);
};

// --- Admin per-user analytics --------------------------------------------------------------
// Same delivery data as getDeliveryAnalytics above, grouped by NotificationRow.recipientuserid
// instead of by type — "which user saw which notification, how much of it they read, and what
// they engage with most" (per-user drill-down), rather than an org-wide type breakdown.

export interface UserAnalyticsFilters {
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'total' | 'readRate' | 'name';
}

export interface UserAnalyticsRow {
  userid: number;
  displayname: string;
  email: string;
  total: number;
  delivered: number;
  read: number;
  lastnotifiedatutc: string | null;
  lastreadatutc: string | null;
}

export const getUserAnalyticsList = async (
  filters: UserAnalyticsFilters = {}
): Promise<{ rows: UserAnalyticsRow[]; total: number }> => {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.search) {
    params.push(`%${filters.search}%`);
    conditions.push(`(u.displayname ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(DISTINCT un.recipientuserid)::text AS count
     FROM notify.usernotifications un
     JOIN iam.users u ON u.userid = un.recipientuserid
     ${whereClause}`,
    params
  );
  const total = Number(countResult.rows[0]?.count || 0);

  const pageSize = filters.pageSize && filters.pageSize > 0 ? filters.pageSize : 20;
  const page = filters.page && filters.page > 0 ? filters.page : 1;
  const offset = (page - 1) * pageSize;

  const orderClause =
    filters.sortBy === 'name'
      ? 'u.displayname ASC'
      // Read rate can't be computed until after the query returns (division happens in the
      // service layer), so "sort by read rate" is approximated here by read-count share --
      // exact enough for ordering, and avoids a division-by-zero case in raw SQL.
      : filters.sortBy === 'readRate'
        ? '(SUM(CASE WHEN un.readatutc IS NOT NULL THEN 1 ELSE 0 END)::float / NULLIF(COUNT(*), 0)) DESC'
        : 'total DESC';

  const dataResult = await query<{
    userid: string;
    displayname: string;
    email: string;
    total: string;
    delivered: string;
    read: string;
    lastnotifiedatutc: string | null;
    lastreadatutc: string | null;
  }>(
    `SELECT un.recipientuserid AS userid, u.displayname, u.email,
            COUNT(*)::text AS total,
            SUM(CASE WHEN un.deliverystatus = 'Delivered' THEN 1 ELSE 0 END)::text AS delivered,
            SUM(CASE WHEN un.readatutc IS NOT NULL THEN 1 ELSE 0 END)::text AS read,
            MAX(n.createdatutc) AS lastnotifiedatutc,
            MAX(un.readatutc) AS lastreadatutc
     FROM notify.usernotifications un
     JOIN notify.notifications n ON n.notificationid = un.notificationid
     JOIN iam.users u ON u.userid = un.recipientuserid
     ${whereClause}
     GROUP BY un.recipientuserid, u.displayname, u.email
     ORDER BY ${orderClause}
     LIMIT ${pageSize} OFFSET ${offset}`,
    params
  );

  return {
    rows: dataResult.rows.map((row) => ({
      userid: Number(row.userid),
      displayname: row.displayname,
      email: row.email,
      total: Number(row.total),
      delivered: Number(row.delivered),
      read: Number(row.read),
      lastnotifiedatutc: row.lastnotifiedatutc,
      lastreadatutc: row.lastreadatutc
    })),
    total
  };
};

export interface UserTopCategoryRow {
  userid: number;
  categorycode: string;
  readcount: number;
}

// "Interest" = the category this user reads the most of, one row per user. DISTINCT ON picks
// the highest-readcount row per recipientuserid (Postgres-specific, matches the ORDER BY it's
// paired with) -- users with zero reads are simply absent, handled by the service layer.
export const getTopCategoriesForUsers = async (userIds: number[]): Promise<UserTopCategoryRow[]> => {
  if (userIds.length === 0) return [];
  const result = await query<{ userid: string; categorycode: string; readcount: string }>(
    `SELECT DISTINCT ON (un.recipientuserid)
            un.recipientuserid AS userid, nt.categorycode, COUNT(*)::text AS readcount
     FROM notify.usernotifications un
     JOIN notify.notifications n ON n.notificationid = un.notificationid
     JOIN notify.notificationtypes nt ON nt.notificationtypeid = n.notificationtypeid
     WHERE un.readatutc IS NOT NULL AND un.recipientuserid = ANY($1::int[])
     GROUP BY un.recipientuserid, nt.categorycode
     ORDER BY un.recipientuserid, COUNT(*) DESC`,
    [userIds]
  );
  return result.rows.map((row) => ({
    userid: Number(row.userid),
    categorycode: row.categorycode,
    readcount: Number(row.readcount)
  }));
};

export interface UserCategoryBreakdownRow {
  categorycode: string;
  typecode: string;
  total: number;
  read: number;
}

// Full per-type breakdown for one user -- backs the analytics drill-down drawer's "interest"
// chart (which categories/types this specific person actually reads vs. just receives).
export const getUserAnalyticsDetail = async (userId: number): Promise<UserCategoryBreakdownRow[]> => {
  const result = await query<{ categorycode: string; typecode: string; total: string; read: string }>(
    `SELECT nt.categorycode, nt.typecode,
            COUNT(*)::text AS total,
            SUM(CASE WHEN un.readatutc IS NOT NULL THEN 1 ELSE 0 END)::text AS read
     FROM notify.usernotifications un
     JOIN notify.notifications n ON n.notificationid = un.notificationid
     JOIN notify.notificationtypes nt ON nt.notificationtypeid = n.notificationtypeid
     WHERE un.recipientuserid = $1
     GROUP BY nt.categorycode, nt.typecode
     ORDER BY total DESC`,
    [userId]
  );
  return result.rows.map((row) => ({
    categorycode: row.categorycode,
    typecode: row.typecode,
    total: Number(row.total),
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
    // NULL means "no explicit row yet" — default both to enabled (opt-out, not opt-in): a
    // Critical/High-priority event (task review requests, approvals, etc.) must reach a real
    // inbox out of the box, not silently depend on every user first discovering and enabling an
    // email settings toggle. See the matching default in findEmailCandidates below.
    inAppEnabled: row.inappenabled ?? true,
    emailEnabled: row.emailenabled ?? true
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

// When an event of `typeCode` was last raised for `projectId`, or null if never. Reads the
// Notifications row itself (not per-recipient UserNotifications), so the answer is "was this
// announced", independent of who received it or whether they cleared it. Exists so a caller can
// make an event fire once per occurrence rather than once per triggering action — see
// task.service.ts's maybeAnnounceProjectCompletion.
export const findLatestNotificationTimeForProject = async (
  projectId: string,
  typeCode: string
): Promise<Date | null> => {
  const result = await query<{ latest: Date | null }>(
    `SELECT MAX(n.createdatutc) AS latest
       FROM notify.notifications n
       JOIN notify.notificationtypes nt ON nt.notificationtypeid = n.notificationtypeid
      WHERE n.projectid = $1 AND nt.typecode = $2`,
    [toProjectPk(projectId), typeCode]
  );
  return result.rows[0]?.latest || null;
};
