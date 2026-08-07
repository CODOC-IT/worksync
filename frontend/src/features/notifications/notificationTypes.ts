import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  AtSign,
  Ban,
  BarChart3,
  CalendarOff,
  CheckCircle2,
  CheckSquare,
  Clock,
  Coffee,
  Database,
  FilePen,
  FileWarning,
  FolderKanban,
  MessageSquare,
  Paperclip,
  RefreshCcw,
  Server,
  Shield,
  ShieldAlert,
  Sparkles,
  Trash2,
  UserCog,
  UserMinus,
  UserPlus,
  UserRoundPlus,
  Wrench,
  XCircle,
  type LucideIcon
} from 'lucide-react';
import { NotificationPriority, NotificationType, ToastTone, UserRole } from '../../types';

export interface NotificationTypeMeta {
  label: string;
  icon: LucideIcon;
  tone: ToastTone;
  priority: NotificationPriority;
}

// One row per NotificationType — the single place that defines how each event renders
// (icon/tone/default priority) across the bell dropdown, full Notification Center, and
// toasts, so a new event type only needs to be added here once.
export const NOTIFICATION_TYPE_META: Record<NotificationType, NotificationTypeMeta> = {
  task_assigned: { label: 'Task Assigned', icon: UserPlus, tone: 'info', priority: 'High' },
  task_reassigned: { label: 'Task Reassigned', icon: RefreshCcw, tone: 'info', priority: 'High' },
  task_updated: { label: 'Task Updated', icon: FolderKanban, tone: 'info', priority: 'Medium' },
  task_status_changed: { label: 'Task Status Changed', icon: RefreshCcw, tone: 'info', priority: 'Medium' },
  task_priority_changed: { label: 'Priority Changed', icon: AlertTriangle, tone: 'warning', priority: 'Medium' },
  task_due_date_changed: { label: 'Due Date Changed', icon: FileWarning, tone: 'warning', priority: 'Medium' },
  task_review_requested: { label: 'Review Requested', icon: CheckSquare, tone: 'info', priority: 'High' },
  task_review_approved: { label: 'Review Approved', icon: CheckCircle2, tone: 'success', priority: 'High' },
  task_review_rejected: { label: 'Review Rejected', icon: XCircle, tone: 'error', priority: 'High' },
  task_completed: { label: 'Task Completed', icon: CheckCircle2, tone: 'success', priority: 'Medium' },
  task_deleted: { label: 'Task Deleted', icon: Trash2, tone: 'warning', priority: 'Medium' },
  task_due_today: { label: 'Due Today', icon: FileWarning, tone: 'warning', priority: 'High' },
  task_due_tomorrow: { label: 'Due Tomorrow', icon: FileWarning, tone: 'info', priority: 'Medium' },
  task_overdue: { label: 'Overdue', icon: AlertTriangle, tone: 'error', priority: 'High' },
  checklist_completed: { label: 'All Subtasks Completed', icon: CheckSquare, tone: 'success', priority: 'Low' },
  subtask_assigned: { label: 'Subtask Assigned', icon: UserPlus, tone: 'info', priority: 'High' },
  subtask_completed: { label: 'Subtask Completed', icon: CheckCircle2, tone: 'success', priority: 'Medium' },
  subtask_reopened: { label: 'Subtask Reopened', icon: RefreshCcw, tone: 'warning', priority: 'Medium' },
  subtask_due_today: { label: 'Subtask Due Today', icon: FileWarning, tone: 'warning', priority: 'High' },
  subtask_overdue: { label: 'Subtask Overdue', icon: AlertTriangle, tone: 'error', priority: 'High' },
  task_reopened: { label: 'Task Reopened', icon: RefreshCcw, tone: 'warning', priority: 'High' },
  subtask_assignment_changed: { label: 'Subtask Assignment Changed', icon: UserCog, tone: 'info', priority: 'High' },
  task_edit_approval_requested: { label: 'Task Edit Request', icon: FilePen, tone: 'info', priority: 'High' },
  task_edit_approval_approved: { label: 'Task Edit Approved', icon: CheckCircle2, tone: 'success', priority: 'High' },
  task_edit_approval_rejected: { label: 'Task Edit Rejected', icon: XCircle, tone: 'error', priority: 'High' },
  leave_requested: { label: 'Leave Requested', icon: CalendarOff, tone: 'info', priority: 'Medium' },
  leave_approved: { label: 'Leave Approved', icon: CheckCircle2, tone: 'success', priority: 'Medium' },
  leave_rejected: { label: 'Leave Rejected', icon: XCircle, tone: 'error', priority: 'Medium' },
  comment_added: { label: 'New Comment', icon: MessageSquare, tone: 'info', priority: 'Medium' },
  mention: { label: 'Mentioned You', icon: AtSign, tone: 'info', priority: 'Medium' },
  attachment_uploaded: { label: 'File Attached', icon: Paperclip, tone: 'info', priority: 'Low' },
  project_created: { label: 'Project Created', icon: FolderKanban, tone: 'success', priority: 'Medium' },
  project_updated: { label: 'Project Updated', icon: FolderKanban, tone: 'info', priority: 'Low' },
  project_archived: { label: 'Project Archived', icon: Archive, tone: 'warning', priority: 'Medium' },
  project_restored: { label: 'Project Restored', icon: ArchiveRestore, tone: 'success', priority: 'Medium' },
  project_deleted: { label: 'Project Deleted', icon: Trash2, tone: 'error', priority: 'High' },
  project_member_added: { label: 'Added to Project', icon: UserPlus, tone: 'success', priority: 'Medium' },
  project_member_removed: { label: 'Removed from Project', icon: UserMinus, tone: 'warning', priority: 'Medium' },
  project_member_pending_removal: { label: 'Member Pending Removal', icon: AlertTriangle, tone: 'warning', priority: 'Medium' },
  project_member_auto_removed: { label: 'Member Removed', icon: UserMinus, tone: 'info', priority: 'Medium' },
  project_approval_rejected: { label: 'Project Approval Rejected', icon: XCircle, tone: 'error', priority: 'High' },
  approval: { label: 'Approval Requested', icon: CheckSquare, tone: 'info', priority: 'High' },
  user_registered: { label: 'New User Registered', icon: UserRoundPlus, tone: 'info', priority: 'Medium' },
  user_role_changed: { label: 'Role Changed', icon: UserCog, tone: 'warning', priority: 'High' },
  user_deactivated: { label: 'User Deactivated', icon: Ban, tone: 'warning', priority: 'High' },
  workspace_created: { label: 'Workspace Created', icon: FolderKanban, tone: 'success', priority: 'Medium' },
  workspace_deleted: { label: 'Workspace Deleted', icon: Trash2, tone: 'error', priority: 'High' },
  backup_completed: { label: 'Backup Completed', icon: Database, tone: 'success', priority: 'Low' },
  backup_failed: { label: 'Backup Failed', icon: Database, tone: 'error', priority: 'Critical' },
  security_alert: { label: 'Security Alert', icon: ShieldAlert, tone: 'error', priority: 'Critical' },
  audit_alert: { label: 'Audit Log Alert', icon: Shield, tone: 'warning', priority: 'High' },
  system_maintenance: { label: 'System Maintenance', icon: Wrench, tone: 'warning', priority: 'Medium' },
  attendance: { label: 'Attendance', icon: Server, tone: 'info', priority: 'Medium' },
  task: { label: 'Task', icon: FolderKanban, tone: 'info', priority: 'Medium' },
  system: { label: 'System', icon: Server, tone: 'info', priority: 'Low' },
  attendance_check_in: { label: 'Checked In', icon: Clock, tone: 'info', priority: 'Low' },
  attendance_check_out: { label: 'Checked Out', icon: Clock, tone: 'info', priority: 'Low' },
  attendance_late_check_in: { label: 'Late Check-In', icon: AlertTriangle, tone: 'warning', priority: 'Medium' },
  attendance_absent: { label: 'Marked Absent', icon: Ban, tone: 'error', priority: 'High' },
  attendance_correction_submitted: { label: 'Correction Requested', icon: FileWarning, tone: 'info', priority: 'Medium' },
  attendance_correction_approved: { label: 'Correction Approved', icon: CheckCircle2, tone: 'success', priority: 'Medium' },
  attendance_correction_rejected: { label: 'Correction Rejected', icon: XCircle, tone: 'error', priority: 'Medium' },
  break_started: { label: 'Break Started', icon: Coffee, tone: 'info', priority: 'Low' },
  break_ended: { label: 'Break Ended', icon: Coffee, tone: 'info', priority: 'Low' },
  break_exceeded: { label: 'Break Exceeded', icon: AlertTriangle, tone: 'warning', priority: 'High' },
  break_reminder: { label: 'Break Reminder', icon: Clock, tone: 'info', priority: 'Medium' },
  break_approved: { label: 'Break Request Approved', icon: CheckCircle2, tone: 'success', priority: 'Medium' },
  break_rejected: { label: 'Break Request Rejected', icon: XCircle, tone: 'error', priority: 'Medium' },
  report_weekly_generated: { label: 'Weekly Report Ready', icon: BarChart3, tone: 'info', priority: 'Medium' },
  report_monthly_generated: { label: 'Monthly Report Ready', icon: BarChart3, tone: 'info', priority: 'Medium' },
  report_sprint_ready: { label: 'Sprint Report Ready', icon: BarChart3, tone: 'info', priority: 'Medium' },
  report_productivity_ready: { label: 'Productivity Report Ready', icon: BarChart3, tone: 'info', priority: 'Medium' },
  report_project_completion: { label: 'Project Completion Report', icon: CheckCircle2, tone: 'success', priority: 'High' },
  chat_reply: { label: 'New Reply', icon: MessageSquare, tone: 'info', priority: 'Medium' },
  chat_new_message: { label: 'New Chat Message', icon: MessageSquare, tone: 'info', priority: 'Low' },
  chat_file_shared: { label: 'File Shared in Chat', icon: Paperclip, tone: 'info', priority: 'Medium' },
  chat_thread_reply: { label: 'Thread Reply', icon: MessageSquare, tone: 'info', priority: 'Medium' },
  chat_announcement: { label: 'Project Announcement', icon: AlertTriangle, tone: 'warning', priority: 'High' },
  ai_sprint_generated: { label: 'AI Sprint Generated', icon: Sparkles, tone: 'success', priority: 'Medium' },
  ai_tasks_generated: { label: 'AI Tasks Generated', icon: Sparkles, tone: 'success', priority: 'Medium' },
  ai_meeting_summarized: { label: 'Meeting Summarized', icon: Sparkles, tone: 'info', priority: 'Medium' },
  ai_deadline_suggested: { label: 'AI Deadline Suggestion', icon: Sparkles, tone: 'info', priority: 'Medium' },
  ai_overdue_detected: { label: 'AI Overdue Alert', icon: AlertTriangle, tone: 'warning', priority: 'High' },
  ai_recommendation_available: { label: 'AI Recommendation', icon: Sparkles, tone: 'info', priority: 'Low' }
};

