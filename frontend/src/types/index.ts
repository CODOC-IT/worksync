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

export type ProjectStatus = 'Active' | 'Archived' | 'Pending Approval' | 'Completed';

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
  progress: number; // 0-100
  milestones: Milestone[];
  files: ProjectFile[];
  pinnedMessagesCount?: number;
  tags: string[];
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
  type: 'Project_Creation' | 'Task_Creation' | 'Controlled_Edit';
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

export interface SavedPrompt {
  id: string;
  title: string;
  promptText: string;
  category: string;
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

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'approval' | 'task' | 'attendance' | 'mention' | 'system';
  read: boolean;
  timestamp: string;
  linkRoute: string;
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
