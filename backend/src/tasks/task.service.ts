import * as repo from './task.repository.js';
import { rowToHistoryDTO, rowToTaskDTO } from './task.mapper.js';
import { fromUserPk, toProjectPkOrNull, toTaskPk, toUserPk } from '../utils/idMapping.js';
import { userStore } from '../store/userStore.js';
import * as notificationService from '../notifications/notification.service.js';
import * as projectRepo from '../projects/project.repository.js';
import { isProjectAccessible, isProjectLead } from '../projects/project.service.js';
import {
  API_TO_DB_TASK_STATUS,
  ApiTaskStatus,
  ChangeStatusInput,
  CreateTaskInput,
  TaskDTO,
  TaskRow,
  TaskStatusHistoryDTO,
  UpdateTaskInput
} from './task.types.js';

// Service Layer — business logic, authorization, and notification publishing (matching
// backend/src/notifications and backend/src/projects). No SQL here (task.repository.ts); no
// Express req/res here (task.controller.ts).

export class TaskAuthorizationError extends Error {}
export class TaskNotFoundError extends Error {}
export class TaskValidationError extends Error {}

const DB_TO_API_PRIORITY_CODE: Record<string, 'Low' | 'Medium' | 'High' | 'Critical'> = {
  Low: 'Low',
  Medium: 'Medium',
  High: 'High',
  Urgent: 'Critical'
};

const buildDTO = async (row: TaskRow): Promise<TaskDTO> => {
  const assignees = await repo.findAssigneesForTask(row.taskid);
  return rowToTaskDTO(row, assignees);
};

const buildDTOs = async (rows: TaskRow[]): Promise<TaskDTO[]> => {
  if (rows.length === 0) return [];
  const assignees = await repo.findAssigneesForTasks(rows.map((row) => row.taskid));
  return rows.map((row) => rowToTaskDTO(row, assignees));
};

const projectFrontendId = (row: TaskRow): string => `prj-${row.projectid}`;

// Mirrors the exact rule frontend/src/features/tasks/taskRules.ts's canEditTask already
// established (Admin always; Team Lead only for their own project; Team Member only if
// assigned) — re-derived server-side since the backend must never trust the client's own
// permission check.
const assertCanEditTask = async (row: TaskRow, userId: string, role: string): Promise<void> => {
  if (role === 'Admin') return;
  const projectId = projectFrontendId(row);
  if (role === 'Team_Lead') {
    if (await isProjectLead(projectId, userId, role)) return;
    throw new TaskAuthorizationError('You can only edit tasks in projects you lead.');
  }
  const assignees = await repo.findAssigneesForTask(row.taskid);
  const isAssignee = assignees.some((a) => fromUserPk(a.userid) === userId);
  if (!isAssignee) {
    throw new TaskAuthorizationError('You can only edit tasks assigned to you.');
  }
};

const notifyTaskRecipients = (
  row: TaskRow,
  assigneeIds: string[],
  actorId: string,
  event: Omit<Parameters<typeof notificationService.publishEvent>[0], 'recipientIds'>
) => {
  const recipientIds = Array.from(new Set(assigneeIds)).filter((id) => id !== actorId);
  if (recipientIds.length === 0) return;
  notificationService.publishEvent({ ...event, recipientIds }).catch((error) => {
    console.warn('[task.service] Failed to publish notification event.', error);
  });
};

export const listTasksForUser = async (
  userId: string,
  role: string,
  projectId?: string
): Promise<TaskDTO[]> => {
  if (projectId) {
    if (!(await isProjectAccessible(projectId, userId, role))) {
      throw new TaskAuthorizationError('Project not found or access denied.');
    }
    const rows = await repo.findTasksForProject(toProjectPkOrNull(projectId)!);
    return buildDTOs(rows);
  }

  const allRows = role === 'Admin' ? await repo.findAllTasks() : await repo.findAllTasks();
  if (role === 'Admin') return buildDTOs(allRows);

  // Non-admins: filter down to only tasks in projects they can access (mirrors the old
  // projectStore.getTasksForProject's per-project scoping, generalized across all projects).
  const accessible: TaskRow[] = [];
  const checked = new Map<string, boolean>();
  for (const row of allRows) {
    const pid = projectFrontendId(row);
    if (!checked.has(pid)) checked.set(pid, await isProjectAccessible(pid, userId, role));
    if (checked.get(pid)) accessible.push(row);
  }
  return buildDTOs(accessible);
};

