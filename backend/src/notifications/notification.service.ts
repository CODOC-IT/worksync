import * as repo from './notification.repository.js';
import { API_TO_DB_PRIORITY, deriveLinkRoute, rowToNotificationDTO } from './notification.mapper.js';
import { toUserPk, fromUserPk } from '../utils/idMapping.js';
import { processEmailCandidates } from './notification.email.js';
import { getSupabaseClient } from '../db/pool.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import { userStore } from '../store/userStore.js';
import { actorDisplayName, normalizeActorMessage } from '../utils/actorDisplay.js';
import {
  NotificationCategory,
  NotificationDTO,
  NotificationEvent,
  NotificationListQuery,
  NotificationPreferencesDTO,
  UserAnalyticsListQuery,
  UserNotificationAnalyticsDTO,
  UserNotificationCategoryBreakdownDTO
} from './notification.types.js';

export interface NotificationAnalyticsDTO {
  type: string;
  category: string;
  total: number;
  delivered: number;
  suppressed: number;
  read: number;
  readRate: number; // read / delivered, 0 when nothing has been delivered yet
}

// Notification Service — the one place business logic lives (Service Layer / Clean
// Architecture). No SQL here (that's notification.repository.ts); no Express req/res here
// (that's notification.controller.ts). Every other backend module "publishes an event" by
// calling publishEvent() — see the architecture diagram in docs/Notification_Module_Guide.md —
// and never touches notify.* tables directly.

// Coarse preference toggles the existing frontend UI exposes (NotificationsView's Preferences
// panel) map onto one "representative" NotificationType row each in
// notify.UserNotificationPreferences, since that table is per-(user, type) — far more granular
// than 7 UI toggles. `system` doubles as the master kill-switch (inApp) and the single global
// email toggle, since the UI has no per-category email control either.
const REPRESENTATIVE_TYPE_CODES: Record<keyof Omit<NotificationPreferencesDTO, 'toast'>, string> = {
  inApp: 'system',
  dueReminders: 'task_due_tomorrow',
  mentions: 'mention',
  comments: 'comment_added',
  assignments: 'task_assigned',
  email: 'system'
};

// Which specific event types are gated by which coarse preference category, beyond the global
// `inApp` master switch that gates everything. A type absent from this map is only ever gated
// by `inApp` — there's no narrower frontend toggle for e.g. project/system/attendance events.
const TYPE_TO_PREFERENCE_CATEGORY: Partial<Record<string, 'assignments' | 'mentions' | 'comments' | 'dueReminders'>> = {
  task_assigned: 'assignments',
  task_reassigned: 'assignments',
  mention: 'mentions',
  comment_added: 'comments',
  chat_reply: 'comments',
  chat_thread_reply: 'comments',
  task_due_today: 'dueReminders',
  task_due_tomorrow: 'dueReminders',
  task_overdue: 'dueReminders'
};

// Human-readable label for each persisted preference toggle, used only for Activity Log
// descriptions below. `toast` is deliberately absent — it's never persisted (see comment
// above) so a toast change never produces an Activity Log entry.
const PREFERENCE_ACTIVITY_LABELS: Record<Exclude<keyof NotificationPreferencesDTO, 'toast'>, string> = {
  inApp: 'in-app notifications',
  dueReminders: 'due reminder notifications',
  mentions: 'mention notifications',
  comments: 'comment notifications',
  assignments: 'assignment notifications',
  email: 'email notifications'
};

