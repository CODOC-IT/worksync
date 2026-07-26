// Domain types + DTOs for the Notification Module backend. Deliberately duplicated rather than
// imported from the frontend (backend and frontend are separate TypeScript projects with no
// shared package — same convention already used by backend/src/types.ts's UserRole, which
// duplicates frontend/src/types/index.ts's UserRole rather than importing it).

export type NotificationCategory =
  | 'Task' | 'Project' | 'Approval' | 'System' | 'Attendance' | 'Break' | 'Report' | 'Chat' | 'AI';

// Matches notify.NotificationTypes.TypeCode rows seeded in database/18_notify_seed.sql, which
// in turn mirrors frontend/src/types/index.ts's NotificationType 1:1 for the modules already
// implemented (Project/Task/Board), plus the new codes this branch adds for
// Attendance/Break/Reports/Chat/AI Assistant.
export type NotificationType =
  | 'task_assigned' | 'task_reassigned' | 'task_updated' | 'task_status_changed'
  | 'task_priority_changed' | 'task_due_date_changed' | 'task_review_requested'
  | 'task_review_approved' | 'task_review_rejected' | 'task_completed' | 'task_deleted'
  | 'task_due_today' | 'task_due_tomorrow' | 'task_overdue' | 'checklist_completed'
  | 'comment_added' | 'mention' | 'attachment_uploaded'
  | 'project_created' | 'project_updated' | 'project_archived' | 'project_restored'
  | 'project_deleted' | 'project_member_added' | 'project_member_removed'
  | 'approval' | 'user_registered' | 'user_role_changed' | 'user_deactivated'
  | 'workspace_created' | 'workspace_deleted' | 'backup_completed' | 'backup_failed'
  | 'security_alert' | 'audit_alert' | 'system_maintenance' | 'attendance' | 'task' | 'system'
  | 'attendance_check_in' | 'attendance_check_out' | 'attendance_late_check_in'
  | 'attendance_absent' | 'attendance_correction_submitted' | 'attendance_correction_approved'
  | 'attendance_correction_rejected'
  | 'break_started' | 'break_ended' | 'break_exceeded' | 'break_reminder'
  | 'break_approved' | 'break_rejected'
  | 'report_weekly_generated' | 'report_monthly_generated' | 'report_sprint_ready'
  | 'report_productivity_ready' | 'report_project_completion'
  | 'chat_reply' | 'chat_new_message' | 'chat_file_shared' | 'chat_thread_reply'
  | 'chat_announcement'
  | 'ai_sprint_generated' | 'ai_tasks_generated' | 'ai_meeting_summarized'
  | 'ai_deadline_suggested' | 'ai_overdue_detected' | 'ai_recommendation_available';

// notify.NotificationTypes.DefaultPriority / notify.Notifications.PriorityCode vocabulary
// (database/10_notify_tables.sql CK_Notifications_Priority / CK_NotificationTypes constraints).
export type DbPriority = 'Critical' | 'High' | 'Normal' | 'Low';

// Frontend-facing vocabulary (frontend/src/types/index.ts NotificationPriority) — differs only
// in 'Normal' vs 'Medium'. Converted in notification.mapper.ts so the frontend never has to
// know the DB uses different wording.
export type ApiPriority = 'Critical' | 'High' | 'Medium' | 'Low';

// The "event" every module publishes to the Notification Service. Every recipient/actor/
// project/task id here is a frontend-style prefixed string (`usr-4`) — the repository layer is
// the only place that converts to integer primary keys (idMapping.ts).
export interface NotificationEvent {
  type: NotificationType;
  title: string;
  message: string;
  /** Per-recipient message override — see frontend notificationService.ts's identical field
   *  for why (the same event reads differently depending on who's reading it). */
  recipientMessages?: Record<string, string>;
  recipientIds: string[];
  actorId?: string;
  projectId?: string;
  taskId?: string;
  changeRequestId?: string;
  attendanceCorrectionId?: string;
  leaveRequestId?: string;
  priority?: DbPriority;
}

// Shape returned to the frontend — matches frontend/src/types/index.ts's NotificationItem so
// the API client barely has to transform anything and the existing Notification Center UI
// (NotificationBell/NotificationsView/NotificationListItem/ToastContainer) keeps working
// unmodified.
export interface NotificationDTO {
  id: string;
  userId: string;
  actorId?: string;
  actorName?: string;
  title: string;
  message: string;
  type: NotificationType;
  priority: ApiPriority;
  read: boolean;
  timestamp: string;
  createdAt: string;
  readAt?: string;
  linkRoute: string;
  projectId?: string;
  taskId?: string;
}

export interface NotificationPreferencesDTO {
  toast: boolean;
  inApp: boolean;
  dueReminders: boolean;
  mentions: boolean;
  comments: boolean;
  assignments: boolean;
  email: boolean;
}

export interface NotificationListQuery {
  unreadOnly?: boolean;
  type?: NotificationType;
  priority?: ApiPriority;
  search?: string;
  page?: number;
  pageSize?: number;
}