export const getTaskForUser = async (taskId: string, userId: string, role: string): Promise<TaskDTO> => {
  const row = await repo.findTaskById(toTaskPk(taskId));
  if (!row) throw new TaskNotFoundError('Task not found.');
  if (!(await isProjectAccessible(projectFrontendId(row), userId, role))) {
    throw new TaskAuthorizationError('You do not have access to this task.');
  }
  return buildDTO(row);
};

export const createTask = async (input: CreateTaskInput, actorId: string, actorRole: string): Promise<TaskDTO> => {
  if (actorRole !== 'Admin' && actorRole !== 'Team_Lead') {
    throw new TaskAuthorizationError('You do not have permission to create tasks in this project.');
  }
  if (!input.projectId) throw new TaskValidationError('projectId is required.');

  const projectPk = toProjectPkOrNull(input.projectId);
  const projectRow = projectPk ? await projectRepo.findProjectById(projectPk) : null;
  if (!projectRow) throw new TaskValidationError('The selected project no longer exists.');
  if (projectRow.statuscode !== 'Active') {
    throw new TaskValidationError('Tasks can only be created in active projects.');
  }
  if (actorRole === 'Team_Lead' && !(await isProjectLead(input.projectId, actorId, actorRole))) {
    throw new TaskAuthorizationError('You do not have permission to create tasks in this project.');
  }

  if (!input.title?.trim()) throw new TaskValidationError('Task title is required.');
  if (!input.description?.trim()) throw new TaskValidationError('Task description is required.');
  if (!input.startDate || !input.dueDate) throw new TaskValidationError('Start and due dates are required.');
  if (input.dueDate < input.startDate) throw new TaskValidationError('Due date cannot be before the start date.');
  if (input.startDate < projectRow.startdate) {
    throw new TaskValidationError(`Start date cannot be before ${projectRow.startdate}.`);
  }
  if (input.dueDate > projectRow.enddate) {
    throw new TaskValidationError(`Due date cannot be after ${projectRow.enddate}.`);
  }
  if (!input.assigneeIds || input.assigneeIds.length === 0) {
    throw new TaskValidationError('At least one assignee is required.');
  }

  const priorityCode = DB_TO_API_PRIORITY_CODE[input.priority] || 'Medium';
  const priorityId = await repo.getPriorityId(priorityCode === 'Critical' ? 'Critical' : priorityCode);
  const statusId = await repo.getTaskStatusId(
    input.status ? API_TO_DB_TASK_STATUS[input.status] : 'Todo'
  );

  const taskId = await repo.insertTask({
    projectId: projectRow.projectid,
    title: input.title.trim(),
    description: input.description.trim(),
    statusId,
    priorityId,
    startDate: input.startDate,
    dueDate: input.dueDate,
    createdByUserId: toUserPk(actorId),
    assigneeUserIds: input.assigneeIds.map(toUserPk)
  });

  const row = await repo.findTaskById(taskId);
  const dto = await buildDTO(row!);
  const actorName = userStore.findById(actorId)?.name || 'Someone';

  notifyTaskRecipients(row!, dto.assigneeIds, actorId, {
    type: 'task_assigned',
    title: 'Task Assigned',
    message: `${actorName} assigned you "${dto.title}" in ${projectRow.projectname}.`,
    actorId,
    projectId: dto.projectId,
    taskId: dto.id
  });

  return dto;
};