// Activity Log entry per changed preference, so a member/lead/HR/admin toggling notification
// settings shows up as e.g. "Bilal turned off in-app notifications." Module is 'Notifications'
// rather than 'Settings' so a plain Team Member's own change stays visible to them — the
// Activity Log's module blocklist for plain Team Members excludes 'Settings' entirely (see
// activity.repository.ts's buildMemberClause), and this event carries no projectId/taskId, so
// only the actor themselves, HR, and Admin ever match its visibility scope.
const logPreferenceChanges = (
  userId: string,
  current: NotificationPreferencesDTO,
  next: NotificationPreferencesDTO,
  requested: Partial<NotificationPreferencesDTO>
): void => {
  const actor = userStore.findById(userId);
  const actorName = actorDisplayName(userId);
  (Object.keys(requested) as (keyof NotificationPreferencesDTO)[]).forEach((key) => {
    if (key === 'toast') return;
    if (current[key] === next[key]) return; // no actual change — never log a no-op
    const label = PREFERENCE_ACTIVITY_LABELS[key];
    const turnedOn = next[key];
    recordActivitySafe({
      actorId: userId,
      actorName: actor?.name,
      actorEmail: actor?.email,
      actorRole: actor?.role,
      action: 'Preference Changed',
      module: 'Notifications',
      entityType: 'Notification Preference',
      entityId: `notification-preference-${key}`,
      entityName: label,
      description: `${actorName} turned ${turnedOn ? 'on' : 'off'} ${label}.`,
      changes: [{ field: label, previousValue: String(current[key]), newValue: String(next[key]) }],
      source: 'Web'
    });
  });
};

const isSuppressedForRecipient = async (recipientUserId: number, typeCode: string): Promise<boolean> => {
  const category = TYPE_TO_PREFERENCE_CATEGORY[typeCode];
  const typeCodesToCheck = new Set<string>([REPRESENTATIVE_TYPE_CODES.inApp]);
  if (category) typeCodesToCheck.add(REPRESENTATIVE_TYPE_CODES[category]);

  const prefs = await repo.getPreferencesForTypes(recipientUserId, Array.from(typeCodesToCheck));
  const byType = new Map(prefs.map((pref) => [pref.typeCode, pref]));

  const masterEnabled = byType.get(REPRESENTATIVE_TYPE_CODES.inApp)?.inAppEnabled ?? true;
  if (!masterEnabled) return true;

  if (category) {
    const categoryEnabled = byType.get(REPRESENTATIVE_TYPE_CODES[category])?.inAppEnabled ?? true;
    if (!categoryEnabled) return true;
  }

  return false;
};

// When an event of `type` was last published for a project, or null if never. Lets a producer
// make an event idempotent per real-world occurrence instead of per triggering action, without
// needing its own state or reaching into notify.* itself (this module owns that SQL).
export const getLatestEventTimeForProject = async (
  projectId: string,
  type: NotificationEvent['type']
): Promise<Date | null> => repo.findLatestNotificationTimeForProject(projectId, type);

