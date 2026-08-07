import { fromProjectPk, fromTaskPk, fromUserPk } from '../utils/idMapping.js';
import { normalizeActorMessage } from '../utils/actorDisplay.js';
import {
  ApiPriority,
  DbPriority,
  NotificationCategory,
  NotificationDTO,
  NotificationMetadata,
  NotificationType
} from './notification.types.js';

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
  detailtext: string | null;
  // jsonb comes back from node-postgres already parsed; typed loosely because the shape is
  // per-notification-type by design (see NotificationEvent.metadata).
  metadatajson: NotificationMetadata | null;
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
  // No 'settings' tab exists in frontend/App.tsx's router, so a generic System event has nowhere
  // more specific to go than the Notification Center itself. The System types that DO have a
  // natural home are routed by TYPE_LINK_ROUTES below.
  System: 'notifications',
  Attendance: 'attendance',
  Break: 'attendance',
  Report: 'reports',
  // The Project Chat tab's id is 'project-chats'; 'chat' was its id historically and is still
  // aliased on the frontend for notifications published before the rename.
  Chat: 'project-chats',
  AI: 'ai-assistant'
};

// Per-type overrides for events whose category alone points at the wrong tab. Clicking a
// notification must land on the surface that actually shows it — a review decision belongs on the
// board, a task-edit request belongs in the Approvals inbox, a holiday belongs on the calendar.
const TYPE_LINK_ROUTES: Record<string, string> = {
  // Board (Kanban) — status movement and the Review -> Done gate.
  task_status_changed: 'kanban',
  task_review_requested: 'kanban',
  task_review_approved: 'kanban',
  task_review_rejected: 'kanban',
  task_completed: 'kanban',
  task_reopened: 'kanban',
  subtask_completed: 'kanban',
  subtask_reopened: 'kanban',
  checklist_completed: 'kanban',
  // Controlled task edits: the request is a pending decision (Approvals inbox); its outcome is
  // about the task itself (Tasks).
  task_edit_approval_requested: 'approvals',
  task_edit_approval_approved: 'tasks',
  task_edit_approval_rejected: 'tasks',
  // Assignment changes are read on the task list, where the assignee sees their own work.
  task_assigned: 'tasks',
  task_reassigned: 'tasks',
  subtask_assigned: 'tasks',
  subtask_assignment_changed: 'tasks',
  // Leave: the requester tracks their own leave in Attendance; reviewers act on it in Approvals.
  leave_requested: 'approvals',
  leave_approved: 'attendance',
  leave_rejected: 'attendance',
  // System events with a real owning screen.
  holiday_created: 'calendar',
  user_registered: 'members',
  user_role_changed: 'members',
  user_deactivated: 'members',
  // Profile: the decision on the requester's own account change request, and an Admin's direct
  // self-edit -- both are about the viewer's own account, so both land on their Profile screen
  // rather than the generic System->'notifications' fallback or the reviewer-facing Approvals
  // inbox (which the requester, as a non-reviewer, has no standing to act in).
  account_change_request_approved: 'profile',
  account_change_request_rejected: 'profile',
  account_profile_updated: 'profile',
  // security_alert has no single owning screen in general (a future non-Profile trigger might
  // want somewhere else), but Profile is the only trigger that exists today and is where the
  // recipient would go to review/re-secure their account.
  security_alert: 'profile'
};

export const deriveLinkRoute = (categoryCode: string, typeCode: string): string =>
  TYPE_LINK_ROUTES[typeCode] || CATEGORY_LINK_ROUTES[categoryCode as NotificationCategory] || 'notifications';

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
  message: normalizeActorMessage(row.safepreviewtext || row.title, row.actordisplayname),
  detail: row.detailtext ? normalizeActorMessage(row.detailtext, row.actordisplayname) : undefined,
  metadata: row.metadatajson || undefined,
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
