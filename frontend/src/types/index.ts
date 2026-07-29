export type UserRole = 'Admin' | 'Team_Lead' | 'HR' | 'Team_Member';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  department: string;
  avatar: string;
  title: string;
  status: 'active' | 'inactive' | 'away';
  lastActive?: string;
  githubUsername?: string;
}

// 'Draft' and 'On Hold' mirror work.ProjectStatuses.StatusCode values ('Draft'/'OnHold') that
// have no prior frontend representation — added so the backend project API (see
// backend/src/projects/) never has to lose information mapping a real DB status to the UI.
export type ProjectStatus = 'Draft' | 'Active' | 'On Hold' | 'Archived' | 'Pending Approval' | 'Completed';

export interface Milestone {
  id: string;
  title: string;
  dueDate: string;
  completed: boolean;
}

export interface ProjectFile {
  id: string;
  name: string;
  size: string;
  type: string;
  uploadedBy: string;
  uploadedAt: string;
  url: string;
}

export interface Project {
  id: string;
  code: string;
  title: string;
  description: string;
  status: ProjectStatus;
  approvalStatus: 'Approved' | 'Pending Approval' | 'Rejected';
  createdBy: string; // User ID
  teamLeadId: string;
  memberIds: string[];
  startDate: string;
  targetDate: string;
  priority?: TaskPriority;
  progress: number; // 0-100
  milestones: Milestone[];
  files: ProjectFile[];
  pinnedMessagesCount?: number;
  tags: string[];
  creationReason?: string;
}

export type TaskStatus = 'Todo' | 'In Progress' | 'Review' | 'Done' | 'Blocked';
export type TaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

export interface TaskAttachment {
  id: string;
  name: string;
  size: string;
  type: string;
  uploadedBy: string;
  uploadedAt: string;
}

export interface TaskComment {
  id: string;
  taskId: string;
  authorId: string;
  content: string;
  createdAt: string;
  reactions: { [emoji: string]: string[] }; // emoji -> array of userId
}

export interface Subtask {
  id: string;
  title: string;
  completed: boolean;
}

export interface ControlledEditRequest {
  id: string;
  taskId: string;
  requestedBy: string;
  field: 'dueDate' | 'priority' | 'description' | 'assignee' | 'status' | 'reopen';
  oldValue: string;
  newValue: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  createdAt: string;
}

// Project Board (Kanban) status-change audit trail. Mirrors work.TaskStatusHistory
// in the PostgreSQL schema (see database/04_work_tables.sql) so a future write-path
// can persist these entries without reshaping them.
export interface TaskStatusHistoryEntry {
  id: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  note: string;
  changedBy: string; // User ID
  changedByName: string;
  timestamp: string;
}

export type ReviewApprovalStatus = 'Pending' | 'Approved' | 'Rejected';

export interface Task {
  id: string;
  taskNumber: string;
  projectId: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  creatorId: string;
  dueDate: string;
  estimatedHours: number;
  subtasks: Subtask[];
  dependencies: string[]; // array of Task IDs
  tags: string[];
  attachments: TaskAttachment[];
  approvalStatus: 'Approved' | 'Pending Approval' | 'Rejected';
  pendingEdit?: ControlledEditRequest;
  blockerReason?: string;
  workSummary?: string;
  completionSummary?: string;
  reopenReason?: string;
  createdAt: string;
  // Project Board fields — populated by AppContext.updateTaskStatus (Kanban & task details).
  statusHistory?: TaskStatusHistoryEntry[];
  reviewApproval?: ReviewApprovalStatus;
}

export type BreakType = 'Lunch' | 'Short Break' | 'Other';

export interface WorkBreak {
  id: string;
  type: BreakType;
  startTime: string;
  endTime?: string;
  durationMinutes: number;
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  checkIn: string; // HH:mm
  checkOut?: string; // HH:mm
  totalHours: number;
  status: 'Present' | 'Late' | 'Half Day' | 'Absent' | 'On Leave';
  breaks: WorkBreak[];
}

export type HRRequestType = 'Correction' | 'Leave' | 'Break_Exception';

export interface HRRequest {
  id: string;
  userId: string;
  type: HRRequestType;
  date: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  details: {
    requestedCheckIn?: string;
    requestedCheckOut?: string;
    leaveType?: 'Casual' | 'Sick' | 'Annual' | 'Unpaid';
    leaveDays?: number;
    extraBreakMinutes?: number;
  };
  submittedAt: string;
  decidedBy?: string;
  decisionReason?: string;
}

export interface SystemApproval {
  id: string;
  type: 'Project_Creation' | 'Project_Deletion' | 'Task_Creation' | 'Controlled_Edit';
  targetId: string;
  targetTitle: string;
  requestedBy: string;
  requestedRole: UserRole;
  createdAt: string;
  details: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Clarification_Requested';
  proposedDiff?: {
    field: string;
    oldValue: string;
    newValue: string;
  };
}

export interface ChatMessage {
  id: string;
  projectId: string;
  senderId: string;
  message: string;
  timestamp: string;
  isPinned: boolean;
  attachments?: string[];
  mentions?: string[];
}

export interface PromptVersion {
  versionId: string;
  versionNumber: number;
  content: string;
  isAiGenerated: boolean;
  createdByUserId: string;
  createdByName: string;
  createdAtUtc: string;
}

export interface SavedPrompt {
  id: string;
  title: string;
  promptText: string;
  category: string;
}

export interface SavedPromptDetail {
  id: string;
  userId: string;
  projectId: string | null;
  taskId: string | null;
  category: string;
  title: string;
  style: string;
  additionalInstructions: string | null;
  isArchived: boolean;
  createdAtUtc: string;
  updatedAtUtc: string;
  versions: PromptVersion[];
}