// The single entry point every module (existing or new) calls to raise an event. Resolves the
// NotificationType's category/default priority, evaluates each recipient's preferences to
// decide delivered-vs-suppressed, persists via the repository, and returns the created rows as
// frontend-ready DTOs (so e.g. POST /notifications can hand back exactly what was created).
export const publishEvent = async (event: NotificationEvent): Promise<NotificationDTO[]> => {
  if (event.recipientIds.length === 0) return [];

  const typeMeta = await repo.getNotificationTypeMeta(event.type);
  if (!typeMeta) {
    throw new Error(
      `Unknown notification type "${event.type}" — add it to database/18_notify_seed.sql's ` +
      `notify.NotificationTypes seed before publishing it.`
    );
  }

  const priority = event.priority ?? typeMeta.defaultPriority;
  const requestedPks = Array.from(new Set(event.recipientIds.map(toUserPk)));

  // Drop recipients who could never read the notification anyway (locked service accounts,
  // deactivated/pending users) before anything is written — see filterDeliverableRecipients.
  const deliverablePks = new Set(await repo.filterDeliverableRecipients(requestedPks));
  const recipientIds = Array.from(new Set(event.recipientIds)).filter((id) =>
    deliverablePks.has(toUserPk(id))
  );
  if (recipientIds.length === 0) return [];
  event = { ...event, recipientIds };

  // Centralized actor-name repair: every module in the app publishes through this one function
  // (see the doc comment above), so sanitizing here — rather than auditing and fixing every
  // individual call site in task.service.ts/project.service.ts/AppContext.tsx/etc. — guarantees
  // no notification can ever persist with a raw "usr-<n>" id or the legacy "Someone" placeholder
  // baked into its text, regardless of what the calling module happened to construct (e.g. a
  // userStore cache miss at the moment actorDisplayName was called there — see its own comment).
  // Applied to title/message/detail and every per-recipient override, before anything is written,
  // so it also protects the in-memory DTOs this function returns (used for the immediate API
  // response and the live Realtime broadcast), not only what a later GET /notifications re-fetch
  // would show via notification.mapper.ts's identical read-time repair.
  const resolvedActorName = actorDisplayName(event.actorId);
  event = {
    ...event,
    title: normalizeActorMessage(event.title, resolvedActorName),
    message: normalizeActorMessage(event.message, resolvedActorName),
    detail: event.detail ? normalizeActorMessage(event.detail, resolvedActorName) : event.detail,
    recipientMessages: event.recipientMessages
      ? Object.fromEntries(
          Object.entries(event.recipientMessages).map(([id, text]) => [
            id,
            normalizeActorMessage(text, resolvedActorName)
          ])
        )
      : event.recipientMessages,
    recipientDetails: event.recipientDetails
      ? Object.fromEntries(
          Object.entries(event.recipientDetails).map(([id, text]) => [
            id,
            normalizeActorMessage(text, resolvedActorName)
          ])
        )
      : event.recipientDetails
  };

  const suppressedUserIds = new Set<number>();
  for (const recipientPk of deliverablePks) {
    if (await isSuppressedForRecipient(recipientPk, event.type)) {
      suppressedUserIds.add(recipientPk);
    }
  }

  // Per-recipient message/detail text (see frontend's identical `recipientMessages` pattern)
  // means each distinct wording technically gets its own Notification row rather than every
  // recipient sharing one — the schema has no per-UserNotification override column, and
  // SafePreviewText/DetailText are per-Notification. This trades a little storage for
  // correctness (never showing the wrong pronoun to the wrong reader), consistent with why the
  // frontend feature was built this way in the first place (see
  // docs/Notification_Module_Guide.md's message-personalization section).
  const created: NotificationDTO[] = [];
  const linkRoute = deriveLinkRoute(typeMeta.categoryCode, event.type);
  const buckets = new Map<string, { message: string; detail?: string; recipientIds: string[] }>();
  for (const recipientId of event.recipientIds) {
    const message = event.recipientMessages?.[recipientId] ?? event.message;
    const detail = event.recipientDetails?.[recipientId] ?? event.detail;
    // Keyed on both parts so a shared preview with differing detail (or vice versa) never
    // collapses two genuinely different notifications into one row. The separator is a
    // delimiter string that cannot appear in either half.
    const key = `${message}||~||${detail ?? ''}`;
    const bucket = buckets.get(key) || { message, detail, recipientIds: [] };
    bucket.recipientIds.push(recipientId);
    buckets.set(key, bucket);
  }

  for (const { message, detail, recipientIds } of buckets.values()) {
    const scopedEvent: NotificationEvent = { ...event, message, detail, recipientIds };
    const result = await repo.insertNotificationWithFanout(
      scopedEvent,
      typeMeta.notificationTypeId,
      priority,
      new Set(recipientIds.map(toUserPk).filter((pk) => suppressedUserIds.has(pk)))
    );

    for (const recipient of result.recipients) {
      if (recipient.deliveryStatus === 'Suppressed') continue;
      created.push({
        id: `notif-${result.notificationId}`,
        userId: fromUserPk(recipient.recipientUserId),
        actorId: event.actorId,
        title: event.title,
        message,
        detail,
        metadata: event.metadata,
        type: event.type,
        priority: priority === 'Normal' ? 'Medium' : (priority as NotificationDTO['priority']),
        read: false,
        timestamp: new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
        createdAt: new Date().toISOString(),
        // Derived from the same lookup findByUser's mapper uses, so a notification that arrives
        // live (Supabase broadcast / the publisher's own response) deep-links to exactly the same
        // tab it will after a refetch. This used to be hardcoded to 'notifications', which left a
        // just-published notification inert until the page was reloaded.
        linkRoute,
        projectId: event.projectId,
        taskId: event.taskId
      });
    }
  }

  // Critical-priority notifications get an immediate email attempt rather than waiting for the
  // periodic digest (see notification.email.ts) — fire-and-forget so a slow/failed SMTP send
  // never delays the HTTP response this publishEvent call is part of. High-priority items are
  // left for the scheduled digest job in server.ts to pick up on its next run.
  if (priority === 'Critical' && created.length > 0) {
    processEmailCandidates(['Critical']).catch((error) => {
      console.warn('[notification.service] Immediate Critical email dispatch failed.', error);
    });
  }

  // Broadcast via Supabase Realtime so the frontend receives notifications instantly
  // without polling. Fire-and-forget — a broadcast failure must never break the HTTP response.
  const supabaseClient = getSupabaseClient();
  if (supabaseClient) {
    created.forEach((notification) => {
      supabaseClient
        .channel('worksync-notifications')
        .send({ type: 'broadcast', event: 'notification', payload: { notification } })
        .then(() => {
          // Successfully broadcast
        })
        .catch((err) => {
          console.warn('[notification.service] Supabase broadcast failed.', err.message);
        });
    });
  }

  return created;
};

