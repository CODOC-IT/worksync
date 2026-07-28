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
  createdatutc: Date;
  updatedatutc: Date;
  rowversion: string;
  projectcode: string;
  subtaskcount?: number;
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
  subtasks: TaskDTO[];
  dependencies: string[];
  tags: string[];
  attachments: [];
  approvalStatus: 'Approved';
  completionSummary?: string;
  createdAt: string;
  // Derived, not stored — see task.mapper.ts. 'Pending' whenever status === 'Review' (a task
  // only leaves that state via the explicit Approve/Reject endpoints), undefined otherwise.
  reviewApproval?: 'Pending';
}

export interface TaskStatusHistoryDTO {
  id: string;
  fromStatus: ApiTaskStatus | null;
  toStatus: ApiTaskStatus;
  note: string;
  changedBy: string;
  changedByName: string;
  timestamp: string;
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description: string;
  priority: ApiTaskPriority;
  startDate: string;
  dueDate: string;
  assigneeIds: string[];
  status?: ApiTaskStatus;
  subtasks?: CreateSubtaskInput[];
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
