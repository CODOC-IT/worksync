import { fromProjectPk, fromTaskPk, fromUserPk } from '../utils/idMapping.js';
import {
  ApiTaskPriority,
  DB_TO_API_TASK_STATUS,
  SubtaskDTO,
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

export const rowToTaskDTO = (row: TaskRow, assignees: TaskAssigneeRow[], subtasks: SubtaskDTO[] = []): TaskDTO => {
  const assigneeIds = assignees.filter((a) => a.taskid === row.taskid).map((a) => fromUserPk(a.userid));
  const status = DB_TO_API_TASK_STATUS[row.statuscode];

  return {
    id: fromTaskPk(row.taskid),
    taskNumber: formatProjectTaskNumber(row.projectcode, row.tasknumber),
    projectId: fromProjectPk(row.projectid),
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
    subtasks,
    dependencies: [],
    tags: [],
    attachments: [],
    approvalStatus: 'Approved',
    completionSummary: row.completionsummary || undefined,
    createdAt: formatDate(row.createdatutc),
    reviewApproval: status === 'Review' ? 'Pending' : undefined
  };
};

export const rowToHistoryDTO = (row: TaskStatusHistoryRow): TaskStatusHistoryDTO => ({
  id: `tsh-${row.taskstatushistoryid}`,
  fromStatus: row.fromstatuscode ? DB_TO_API_TASK_STATUS[row.fromstatuscode] : null,
  toStatus: DB_TO_API_TASK_STATUS[row.tostatuscode],
  note: row.progressnote || '',
  changedBy: fromUserPk(row.changedbyuserid),
  changedByName: row.changedbyname || 'Unknown',
  timestamp: row.changedatutc.toISOString()
});