export const snoozeNotification = (
  userId: string,
  notificationId: string,
  untilIso: string
): Promise<boolean> => repo.snoozeOne(toUserPk(userId), notificationId, new Date(untilIso));

export const getDeliveryAnalytics = async (): Promise<NotificationAnalyticsDTO[]> => {
  const rows = await repo.getDeliveryAnalytics();
  return rows.map((row) => ({
    type: row.typecode,
    category: row.categorycode,
    total: row.total,
    delivered: row.delivered,
    suppressed: row.suppressed,
    read: row.read,
    readRate: row.delivered > 0 ? Math.round((row.read / row.delivered) * 1000) / 10 : 0
  }));
};

// Admin per-user analytics — who saw which notification, what they're actually reading
// ("interest" = the category they read the most of), and their personal read percentage.
// Two queries (list + top-category) rather than one combined window-function query, matching
// this file's existing preference for readable, separately-testable repository calls.
export const getUserAnalytics = async (
  filters: UserAnalyticsListQuery = {}
): Promise<{ items: UserNotificationAnalyticsDTO[]; total: number }> => {
  const { rows, total } = await repo.getUserAnalyticsList(filters);
  if (rows.length === 0) return { items: [], total };

  const topCategories = await repo.getTopCategoriesForUsers(rows.map((row) => row.userid));
  const topCategoryByUser = new Map(topCategories.map((row) => [row.userid, row.categorycode]));

  const items = rows.map((row) => ({
    userId: fromUserPk(row.userid),
    name: row.displayname,
    email: row.email,
    totalReceived: row.total,
    totalDelivered: row.delivered,
    totalRead: row.read,
    readRate: row.delivered > 0 ? Math.round((row.read / row.delivered) * 1000) / 10 : 0,
    topInterest: (topCategoryByUser.get(row.userid) as NotificationCategory) ?? null,
    lastNotifiedAt: row.lastnotifiedatutc,
    lastReadAt: row.lastreadatutc
  }));

  return { items, total };
};

