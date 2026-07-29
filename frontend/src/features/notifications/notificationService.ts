import {
  NotificationItem,
  NotificationPriority,
  NotificationType,
  Project,
  Task,
  User,
  UserRole
} from '../../types';
import { getNotificationTypeMeta, isNotificationVisibleForRole, PRIORITY_ORDER } from './notificationTypes';

// ---------------------------------------------------------------------------------------
// NotificationService — the single business-logic layer for the Notification Module.
//
// UI components and even AppContext's own action functions never build a NotificationItem
// or push into the notifications array directly; they describe *what happened* and call
// through here. Every function is pure (no React, no fetch, no side effects) so it can be
// unit-tested in isolation and — per the module's backend-readiness goal — swapped for a
// thin API-client wrapper later (e.g. sendNotification() becomes a POST /notifications call)
// without any UI component changing. See docs/Notification_Module_Guide.md.
// ---------------------------------------------------------------------------------------

let sequence = 0;
const nextId = (prefix: string) => {
  sequence += 1;
  return `${prefix}-${sequence}`;
};

export interface CreateNotificationInput {
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  actorId?: string;
  actorName?: string;
  linkRoute: string;
  projectId?: string;
  taskId?: string;
  priority?: NotificationPriority;
  metadata?: NotificationItem['metadata'];
}

export const createNotification = (input: CreateNotificationInput): NotificationItem => {
  const now = new Date();
  return {
    id: nextId('notif'),
    userId: input.recipientId,
    actorId: input.actorId,
    actorName: input.actorName,
    title: input.title,
    message: input.message,
    type: input.type,
    priority: input.priority || getNotificationTypeMeta(input.type).priority,
    read: false,
    timestamp: now.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    createdAt: now.toISOString(),
    linkRoute: input.linkRoute,
    projectId: input.projectId,
    taskId: input.taskId,
    metadata: input.metadata
  };
};

export interface SendNotificationInput extends Omit<CreateNotificationInput, 'recipientId'> {
  recipientIds: string[];
  // Per-recipient message override. The same event reads differently depending on who's
  // reading it — the assignee should see "assigned you", but their Team Lead reading the
  // same event should see "assigned Priya" (never "assigned you", since it wasn't them).
  // Falls back to `message` for any recipient not present in this map.
  recipientMessages?: Record<string, string>;
}

// The single entry point AppContext calls after every trigger event. Builds one
// NotificationItem per unique, non-empty recipient id (actor exclusion already happened in
// resolveRecipients — see below).
export const sendNotification = (input: SendNotificationInput): NotificationItem[] => {
  const uniqueRecipients = Array.from(new Set(input.recipientIds.filter(Boolean)));
  return uniqueRecipients.map((recipientId) =>
    createNotification({
      ...input,
      recipientId,
      message: input.recipientMessages?.[recipientId] ?? input.message
    })
  );
};

// --- Recipient resolution (RBAC) -------------------------------------------------------
// These encode the PRD §6.5 visibility rules. Each helper excludes the acting user by
// default, since nobody needs to be told about the action they themselves just took.

const without = (ids: (string | undefined | null)[], excludeUserId?: string): string[] =>
  Array.from(new Set(ids.filter((id): id is string => Boolean(id) && id !== excludeUserId)));

export const resolveTaskRecipients = (params: {
  task: Task;
  project?: Project;
  excludeUserId?: string;
}): string[] => {
  const { task, project, excludeUserId } = params;
  const assigneeIds = (task as Task & { assigneeIds?: string[] }).assigneeIds?.length
    ? (task as Task & { assigneeIds?: string[] }).assigneeIds!
    : [task.assigneeId];
  return without([...assigneeIds, task.creatorId, project?.teamLeadId], excludeUserId);
};

export const resolveProjectRecipients = (params: {
  project: Project;
  includeMembers?: boolean;
  excludeUserId?: string;
}): string[] => {
  const { project, includeMembers = true, excludeUserId } = params;
  const ids = [project.teamLeadId, ...(includeMembers ? project.memberIds : [])];
  return without(ids, excludeUserId);
};

export const resolveAdminRecipients = (users: User[], excludeUserId?: string): string[] =>
  without(
    users.filter((user) => user.role === 'Admin').map((user) => user.id),
    excludeUserId
  );

export const resolveSingleRecipient = (userId: string | undefined, excludeUserId?: string): string[] =>
  without([userId], excludeUserId);

// --- Read / clear / query ---------------------------------------------------------------

export const markAsRead = (notifications: NotificationItem[], id: string): NotificationItem[] =>
  notifications.map((notification) =>
    notification.id === id && !notification.read
      ? { ...notification, read: true, readAt: new Date().toISOString() }
      : notification
  );

// Only marks the given user's own notifications — `notifications` is a shared array holding
// every recipient's items in this in-memory prototype, so this must not touch anyone else's.
export const markAllAsRead = (notifications: NotificationItem[], userId: string): NotificationItem[] =>
  notifications.map((notification) =>
    notification.userId === userId && !notification.read
      ? { ...notification, read: true, readAt: new Date().toISOString() }
      : notification
  );

// FR-10: users may only delete their own notifications; a mismatched owner is a silent no-op
// rather than throwing, since a future API would simply 403 and the UI never offers the
// control for notifications that aren't the viewer's own.
export const clearNotification = (
  notifications: NotificationItem[],
  id: string,
  requestingUserId: string
): NotificationItem[] =>
  notifications.filter((notification) => !(notification.id === id && notification.userId === requestingUserId));

