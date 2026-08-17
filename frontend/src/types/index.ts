export type UserRole = 'Admin' | 'Team_Lead' | 'HR' | 'Team_Member';

export interface User {
  id: string;
  name: string;
  email: string;
  username?: string;
  role: UserRole;
  department: string;
  title: string;
  status: 'active' | 'inactive' | 'away';
  accountStatus?: 'Pending' | 'Active' | 'Locked' | 'Deactivated';
  invitationSentAtUtc?: string | null;
  lastActive?: string;
  githubUsername?: string;
  passwordHash?: string;
  createdAt?: string;
  activePermissions?: {
    teamLead: boolean;
    hr: boolean;
  };
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
  size: number;
  mimeType: string;
  uploadedBy: string;
  uploadedAt: string;
  // Only ever set locally, for a file just selected in the create/edit form and not yet uploaded
  // -- the base64 data URL read via FileReader (see ProjectsView.tsx's handleFileSelect). A file
  // already persisted (returned from the backend) never has this.
  dataUrl?: string;
}

// A team within a project (multi-team architecture). Exactly one member (leadId) leads the team;
// every project member belongs to exactly one team. See backend/src/projects/project.types.ts.
export interface Team {
  id: string;
  projectId: string;
  name: string;
  description: string;
  leadId: string;
  memberIds: string[];
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
  // Members kept in the project (still in memberIds) because they had active task/subtask
  // assignments when an Admin tried to remove them -- see ProjectsView.tsx's pending-removal
  // confirmation dialog and backend/src/projects/project.service.ts's removeMember.
  pendingRemovalMemberIds?: string[];
  // The project's team breakdown (multi-team architecture). Every project member belongs to
  // exactly one team; team leads are also team members. Empty for projects created before this
  // feature -- those keep working through the single project-lead model.
  teams: Team[];
  startDate: string;
  targetDate: string;
  priority?: TaskPriority;
  progress: number; // 0-100
  milestones: Milestone[];
  files: ProjectFile[];
  pinnedMessagesCount?: number;
  tags: string[];
  creationReason?: string;
  createdAt?: string;
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
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  startDate?: string;
  dueDate?: string;
  assigneeIds?: string[];
  completed: boolean;
}