export const getUserAnalyticsDetail = async (
  userId: string
): Promise<UserNotificationCategoryBreakdownDTO[]> => {
  const rows = await repo.getUserAnalyticsDetail(toUserPk(userId));
  return rows.map((row) => ({
    category: row.categorycode as NotificationCategory,
    type: row.typecode as UserNotificationCategoryBreakdownDTO['type'],
    total: row.total,
    read: row.read,
    readRate: row.total > 0 ? Math.round((row.read / row.total) * 1000) / 10 : 0
  }));
};

export const getNotificationsForUser = async (
  userId: string,
  filters: NotificationListQuery = {}
): Promise<{ items: NotificationDTO[]; total: number }> => {
  const { rows, total } = await repo.findByUser(toUserPk(userId), {
    unreadOnly: filters.unreadOnly,
    typeCode: filters.type,
    priority: filters.priority ? API_TO_DB_PRIORITY[filters.priority] : undefined,
    search: filters.search,
    page: filters.page,
    pageSize: filters.pageSize
  });
  return { items: rows.map(rowToNotificationDTO), total };
};

export const getUnreadForUser = async (userId: string): Promise<NotificationDTO[]> => {
  const rows = await repo.findUnreadByUser(toUserPk(userId));
  return rows.map(rowToNotificationDTO);
};

export const markNotificationRead = (userId: string, notificationId: string): Promise<boolean> =>
  repo.markRead(toUserPk(userId), notificationId);

export const markAllNotificationsRead = (userId: string): Promise<number> =>
  repo.markAllRead(toUserPk(userId));

export const clearNotification = (userId: string, notificationId: string): Promise<boolean> =>
  repo.clearOne(toUserPk(userId), notificationId);

export const clearAllNotifications = (userId: string): Promise<number> =>
  repo.clearAllForUser(toUserPk(userId));

export const getPreferences = async (userId: string): Promise<NotificationPreferencesDTO> => {
  const uniqueTypeCodes = Array.from(new Set(Object.values(REPRESENTATIVE_TYPE_CODES)));
  const rows = await repo.getPreferencesForTypes(toUserPk(userId), uniqueTypeCodes);
  const byType = new Map(rows.map((row) => [row.typeCode, row]));

  return {
    toast: true, // client-side only preference, never persisted server-side — see docs
    inApp: byType.get(REPRESENTATIVE_TYPE_CODES.inApp)?.inAppEnabled ?? true,
    dueReminders: byType.get(REPRESENTATIVE_TYPE_CODES.dueReminders)?.inAppEnabled ?? true,
    mentions: byType.get(REPRESENTATIVE_TYPE_CODES.mentions)?.inAppEnabled ?? true,
    comments: byType.get(REPRESENTATIVE_TYPE_CODES.comments)?.inAppEnabled ?? true,
    assignments: byType.get(REPRESENTATIVE_TYPE_CODES.assignments)?.inAppEnabled ?? true,
    email: byType.get(REPRESENTATIVE_TYPE_CODES.email)?.emailEnabled ?? true
  };
};

export const updatePreferences = async (
  userId: string,
  data: Partial<NotificationPreferencesDTO>
): Promise<NotificationPreferencesDTO> => {
  const userPk = toUserPk(userId);
  const current = await getPreferences(userId);
  const next: NotificationPreferencesDTO = { ...current, ...data };

  const writes: Promise<void>[] = [];
  (Object.keys(REPRESENTATIVE_TYPE_CODES) as (keyof typeof REPRESENTATIVE_TYPE_CODES)[]).forEach((key) => {
    if (key === 'email') return; // written alongside `inApp`'s representative row below
    if (!(key in data)) return;
    writes.push(repo.upsertPreference(userPk, REPRESENTATIVE_TYPE_CODES[key], next[key], next.email));
  });
  if ('email' in data && !('inApp' in data)) {
    writes.push(repo.upsertPreference(userPk, REPRESENTATIVE_TYPE_CODES.inApp, next.inApp, next.email));
  }

  await Promise.all(writes);
  logPreferenceChanges(userId, current, next, data);
  return next;
};