export interface PromptSummary {
  id: string;
  title: string;
  category: string;
  style: string;
  isArchived: boolean;
  versionCount: number;
  latestContent: string;
  createdAtUtc: string;
  updatedAtUtc: string;
}

export interface PromptCategory {
  code: string;
  name: string;
  requiresProject: boolean;
  requiresTask: boolean;
}

export interface ProjectSummary {
  id: string;
  code: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  startDate: string;
  endDate: string;
  milestoneCount: number;
}

export interface TaskSummary {
  id: string;
  taskNumber: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  assigneeId: string;
  dueDate: string;
  dependencies: string[];
}

export interface AIQueryLog {
  id: string;
  userId: string;
  userName: string;
  userRole: UserRole;
  queryText: string;
  scopeTouched: string;
  timestamp: string;
  responseSummary: string;
}

export interface AIUsageAudit {
  id: string;
  userId: string;
  userName: string;
  projectTitle: string;
  prCount: number;
  issuesCount: number;
  tokensUsed: number;
  toolUsed: string;
  lastUsed: string;
}

// Notification taxonomy. Legacy values ('approval' | 'task' | 'attendance' | 'mention' |
// 'system') are kept so notifications created before this module (e.g. HR requests, the
// original Project Approval Requested notice) remain valid without reshaping. New events
// use the more specific PRD taxonomy so the Notification Center can render distinct
// icons/copy and NotificationService can apply per-type RBAC recipient rules.
export type NotificationType =
  | 'task_assigned'
  | 'task_reassigned'
  | 'task_updated'
  | 'task_status_changed'
  | 'task_priority_changed'
  | 'task_due_date_changed'
  | 'task_review_requested'
  | 'task_review_approved'
  | 'task_review_rejected'
  | 'task_completed'
  | 'task_deleted'
  | 'task_due_today'
  | 'task_due_tomorrow'
  | 'task_overdue'
  | 'checklist_completed'
  | 'comment_added'
  | 'mention'
  | 'attachment_uploaded'
  | 'project_created'
  | 'project_updated'
  | 'project_archived'
  | 'project_restored'
  | 'project_deleted'
  | 'project_member_added'
  | 'project_member_removed'
  | 'approval'
  | 'user_registered'
  | 'user_role_changed'
  | 'user_deactivated'
  | 'workspace_created'
  | 'workspace_deleted'
  | 'backup_completed'
  | 'backup_failed'
  | 'security_alert'
  | 'audit_alert'
  | 'system_maintenance'
  | 'attendance'
  | 'task'
  | 'system'
  | 'attendance_check_in'
  | 'attendance_check_out'
  | 'attendance_late_check_in'
  | 'attendance_absent'
  | 'attendance_correction_submitted'
  | 'attendance_correction_approved'
  | 'attendance_correction_rejected'
  | 'break_started'
  | 'break_ended'
  | 'break_exceeded'
  | 'break_reminder'
  | 'break_approved'
  | 'break_rejected'
  | 'report_weekly_generated'
  | 'report_monthly_generated'
  | 'report_sprint_ready'
  | 'report_productivity_ready'
  | 'report_project_completion'
  | 'chat_reply'
  | 'chat_new_message'
  | 'chat_file_shared'
  | 'chat_thread_reply'
  | 'chat_announcement'
  | 'ai_sprint_generated'
  | 'ai_tasks_generated'
  | 'ai_meeting_summarized'
  | 'ai_deadline_suggested'
  | 'ai_overdue_detected'
  | 'ai_recommendation_available';

export type NotificationPriority = 'Critical' | 'High' | 'Medium' | 'Low';

export interface NotificationItem {
  id: string;
  userId: string; // recipient
  actorId?: string; // who triggered the event (absent for system-generated notifications)
  actorName?: string;
  title: string;
  message: string; // preview / body text
  type: NotificationType;
  priority?: NotificationPriority;
  read: boolean;
  timestamp: string; // legacy display string (kept for backward compatibility)
  createdAt?: string; // ISO-ish sortable timestamp ("YYYY-MM-DD HH:mm"); new notifications always set this
  readAt?: string;
  linkRoute: string;
  projectId?: string;
  taskId?: string;
  metadata?: Record<string, string | number | boolean | undefined>;
}

export interface NotificationPreferences {
  toast: boolean;
  inApp: boolean;
  dueReminders: boolean;
  mentions: boolean;
  comments: boolean;
  assignments: boolean;
  email: boolean;
}

// One row per NotificationType — delivery/read/suppression counts for the Admin-only analytics
// panel (backend/src/notifications/notification.repository.ts's getDeliveryAnalytics).
export interface NotificationAnalyticsRow {
  type: NotificationType;
  category: string;
  total: number;
  delivered: number;
  suppressed: number;
  read: number;
  readRate: number; // percentage, 0-100
}

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  title: string;
  message: string;
}

export interface ActivityLogItem {
  id: string;
  userId: string;
  userName: string;
  userAvatar: string;
  action: string;
  targetType: 'Project' | 'Task' | 'Attendance' | 'Approval' | 'Settings';
  targetId: string;
  targetTitle: string;
  timestamp: string;
  diff?: {
    field: string;
    oldVal: string;
    newVal: string;
  };
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time?: string;
  type: 'Deadline' | 'Milestone' | 'Leave' | 'Meeting' | 'Review';
  projectId?: string;
  taskId?: string;
}

export interface WeeklySummaryDraft {
  id: string;
  projectId: string;
  weekEnding: string;
  progressSummary: string;
  blockersText: string;
  overdueTasksCount: number;
  completedTasksCount: number;
  keyHighlights: string[];
  recipientChannel: 'Project Chat' | 'Email Digest' | 'Executive Report';
  generatedAt: string;
}