export const updateTask = async (
  taskId: string,
  input: UpdateTaskInput,
  actorId: string,
  actorRole: string
): Promise<TaskDTO> => {
  const row = await repo.findTaskById(toTaskPk(taskId));
  if (!row) throw new TaskNotFoundError('Task not found.');
  await assertCanEditTask(row, actorId, actorRole);

  if (input.title !== undefined && !input.title.trim()) throw new TaskValidationError('Task title cannot be empty.');
  if (input.description !== undefined && !input.description.trim()) {
    throw new TaskValidationError('Task description cannot be empty.');
  }

  const updates: repo.UpdateTaskRow = {
    title: input.title?.trim(),
    description: input.description?.trim(),
    startDate: input.startDate,
    dueDate: input.dueDate
  };
  if (input.priority) {
    updates.priorityId = await repo.getPriorityId(DB_TO_API_PRIORITY_CODE[input.priority] || 'Medium');
  }

  const assigneePks = input.assigneeIds?.map(toUserPk);
  await repo.updateTask(row.taskid, updates, assigneePks, toUserPk(actorId));

  const updatedRow = await repo.findTaskById(row.taskid);
  const dto = await buildDTO(updatedRow!);
  const actorName = userStore.findById(actorId)?.name || 'Someone';

  notifyTaskRecipients(updatedRow!, dto.assigneeIds, actorId, {
    type: 'task_updated',
    title: 'Task Updated',
    message: `${actorName} updated "${dto.title}".`,
    actorId,
    projectId: dto.projectId,
    taskId: dto.id
  });

  return dto;
};

export const deleteTask = async (taskId: string, actorId: string, actorRole: string): Promise<void> => {
  const row = await repo.findTaskById(toTaskPk(taskId));
  if (!row) throw new TaskNotFoundError('Task not found.');
  await assertCanEditTask(row, actorId, actorRole);

  const dto = await buildDTO(row);
  const archived = await repo.archiveTask(row.taskid);
  if (!archived) throw new TaskValidationError('Task is already deleted.');

  const actorName = userStore.findById(actorId)?.name || 'Someone';
  notifyTaskRecipients(row, dto.assigneeIds, actorId, {
    type: 'task_deleted',
    title: 'Task Deleted',
    message: `${actorName} deleted "${dto.title}".`,
    actorId,
    projectId: dto.projectId,
    taskId: dto.id
  });
};

const TASK_STATUS_NOTIFICATION_TYPE: Record<ApiTaskStatus, string> = {
  Todo: 'task_status_changed',
  'In Progress': 'task_status_changed',
  Review: 'task_review_requested',
  Blocked: 'task_status_changed',
  Done: 'task_completed'
};

// The general status-change endpoint — every non-Review-decision transition (Todo <-> In
// Progress <-> Review <-> Blocked) goes through here with a mandatory note, matching the
// Kanban board's StatusChangeModal contract. Review -> Done/In Progress specifically must go
// through approveTask/rejectTask instead (see below), never this generic path, so there's
// always an accountable reviewer on record for that one transition.
export const changeTaskStatus = async (
  taskId: string,
  input: ChangeStatusInput,
  actorId: string,
  actorRole: string
): Promise<TaskDTO> => {
  const row = await repo.findTaskById(toTaskPk(taskId));
  if (!row) throw new TaskNotFoundError('Task not found.');
  await assertCanEditTask(row, actorId, actorRole);

  if (!input.note?.trim()) throw new TaskValidationError('A reason is required for every status change.');
  if (row.statuscode === 'Done' && input.status !== 'Done') {
    throw new TaskValidationError('A completed task cannot be reopened from the board — use the Task module.');
  }

  const fromMeta = await repo.getTaskStatusMeta(row.statuscode);
  const toMeta = await repo.getTaskStatusMeta(API_TO_DB_TASK_STATUS[input.status]);
  if (!toMeta) throw new TaskValidationError('Unknown task status.');
  if (toMeta.requiresReview && input.status === 'Done') {
    throw new TaskValidationError('Moving to Done requires the Approve action, not a direct status change.');
  }

  await repo.changeTaskStatus({
    taskId: row.taskid,
    fromStatusId: fromMeta!.taskStatusId,
    toStatusId: toMeta.taskStatusId,
    changedByUserId: toUserPk(actorId),
    note: input.note.trim(),
    isCompletedState: toMeta.isCompletedState
  });

  const updatedRow = await repo.findTaskById(row.taskid);
  const dto = await buildDTO(updatedRow!);
  const actorName = userStore.findById(actorId)?.name || 'Someone';
  const projectRow = await projectRepo.findProjectById(row.projectid);

  const recipients = new Set(dto.assigneeIds);
  if (input.status === 'Review') {
    // The project's Team Lead specifically needs to know a review decision is waiting on them.
    const members = await projectRepo.findMembersForProject(row.projectid);
    const lead = members.find((m) => m.memberrolecode === 'TeamLead');
    if (lead) recipients.add(fromUserPk(lead.userid));
  }

  notifyTaskRecipients(updatedRow!, Array.from(recipients), actorId, {
    type: (input.status === 'Review'
      ? 'task_review_requested'
      : TASK_STATUS_NOTIFICATION_TYPE[input.status]) as Parameters<typeof notificationService.publishEvent>[0]['type'],
    title: input.status === 'Review' ? 'Review Requested' : 'Task Status Changed',
    message: `${actorName} moved "${dto.title}" from ${row.statuscode} to ${input.status}${
      projectRow ? ` in ${projectRow.projectname}` : ''
    }.`,
    actorId,
    projectId: dto.projectId,
    taskId: dto.id
  });

  return dto;
};