export const getUnreadNotifications = (notifications: NotificationItem[], userId: string): NotificationItem[] =>
  notifications.filter((notification) => notification.userId === userId && !notification.read);

// Local-fallback-only "remind me later": the backend tracks a real SnoozedUntilUtc and
// re-surfaces the notification automatically once it passes (see
// notification.repository.ts). This in-memory prototype has no persistent scheduler to bring an
// item back later, so the closest honest approximation is to drop it the same way
// clearNotification does — same ownership check, same silent no-op for a mismatched owner.
export const snoozeNotification = (
  notifications: NotificationItem[],
  id: string,
  requestingUserId: string
): NotificationItem[] =>
  notifications.filter((notification) => !(notification.id === id && notification.userId === requestingUserId));

export const sortNotifications = (
  notifications: NotificationItem[],
  sortBy: 'newest' | 'oldest' | 'priority' | 'unreadFirst' = 'newest'
): NotificationItem[] => {
  const withIndex = notifications.map((notification, index) => ({ notification, index }));
  withIndex.sort((a, b) => {
    switch (sortBy) {
      case 'oldest':
        return (a.notification.createdAt || '').localeCompare(b.notification.createdAt || '') || a.index - b.index;
      case 'priority':
        return (
          PRIORITY_ORDER[a.notification.priority || 'Low'] - PRIORITY_ORDER[b.notification.priority || 'Low']
        );
      case 'unreadFirst':
        return Number(a.notification.read) - Number(b.notification.read);
      case 'newest':
      default:
        return (b.notification.createdAt || '').localeCompare(a.notification.createdAt || '') || a.index - b.index;
    }
  });
  return withIndex.map((item) => item.notification);
};

// Recipient targeting (resolveRecipients + sendNotification) is the primary RBAC gate —
// this adds a defensive second check by role, per NOTIFICATION §6.2/§6.4 deny-lists, so a
// future trigger that forgets to scope recipients correctly still can't leak system-level
// noise to a Team Member or routine task chatter to an Admin.
export const getNotificationsByUser = (
  notifications: NotificationItem[],
  userId: string,
  role: UserRole
): NotificationItem[] =>
  sortNotifications(
    notifications.filter(
      (notification) => notification.userId === userId && isNotificationVisibleForRole(notification.type, role)
    )
  );

export const getNotificationsByProject = (
  notifications: NotificationItem[],
  projectId: string
): NotificationItem[] => sortNotifications(notifications.filter((notification) => notification.projectId === projectId));

export interface NotificationFilters {
  search?: string;
  unreadOnly?: boolean;
  type?: NotificationType | 'All';
  priority?: NotificationPriority | 'All';
  dateRange?: 'Today' | 'ThisWeek' | 'All';
}

const isWithinDateRange = (createdAt: string | undefined, range: NotificationFilters['dateRange']): boolean => {
  if (!range || range === 'All' || !createdAt) return true;
  const created = new Date(createdAt);
  const now = new Date();
  if (range === 'Today') {
    return created.toDateString() === now.toDateString();
  }
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);
  return created >= weekAgo;
};

export const filterNotifications = (
  notifications: NotificationItem[],
  filters: NotificationFilters
): NotificationItem[] => {
  const search = filters.search?.trim().toLowerCase();
  return notifications.filter((notification) => {
    if (filters.unreadOnly && notification.read) return false;
    if (filters.type && filters.type !== 'All' && notification.type !== filters.type) return false;
    if (filters.priority && filters.priority !== 'All' && notification.priority !== filters.priority) return false;
    if (!isWithinDateRange(notification.createdAt, filters.dateRange)) return false;
    if (search) {
      const haystack = `${notification.title} ${notification.message}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
};

export interface NotificationGroup {
  key: string;
  // Newest-first, matching the ordering of the array passed in. items[0] is the representative
  // shown when the group is collapsed (e.g. "5 new comments on Task X" using its title/message).
  items: NotificationItem[];
}

// Collapses same-type, same-target notifications (e.g. 5 separate `comment_added` events on the
// same task) into one group, so the UI can render "5 new comments on Task X" instead of 5 rows —
// cuts noise on busy tasks/projects without losing any individual notification (NotificationsView
// can still expand a group to show every item). Only groups items that share a real target
// (taskId or projectId); anything without one (most System/Approval/AI events) is never grouped,
// since "5 unrelated system alerts" collapsing into one row would hide information, not noise.
//
// Applied to whatever page of results is currently displayed, not the full unfiltered list —
// simple and correct for the common case, though a group can in principle be split across two
// pages at a page-size boundary (rare in practice, and purely cosmetic when it happens).
export const groupNotifications = (notifications: NotificationItem[]): NotificationGroup[] => {
  const order: string[] = [];
  const buckets = new Map<string, NotificationItem[]>();

  notifications.forEach((notification) => {
    const hasTarget = Boolean(notification.taskId || notification.projectId);
    const key = hasTarget
      ? `${notification.type}:${notification.projectId ?? ''}:${notification.taskId ?? ''}`
      : `__single__:${notification.id}`;
    if (!buckets.has(key)) {
      buckets.set(key, []);
      order.push(key);
    }
    buckets.get(key)!.push(notification);
  });

  return order.map((key) => ({ key, items: buckets.get(key)! }));
};

export const paginateNotifications = (
  notifications: NotificationItem[],
  page: number,
  pageSize = 20
): { items: NotificationItem[]; totalPages: number } => {
  const totalPages = Math.max(1, Math.ceil(notifications.length / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  return { items: notifications.slice(start, start + pageSize), totalPages };
};
