import { fromProjectPk, fromTaskPk, fromUserPk } from '../utils/idMapping.js';
import { ApiPriority, DbPriority, NotificationCategory, NotificationDTO, NotificationType } from './notification.types.js';

// One row per notification, already joined against NotificationTypes (for TypeCode/
// CategoryCode) and iam.Users (for the actor's display name) — see
// notification.repository.ts's SELECT list. Column names are lowercase because Postgres folds
// unquoted identifiers, which is what every table in database/*.sql uses.
export interface NotificationRow {
  notificationid: string; // bigint comes back as string from node-postgres by default
  recipientuserid: number;
  actoruserid: number | null;
  actordisplayname: string | null;
  title: string;
  safepreviewtext: string | null;
  typecode: string;
  categorycode: string;
  prioritycode: DbPriority;
  readatutc: Date | null;
  createdatutc: Date;
  projectid: number | null;
  taskid: number | null;
}

// FR-14 "Open Related Resource" needs a frontend tab to route to, but the schema has no
// LinkRoute column (deliberately not redesigning it) — so the route is derived once here from
// CategoryCode, the same way the frontend's board/approvals modules already derive behavior
// from a small lookup rather than storing UI routing in data.
const CATEGORY_LINK_ROUTES: Record<NotificationCategory, string> = {
  Task: 'tasks',
  Project: 'projects',
  Approval: 'approvals',
  System: 'settings',
  Attendance: 'attendance',
  Break: 'attendance',
  Report: 'reports',
  Chat: 'chat',
  AI: 'ai-assistant'
};

export const deriveLinkRoute = (categoryCode: string, typeCode: string): string => {
  // A handful of task-category types belong on the board rather than the task list.
  if (
    typeCode === 'task_status_changed' ||
    typeCode === 'task_review_requested' ||
    typeCode === 'task_review_approved' ||
    typeCode === 'task_review_rejected' ||
    typeCode === 'task_completed'
  ) {
    return 'kanban';
  }
  return CATEGORY_LINK_ROUTES[categoryCode as NotificationCategory] || 'notifications';
};

const DB_TO_API_PRIORITY: Record<DbPriority, ApiPriority> = {
  Critical: 'Critical',
  High: 'High',
  Normal: 'Medium',
  Low: 'Low'
};

export const API_TO_DB_PRIORITY: Record<ApiPriority, DbPriority> = {
  Critical: 'Critical',
  High: 'High',
  Medium: 'Normal',
  Low: 'Low'
};

const formatTimestamp = (date: Date): string =>
  date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export const rowToNotificationDTO = (row: NotificationRow): NotificationDTO => ({
  id: `notif-${row.notificationid}`,
  userId: fromUserPk(row.recipientuserid),
  actorId: row.actoruserid !== null ? fromUserPk(row.actoruserid) : undefined,
  actorName: row.actordisplayname || undefined,
  title: row.title,
  message: row.safepreviewtext || row.title,
  type: row.typecode as NotificationType,
  priority: DB_TO_API_PRIORITY[row.prioritycode],
  read: row.readatutc !== null,
  timestamp: formatTimestamp(row.createdatutc),
  createdAt: row.createdatutc.toISOString(),
  readAt: row.readatutc ? row.readatutc.toISOString() : undefined,
  linkRoute: deriveLinkRoute(row.categorycode, row.typecode),
  projectId: row.projectid !== null ? fromProjectPk(row.projectid) : undefined,
  taskId: row.taskid !== null ? fromTaskPk(row.taskid) : undefined
});
