import { fromProjectPk, fromTaskPk, fromUserPk } from '../utils/idMapping.js';
import {
  ApiTaskPriority,
  DB_TO_API_TASK_STATUS,
  TaskAssigneeRow,
  TaskDTO,
  TaskRow,
  TaskStatusHistoryDTO,
  TaskStatusHistoryRow
} from './task.types.js';

const DB_TO_API_PRIORITY: Record<string, ApiTaskPriority> = {
  Low: 'Low',
  Medium: 'Medium',
  High: 'High',
  Critical: 'Urgent'
};

const formatDate = (value: string | Date): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

const formatProjectTaskNumber = (projectCode: string, taskNumber: number): string => {
  const prefix = projectCode.replace(/^PROJ-/, '') || projectCode;
  return `${prefix}-${String(taskNumber).padStart(2, '0')}`;
};

export const rowToTaskDTO = (row: TaskRow, assignees: TaskAssigneeRow[]): TaskDTO => {
  const assigneeIds = assignees.filter((a) => a.taskid === row.taskid).map((a) => fromUserPk(a.userid));
  const status = DB_TO_API_TASK_STATUS[row.statuscode];

  return {
    id: fromTaskPk(row.taskid),
    taskNumber: formatProjectTaskNumber(row.projectcode, row.tasknumber),
    projectId: fromProjectPk(row.projectid),
    ...(row.parenttaskid ? { parentTaskId: fromTaskPk(row.parenttaskid) } : {}),
    title: row.title,
    description: row.description,
    status,
    priority: DB_TO_API_PRIORITY[row.prioritycode] || 'Medium',
    assigneeId: assigneeIds[0] || '',
    assigneeIds,
    creatorId: fromUserPk(row.createdbyuserid),
    startDate: formatDate(row.startdate),
    dueDate: formatDate(row.duedate),
    estimatedHours: 8,
    subtaskCount: Number(row.subtaskcount || 0),
    completedSubtaskCount: Number(row.completedsubtaskcount || 0),
    // Whole-number percentage so the board's progress bar and its "N%" label can never
    // disagree (both read this one server-computed value). 0 when there are no subtasks.
    subtaskProgress:
      Number(row.subtaskcount || 0) > 0
        ? Math.round((Number(row.completedsubtaskcount || 0) / Number(row.subtaskcount)) * 100)
        : 0,
    completedAt: row.completedatutc ? row.completedatutc.toISOString() : undefined,
    // Explicit boolean rather than leaving consumers to compare status strings. Subtasks are
    // serialized with this same mapper, and the board's checklist renders `completed` directly —
    // without it every subtask read as unticked no matter its real status.
    completed: status === 'Done',
    subtasks: [],
    dependencies: [],
    tags: [],
    attachments: [],
    approvalStatus: 'Approved',
    completionSummary: row.completionsummary || undefined,
    createdAt: formatDate(row.createdatutc),
    reviewApproval: status === 'Review' ? 'Pending' : undefined,
    isArchived: Boolean(row.projectarchivedatutc),
    archivedAt: row.projectarchivedatutc ? row.projectarchivedatutc.toISOString() : undefined
  };
};

export const rowToHistoryDTO = (row: TaskStatusHistoryRow): TaskStatusHistoryDTO => ({
  id: `tsh-${row.taskstatushistoryid}`,
  // Which task this entry belongs to — a parent task's history now also carries its subtasks'
  // entries (see findStatusHistoryForTask), so consumers need this to tell them apart.
  taskId: fromTaskPk(row.taskid),
  fromStatus: row.fromstatuscode ? DB_TO_API_TASK_STATUS[row.fromstatuscode] : null,
  toStatus: DB_TO_API_TASK_STATUS[row.tostatuscode],
  note: row.progressnote || '',
  changedBy: fromUserPk(row.changedbyuserid),
  changedByName: row.changedbyname || 'Unknown',
  timestamp: row.changedatutc.toISOString()
});