export const getNotificationTypeMeta = (type: NotificationType): NotificationTypeMeta =>
  NOTIFICATION_TYPE_META[type] || NOTIFICATION_TYPE_META.system;

// Per-role deny-lists mirroring the PRD's "Notifications Not Received" sections (§6.2/§6.4).
// `mention` is intentionally never blocked — it is always targeted at one specific person by
// construction (see notificationService.resolveRecipients), so it stays personal regardless
// of role.
const ADMIN_BLOCKED_TYPES = new Set<NotificationType>([
  'task_assigned', 'task_reassigned', 'task_updated', 'task_status_changed',
  'task_priority_changed', 'task_due_date_changed', 'task_review_requested',
  'task_review_approved', 'task_review_rejected', 'task_completed', 'task_deleted',
  'task_due_today', 'task_due_tomorrow', 'task_overdue', 'checklist_completed',
  'comment_added', 'attachment_uploaded', 'task',
  // Subtask events are the most granular work chatter there is — an Admin only tracks
  // project-level outcomes, so none of these ever reach them (PRD: "Admin receives only
  // high-level project notifications"). 'task_reopened' is deliberately NOT blocked: reopening
  // a completed task reverses a recorded outcome and is an accountability event Admins keep.
  'subtask_assigned', 'subtask_completed', 'subtask_reopened',
  'subtask_due_today', 'subtask_overdue', 'subtask_assignment_changed',
  // A controlled task edit is a Team Lead <-> Team Member conversation about one task's fields.
  // Both ends are already targeted precisely (the request goes to that project's Lead, the
  // decision back to the requester), so an Admin is never a legitimate recipient — this entry is
  // the same defensive second layer every other routine task event gets.
  'task_edit_approval_requested', 'task_edit_approval_approved', 'task_edit_approval_rejected'
]);

