// Domain types + DTOs for the Task Module backend (Project Board / Kanban integration).
// Duplicated from the frontend on purpose — same convention as every other backend module here.

export type TaskStatusCode = 'Todo' | 'InProgress' | 'Review' | 'Blocked' | 'Done';
export type TaskPriorityCode = 'Low' | 'Medium' | 'High' | 'Critical';

// Frontend vocabulary differs only in status spacing ('In Progress' not 'InProgress') and
// priority's top tier ('Urgent' not 'Critical') — same two conversions the Project Module and
// database/18_notify_seed.sql already establish elsewhere in this app.
export type ApiTaskStatus = 'Todo' | 'In Progress' | 'Review' | 'Blocked' | 'Done';
export type ApiTaskPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

export const DB_TO_API_TASK_STATUS: Record<TaskStatusCode, ApiTaskStatus> = {
  Todo: 'Todo',
  InProgress: 'In Progress',
  Review: 'Review',
  Blocked: 'Blocked',
  Done: 'Done'
};

export const API_TO_DB_TASK_STATUS: Record<ApiTaskStatus, TaskStatusCode> = {
  Todo: 'Todo',
  'In Progress': 'InProgress',
  Review: 'Review',
  Blocked: 'Blocked',
  Done: 'Done'
};

export interface TaskRow {
  // CAUTION: `taskid`/`parenttaskid` map to Postgres `bigint` columns, and node-postgres returns
  // bigint as a JavaScript *string* ('49'), not a number — these annotations describe intent, not
  // the runtime type. Interpolation (`fromTaskPk`), SQL parameters, and row-to-row comparisons all
  // work regardless, but never compare one of these against a `toTaskPk()` result directly
  // (`row.taskid === toTaskPk(id)` is always false) or use one as a Map key opposite a numeric
  // one — normalize both sides first (see task.service.ts's taskPkKey). `projectid` and every
  // *userid are plain `INT`, which the driver does return as numbers.
  taskid: number;
  projectid: number;
  parenttaskid: number | null;
  tasknumber: number;
  title: string;
  description: string;
  statuscode: TaskStatusCode;
  prioritycode: TaskPriorityCode;
  startdate: string;
  duedate: string;
  createdbyuserid: number;
  completedatutc: Date | null;
  completionsummary: string | null;
  archivedatutc: Date | null;
  projectarchivedatutc: Date | null;
  createdatutc: Date;
  updatedatutc: Date;
  rowversion: string;
  projectcode: string;
  subtaskcount?: number;
  completedsubtaskcount?: number;
  haspendingeditapproval?: boolean;
  // Multi-team architecture (database/migrations/20260816_01_project_teams.sql): the owning team
  // and, for an Admin-created task awaiting the team lead's assignment, 'NeedsTeamAssignment'.
  teamid?: number | null;
  assignmentstatus?: string | null;
}

export interface TaskAssigneeRow {
  taskid: number;
  userid: number;
}

export interface TaskStatusHistoryRow {
  taskstatushistoryid: number;
  taskid: number;
  fromtaskstatusid: number | null;
  fromstatuscode: TaskStatusCode | null;
  totaskstatusid: number;
  tostatuscode: TaskStatusCode;
  changedbyuserid: number;
  changedbyname: string;
  progressnote: string | null;
  changedatutc: Date;
}

export interface TaskDTO {
  id: string;
  taskNumber: string;
  projectId: string;
  teamId?: string;
  assignmentStatus?: 'NeedsTeamAssignment' | 'Assigned';
  parentTaskId?: string;
  title: string;
  description: string;
  status: ApiTaskStatus;
  priority: ApiTaskPriority;
  assigneeId: string;
  assigneeIds: string[];
  creatorId: string;
  startDate: string;
  dueDate: string;
  estimatedHours: number;
  subtaskCount: number;
  /** How many of `subtaskCount` are in a completed state — server-computed, see task.repository.ts. */
  completedSubtaskCount: number;
  /** 0-100 whole-number completion percentage of this task's subtasks. */
  subtaskProgress: number;
  /** When this task itself entered a completed state (ISO), if it has. */
  completedAt?: string;
  /** True when this task/subtask is in a completed state — what the board's checklist renders. */
  completed: boolean;
  subtasks: TaskDTO[];
  dependencies: string[];
  tags: string[];
  attachments: [];
  approvalStatus: 'Approved';
  /** Derived from unresolved persisted task-edit approval records. */
  hasPendingApproval: boolean;
  completionSummary?: string;
  createdAt: string;
  reviewApproval?: 'Pending';
  isArchived: boolean;
  archivedAt?: string;
}

export interface TaskStatusHistoryDTO {
  id: string;
  /** The task this entry belongs to — a parent's history includes its subtasks' entries too. */
  taskId: string;
  fromStatus: ApiTaskStatus | null;
  toStatus: ApiTaskStatus;
  note: string;
  changedBy: string;
  changedByName: string;
  timestamp: string;
}

export interface CreateSubtaskInput {
  title: string;
  description: string;
  priority: ApiTaskPriority;
  startDate: string;
  dueDate: string;
  assigneeIds: string[];
  status?: ApiTaskStatus;
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description: string;
  priority: ApiTaskPriority;
  startDate: string;
  dueDate: string;
  assigneeIds: string[];
  // The team this task belongs to (multi-team architecture). A Team Lead sets this to their own
  // team; an Admin targeting a whole team sets it and leaves assigneeIds empty so the team lead
  // assigns it later (AssignmentStatus = 'NeedsTeamAssignment').
  teamId?: string;
  status?: ApiTaskStatus;
  parentTaskId?: string;
  subtasks?: CreateSubtaskInput[];
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  priority?: ApiTaskPriority;
  startDate?: string;
  dueDate?: string;
  assigneeIds?: string[];
}

export interface ChangeStatusInput {
  status: ApiTaskStatus;
  note: string;
}

// A Project Lead's per-subtask verdict when rejecting a parent task's review — see
// task.service.ts's decideReview. Only completed (`Done`) subtasks require a decision: accepted
// ones stay Done untouched, rejected ones return to InProgress with `comment` persisted as their
// own work.TaskStatusHistory entry (the same audit trail every other status change already uses).
export interface SubtaskReviewDecisionInput {
  subtaskId: string;
  decision: 'Accept' | 'Reject';
  comment?: string;
}

export interface TaskEditApprovalInput {
  title: string;
  description: string;
  priority: ApiTaskPriority;
  startDate: string;
  dueDate: string;
}

export interface TaskEditApprovalRow {
  changerequestid: number;
  taskid: number;
  projectid: number;
  tasktitle: string;
  requestedbyuserid: number;
  requeststatus: 'Pending' | 'Approved' | 'Rejected';
  submittedatutc: Date;
  fieldcode: string | null;
  oldvaluejson: string | null;
  proposedvaluejson: string | null;
}