// A Project Lead's per-subtask verdict when rejecting a parent task's review — see
// backend/src/tasks/task.service.ts's decideReview. Only completed subtasks need one.
export interface SubtaskReviewDecision {
  subtaskId: string;
  decision: 'Accept' | 'Reject';
  comment?: string;
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

export interface ProposedTaskUpdate {
  title: string;
  description: string;
  priority: TaskPriority;
  startDate: string;
  dueDate: string;
}

// Project Board (Kanban) status-change audit trail. Mirrors work.TaskStatusHistory
// in the PostgreSQL schema (see database/04_work_tables.sql) so a future write-path
// can persist these entries without reshaping them.
export interface TaskStatusHistoryEntry {
  id: string;
  /** The task this entry belongs to. A parent task's history also includes its subtasks'
   *  entries, so the board's task detail can attribute "completed by / at" per subtask. */
  taskId?: string;
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
  /** Owning project team. Undefined only for tasks created before project teams existed. */
  teamId?: string;
  /** Admin-created team handoffs remain unassigned until that team's lead distributes work. */
  assignmentStatus?: 'NeedsTeamAssignment' | 'Assigned';
  parentTaskId?: string;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: string;
  assigneeIds?: string[];
  creatorId: string;
  dueDate: string;
  estimatedHours: number;
  subtaskCount?: number;
  /** Subtask progress, all server-computed (see backend/src/tasks/task.repository.ts) — the
   *  board renders these directly and never recounts from local state, so a card's progress is
   *  always what the database says it is. */
  completedSubtaskCount?: number;
  subtaskProgress?: number; // 0-100 whole-number percentage
  /** When this task itself entered a completed state (ISO). */
  completedAt?: string;
  subtasks: Subtask[];
  dependencies: string[]; // array of Task IDs
  tags: string[];
  attachments: TaskAttachment[];
  approvalStatus: 'Approved' | 'Pending Approval' | 'Rejected';
  /** Server-derived unresolved task-edit approval state. */
  hasPendingApproval?: boolean;
  pendingEdit?: ControlledEditRequest;
  blockerReason?: string;
  workSummary?: string;
  completionSummary?: string;
  reopenReason?: string;
  createdAt: string;
  // Project Board fields — populated by AppContext.updateTaskStatus (Kanban & task details).
  statusHistory?: TaskStatusHistoryEntry[];
  reviewApproval?: ReviewApprovalStatus;
  /** True when this task is read-only because its parent project is archived. */
  isArchived?: boolean;
  /** Project-driven archive time supplied by the Task API. */
  archivedAt?: string;
}

export type BreakType = 'Lunch' | 'Short Break' | 'Other';

export interface WorkBreak {
  id: string;
  type: BreakType;
  startTime: string;
  endTime?: string;
  durationMinutes: number;
  durationSeconds?: number;
  startedAtUtc?: string;
  endedAtUtc?: string;
}

export interface AttendanceRecord {
  id: string;
  userId: string;
  date: string; // YYYY-MM-DD
  checkIn: string; // HH:mm
  checkOut?: string; // HH:mm
  totalHours: number;
  status: 'In Session' | 'Present' | 'Late' | 'Short Hours' | 'Half Day' | 'Absent' | 'On Leave';
  breaks: WorkBreak[];
}

export type HRRequestType = 'Correction' | 'Leave';

export interface WorkingScheduleDay {
  isoWeekday: number;
  isWorkingDay: boolean;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
}

export interface WorkingSchedule {
  workScheduleId: number;
  scheduleName: string;
  graceMinutes: number;
  timeZone: string;
  startTime: string | null;
  endTime: string | null;
  breakMinutes: number;
  windowMinutes: number;
  netMinutes: number;
  days: WorkingScheduleDay[];
}

export interface HRRequest {
  id: string;
  userId: string;
  userName?: string;
  type: HRRequestType;
  date: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  approvalStage?: 'HR' | 'Admin';
  requesterRole?: UserRole;
  details: {
    currentCheckIn?: string;
    currentCheckOut?: string;
    requestedCheckIn?: string;
    requestedCheckOut?: string;
    currentBreaks?: WorkBreak[];
    requestedBreaks?: WorkBreak[];
    attendanceChangeReason?: string;
    leaveType?: 'Full Day Leave' | 'Half Day Leave';
    leavePeriod?: 'First Half' | 'Second Half';
    leaveDays?: number;
  };
  submittedAt: string;
  decidedBy?: string;
  decisionReason?: string;
}

// Account Change Request — submitted from My Profile when HR/Lead/Member need to modify
// their own account information (name, username, email, password). Exactly one field is
// requested per request. Routed to the appropriate approver based on the requester's role
// and displayed in the existing Approval Inbox.
export interface AccountChangeRequest {
  id: string;
  userId: string;
  userName?: string;
  requesterRole?: UserRole;
  requestType: 'Account_Change';
  requestedField?: 'name' | 'email' | 'username' | 'password';
  requestedChanges: Record<string, string>;
  passwordChangeRequested?: boolean;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  assignedApproverRole: 'Admin' | 'HR';
  submittedAt: string;
  decidedBy?: string;
  decisionReason?: string;
  decidedAt?: string;
}

// Persisted Project Management Approval Workflow (Team Lead -> Admin). SystemApproval below
// remains the legacy UI shape; these six discriminators are the authoritative API/database
// request types backed by work.ProjectApprovalRequests.
export type ProjectApprovalRequestType =
  | 'PROJECT_CREATE'
  | 'TASK_CREATE'
  | 'PROJECT_EDIT'
  | 'PROJECT_ARCHIVE'
  | 'PROJECT_RESTORE'
  | 'PROJECT_DELETE'
  | 'PROJECT_PERMANENT_DELETE';

export interface ProjectApprovalRequest {
  id: string;
  projectId: string;
  projectTitle: string;
  requestType: ProjectApprovalRequestType;
  requestedByUserId: string;
  requestedByName: string;
  requestedByRole?: UserRole;
  requestedByEmail?: string;
  requestedChanges: Record<string, unknown> | null;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  reviewedByUserId?: string;
  reviewedByName?: string;
  decisionReason?: string;
  createdAt: string;
  decidedAt?: string;
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
  projectId?: string;
  proposedTask?: {
    projectId: string;
    title: string;
    description: string;
    priority: TaskPriority;
    startDate?: string;
    dueDate: string;
    assigneeIds: string[];
    status: TaskStatus;
    parentTaskId?: string;
  };
  proposedDiff?: {
    field: string;
    oldValue: string;
    newValue: string;
  };
  proposedTaskUpdate?: ProposedTaskUpdate;
  previousTaskSnapshot?: ProposedTaskUpdate;
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
  | 'subtask_assigned'
  | 'subtask_completed'
  | 'subtask_reopened'
  | 'subtask_due_today'
  | 'subtask_overdue'
  | 'task_reopened'
  | 'subtask_assignment_changed'
  | 'task_edit_approval_requested'
  | 'task_edit_approval_approved'
  | 'task_edit_approval_rejected'
  | 'leave_requested'
  | 'leave_approved'
  | 'leave_rejected'
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
  | 'project_member_pending_removal'
  | 'project_member_auto_removed'
  | 'project_approval_rejected'
  // Multi-team project architecture. A "Team Lead" in any of these is a per-project, per-team
  // designation (work.TeamMembers.IsLead), never the reader's account role — the same person can
  // lead one project's team and be a plain member of another's.
  | 'team_member_removed_needs_reassignment'
  | 'team_member_moved'
  | 'team_lead_changed'
  | 'admin_task_needs_team_assignment'
  | 'subtask_transfer_requested'
  | 'subtask_transfer_approved'
  | 'subtask_transfer_rejected'
  | 'holiday_created'
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
  /** Compact preview line (1–2 lines) shown in the notification list by default. */
  message: string;
  /**
   * Full body, rendered only when the recipient expands the notification in the Notification
   * Center — rejection reasons, review comments, the exact fields an edit changed. Persisted to
   * notify.Notifications.DetailText; absent on notifications that have nothing to add beyond
   * their preview (and on every notification created before this column existed).
   */
  detail?: string;
  type: NotificationType;
  priority?: NotificationPriority;
  read: boolean;
  timestamp: string; // legacy display string (kept for backward compatibility)
  createdAt?: string; // ISO-ish sortable timestamp ("YYYY-MM-DD HH:mm"); new notifications always set this
  readAt?: string;
  linkRoute: string;
  projectId?: string;
  taskId?: string;
  /**
   * Structured label/value context for the expanded view (project name, task/subtask title,
   * approver, changed fields, leave type/period, ...). Persisted to
   * notify.Notifications.MetadataJson and rendered back verbatim as rows.
   */
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

// One row per user — who received/read what, and their "interest" (the category they read the
// most of), for the Admin-only per-user analytics drill-down (backend's getUserAnalytics).
export interface UserNotificationAnalyticsRow {
  userId: string;
  name: string;
  email: string;
  totalReceived: number;
  totalDelivered: number;
  totalRead: number;
  readRate: number; // percentage, 0-100
  topInterest: string | null;
  lastNotifiedAt: string | null;
  lastReadAt: string | null;
}

// One row per notification type, for a single user — backs the analytics drawer's interest
// breakdown chart.
export interface UserNotificationCategoryBreakdown {
  category: string;
  type: NotificationType;
  total: number;
  read: number;
  readRate: number;
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
  type: 'Deadline' | 'Milestone' | 'Leave';
  projectId?: string;
  taskId?: string;
}

// An approved HR leave request, read-only on the Calendar. Backed by
// GET /api/calendar/approved-leave (backend/src/calendar/), which reads the same
// public.worksync_hr_requests rows the HR approval flow already writes -- this is a display-only
// projection, not a duplicate leave record.
export interface ApprovedLeaveEntry {
  id: string;
  userId: string;
  userName: string;
  date: string; // YYYY-MM-DD
  leaveType: 'Full Day Leave' | 'Half Day Leave';
}

// A Calendar-displayed holiday. hr.Holidays (database/06_hr_tables.sql) is the single source of
// truth via GET/POST/PUT/DELETE /api/calendar/holidays (backend/src/calendar/) -- HR-only for
// create/update/delete (enforced server-side via effectiveRoles.ts). Visibility is audience-scoped
// (see backend/src/calendar/calendar.service.ts's listHolidays) -- Admin/HR always get every
// holiday; everyone else only gets holidays whose audience includes them, so `holidays` already
// arrives pre-filtered and the frontend never needs to re-derive visibility itself.
// `date` for a recurring holiday is one representative occurrence; the Calendar re-derives
// month/day from it and repeats across every displayed year (see calendarRules.ts's
// buildHolidayEntries).
export type HolidayAudienceType = 'Everyone' | 'Department' | 'Users';

export interface Holiday {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD
  isRecurringAnnual: boolean;
  audienceType: HolidayAudienceType;
  departmentIds: number[];
  userIds: string[];
  createdByUserId: string;
  createdAt: string;
}

// Shared shape for org.Departments rows returned by GET /api/accounts/departments (see
// backend/src/accounts/accounts.service.ts's listPermittedDepartments). Not reused from
// TeamMembersView.tsx's own local, unexported `DepartmentOption` -- that file is unrelated to this
// feature and stays untouched; this is the shared type new department-aware features (e.g. holiday
// audience targeting) should import instead of redeclaring it again.
export interface DepartmentOption {
  id: number;
  name: string;
}