const TEAM_LEAD_BLOCKED_TYPES = new Set<NotificationType>([
  'user_registered', 'workspace_created', 'workspace_deleted', 'backup_completed',
  'backup_failed', 'security_alert', 'audit_alert', 'system_maintenance'
]);

const TEAM_MEMBER_BLOCKED_TYPES = new Set<NotificationType>([
  'user_registered', 'workspace_created', 'workspace_deleted', 'backup_completed',
  'backup_failed', 'security_alert', 'audit_alert', 'system_maintenance',
  'project_deleted', 'approval'
]);

// Defensive, role-level second layer on top of recipient targeting (see
// notificationService.resolveRecipients, which is the primary RBAC enforcement point).
export const isNotificationVisibleForRole = (type: NotificationType, role: UserRole): boolean => {
  if (type === 'mention') return true;
  if (role === 'Admin') return !ADMIN_BLOCKED_TYPES.has(type);
  if (role === 'Team_Lead') return !TEAM_LEAD_BLOCKED_TYPES.has(type);
  if (role === 'Team_Member') return !TEAM_MEMBER_BLOCKED_TYPES.has(type);
  return true; // HR and any future role: no notification-module-specific restriction defined
};

// Label for the primary action button in a notification's expanded view. Keyed by `linkRoute`
// (derived server-side from the notification's category/type — see
// backend/src/notifications/notification.mapper.ts's deriveLinkRoute) so the button always names
// the tab the click actually lands on.
const ROUTE_ACTION_LABELS: Record<string, string> = {
  tasks: 'Open Task',
  kanban: 'Open Board',
  projects: 'Open Project',
  approvals: 'Open Approvals',
  attendance: 'Open Attendance',
  calendar: 'Open Calendar',
  reports: 'Open Reports',
  'project-chats': 'Open Project Chat',
  chat: 'Open Project Chat', // legacy route id, aliased in NotificationsView
  members: 'Open Members',
  activity: 'Open Activity Log',
  'ai-assistant': 'Open AI Assistant',
  profile: 'Open Profile',
  dashboard: 'Open Dashboard'
};