const decideReview = async (
  taskId: string,
  decision: 'Approve' | 'Reject',
  note: string,
  actorId: string,
  actorRole: string
): Promise<TaskDTO> => {
  const row = await repo.findTaskById(toTaskPk(taskId));
  if (!row) throw new TaskNotFoundError('Task not found.');
  if (row.statuscode !== 'Review') {
    throw new TaskValidationError('Only a task currently in Review can be approved or rejected.');
  }
  if (!(await isProjectLead(projectFrontendId(row), actorId, actorRole))) {
    throw new TaskAuthorizationError('Only the project\'s Team Lead or an Admin may decide a review.');
  }
  if (!note?.trim()) throw new TaskValidationError('A reason is required.');

  const toStatusCode = decision === 'Approve' ? 'Done' : 'InProgress';
  const fromMeta = await repo.getTaskStatusMeta('Review');
  const toMeta = await repo.getTaskStatusMeta(toStatusCode);

  await repo.changeTaskStatus({
    taskId: row.taskid,
    fromStatusId: fromMeta!.taskStatusId,
    toStatusId: toMeta!.taskStatusId,
    changedByUserId: toUserPk(actorId),
    note: note.trim(),
    isCompletedState: toMeta!.isCompletedState
  });

  const updatedRow = await repo.findTaskById(row.taskid);
  const dto = await buildDTO(updatedRow!);
  const actorName = userStore.findById(actorId)?.name || 'Someone';

  notifyTaskRecipients(updatedRow!, dto.assigneeIds, actorId, {
    type: decision === 'Approve' ? 'task_review_approved' : 'task_review_rejected',
    title: decision === 'Approve' ? 'Review Approved' : 'Review Rejected',
    message:
      decision === 'Approve'
        ? `${actorName} approved "${dto.title}" and marked it Done.`
        : `${actorName} rejected "${dto.title}" and returned it to In Progress.`,
    actorId,
    projectId: dto.projectId,
    taskId: dto.id
  });

  return dto;
};

export const approveTask = (taskId: string, note: string, actorId: string, actorRole: string): Promise<TaskDTO> =>
  decideReview(taskId, 'Approve', note, actorId, actorRole);

export const rejectTask = (taskId: string, note: string, actorId: string, actorRole: string): Promise<TaskDTO> =>
  decideReview(taskId, 'Reject', note, actorId, actorRole);

export const getTaskHistory = async (taskId: string, userId: string, role: string): Promise<TaskStatusHistoryDTO[]> => {
  const row = await repo.findTaskById(toTaskPk(taskId));
  if (!row) throw new TaskNotFoundError('Task not found.');
  if (!(await isProjectAccessible(projectFrontendId(row), userId, role))) {
    throw new TaskAuthorizationError('You do not have access to this task.');
  }
  const rows = await repo.findStatusHistoryForTask(row.taskid);
  return rows.map(rowToHistoryDTO);
};
