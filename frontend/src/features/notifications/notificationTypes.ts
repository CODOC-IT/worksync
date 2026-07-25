import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  AtSign,
  Ban,
  CheckCircle2,
  CheckSquare,
  Database,
  FileWarning,
  FolderKanban,
  MessageSquare,
  Paperclip,
  RefreshCcw,
  Server,
  Shield,
  ShieldAlert,
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
  checklist_completed: { label: 'Checklist Completed', icon: CheckSquare, tone: 'success', priority: 'Low' },
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
  system: { label: 'System', icon: Server, tone: 'info', priority: 'Low' }
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
  'comment_added', 'attachment_uploaded', 'task'
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