export const getNotificationActionLabel = (linkRoute: string): string =>
  ROUTE_ACTION_LABELS[linkRoute] || 'Open';

// camelCase metadata keys ("rejectionReason") render as readable labels ("Rejection reason").
// Metadata is written by the publishing module and rendered back verbatim, so this is the one
// place that has to turn a key into UI copy.
export const humanizeMetadataKey = (key: string): string => {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
};

export const PRIORITY_ORDER: Record<NotificationPriority, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3
};

export const PRIORITY_CLASSES: Record<NotificationPriority, string> = {
  Critical: 'border-rose-500/40 bg-rose-500/15 text-rose-300',
  High: 'border-amber-500/30 bg-amber-500/15 text-amber-300',
  Medium: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  Low: 'border-slate-500/30 bg-slate-500/10 text-slate-400'
};

export const NOTIFICATION_ICON_CLASSES: Record<ToastTone, string> = {
  success: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  info: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300',
  warning: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  error: 'border-rose-500/30 bg-rose-500/10 text-rose-300'
};

export const TOAST_TONE_CLASSES: Record<ToastTone, string> = {
  success: 'border-emerald-500/40 bg-emerald-950/90 text-emerald-200',
  info: 'border-cyan-500/40 bg-cyan-950/90 text-cyan-200',
  warning: 'border-amber-500/40 bg-amber-950/90 text-amber-200',
  error: 'border-rose-500/40 bg-rose-950/90 text-rose-200'
};
