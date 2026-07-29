import * as repo from './task.repository.js';
import { rowToHistoryDTO, rowToTaskDTO } from './task.mapper.js';
import { fromUserPk, toProjectPkOrNull, toTaskPk, toUserPk } from '../utils/idMapping.js';
import { userStore } from '../store/userStore.js';
import * as notificationService from '../notifications/notification.service.js';
import * as projectRepo from '../projects/project.repository.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import { isProjectAccessible, isProjectLead } from '../projects/project.service.js';
import { resolveTeamLeadUserId } from '../projects/project.mapper.js';
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
  if (role === 'HR') throw new TaskAuthorizationError('HR users cannot edit tasks.');
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

// Recipients are always assignees + the project's Team Lead (PRD §6.3/§6.6: a Team Lead must
// see the full task lifecycle for their own projects, not only when they're also personally
// assigned) -- resolveTeamLeadUserId falls back to the project Owner when there's no separate
// 'TeamLead' membership row, matching the same fallback already used for authorization
// (project.service.ts's isProjectLead) and for the Review-decision notification this used to be
// special-cased for. The actor is still always excluded from their own event's recipient list.
const notifyTaskRecipients = (
  row: TaskRow,
  assigneeIds: string[],
  actorId: string,
  event: Omit<Parameters<typeof notificationService.publishEvent>[0], 'recipientIds'>
): void => {
  void (async () => {
    const recipientSet = new Set(assigneeIds);
    try {
      const projectRow = await projectRepo.findProjectById(row.projectid);
      if (projectRow) {
        const members = await projectRepo.findMembersForProject(row.projectid);
        recipientSet.add(resolveTeamLeadUserId(projectRow, members));
      }
    } catch (error) {
      console.error('[task.service] Failed to resolve project Team Lead for notification recipients.', error);
    }

    const recipientIds = Array.from(recipientSet).filter((id) => id !== actorId);
    if (recipientIds.length === 0) return;

    try {
      await notificationService.publishEvent({ ...event, recipientIds });
    } catch (error) {
      console.error('[task.service] Failed to publish notification event.', event.type, error);
    }
  })();
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
  const children = row.parenttaskid ? [] : await repo.findChildTasks(row.taskid);
  const assignees = await repo.findAssigneesForTasks([row.taskid, ...children.map((child) => child.taskid)]);
  const task = rowToTaskDTO({ ...row, subtaskcount: children.length }, assignees);
  task.subtasks = children.map((child) => rowToTaskDTO(child, assignees));
  return task;
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

  const allInputs = [input, ...(input.subtasks || [])];
  for (const [index, taskInput] of allInputs.entries()) {
    const label = index === 0 ? 'Task' : `Subtask ${index}`;
    if (!taskInput.title?.trim()) throw new TaskValidationError(`${label} title is required.`);
    if (!taskInput.description?.trim()) throw new TaskValidationError(`${label} description is required.`);
    if (!taskInput.startDate || !taskInput.dueDate || taskInput.dueDate < taskInput.startDate) {
      throw new TaskValidationError(`${label} due date cannot be before its start date.`);
    }
    if (taskInput.startDate < projectRow.startdate || taskInput.dueDate > projectRow.enddate) {
      throw new TaskValidationError(`${label} dates must be within the project dates.`);
    }
    if (!taskInput.assigneeIds?.length) throw new TaskValidationError(`${label} requires at least one assignee.`);
  }

  const projectMemberIds = new Set((await projectRepo.findMembersForProject(projectRow.projectid)).map((member) => fromUserPk(member.userid)));
  for (const taskInput of allInputs) {
    if (taskInput.assigneeIds.some((assigneeId) => !projectMemberIds.has(assigneeId))) {
      throw new TaskValidationError('Every task and subtask assignee must be an active project member.');
    }
    const hrAssignee = taskInput.assigneeIds.find((assigneeId) => userStore.findById(assigneeId)?.role === 'HR');
    if (hrAssignee) {
      throw new TaskValidationError('HR users cannot be assigned tasks.');
    }
  }

  const toInsertRow = async (taskInput: CreateTaskInput | NonNullable<CreateTaskInput['subtasks']>[number]) => ({
    projectId: projectRow.projectid,
    title: taskInput.title.trim(),
    description: taskInput.description.trim(),
    statusId: await repo.getTaskStatusId(taskInput.status ? API_TO_DB_TASK_STATUS[taskInput.status] : 'Todo'),
    priorityId: await repo.getPriorityId(DB_TO_API_PRIORITY_CODE[taskInput.priority] || 'Medium'),
    startDate: taskInput.startDate,
    dueDate: taskInput.dueDate,
    createdByUserId: toUserPk(actorId),
    assigneeUserIds: taskInput.assigneeIds.map(toUserPk)
  });
  const parentInsert = await toInsertRow(input);
  const childInserts = await Promise.all((input.subtasks || []).map(toInsertRow));
  const { parentTaskId: taskId } = await repo.insertTaskBundle(parentInsert, childInserts);

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

  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Created', module: 'Tasks', entityType: 'Task', entityId: dto.id, entityName: dto.title,
    projectId: dto.projectId, projectName: projectRow.projectname, taskId: dto.id, taskName: dto.title,
    description: `${actorName} created task “${dto.title}” in “${projectRow.projectname}”.`,
    linkRoute: 'tasks', changes: [
      { field: 'Status', previousValue: null, newValue: dto.status },
      { field: 'Priority', previousValue: null, newValue: dto.priority },
      { field: 'Assignee', previousValue: null, newValue: dto.assigneeIds.join(', ') }
    ]
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

  const previousAssigneeIds = input.assigneeIds
    ? (await repo.findAssigneesForTask(row.taskid)).map((a) => fromUserPk(a.userid))
    : [];
  const assigneePks = input.assigneeIds?.map(toUserPk);
  if (input.assigneeIds) {
    const hrAssignee = input.assigneeIds.find((id) => userStore.findById(id)?.role === 'HR');
    if (hrAssignee) throw new TaskValidationError('HR users cannot be assigned tasks.');
  }
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

  const taskChanges = [
    input.title !== undefined && input.title.trim() !== row.title ? { field: 'Title', previousValue: row.title, newValue: dto.title } : null,
    input.description !== undefined && input.description.trim() !== row.description ? { field: 'Description', previousValue: row.description, newValue: dto.description } : null,
    input.priority !== undefined && DB_TO_API_PRIORITY_CODE[input.priority] !== row.prioritycode ? { field: 'Priority', previousValue: row.prioritycode, newValue: input.priority } : null,
    input.startDate !== undefined && input.startDate !== row.startdate ? { field: 'Start date', previousValue: row.startdate, newValue: dto.startDate } : null,
    input.dueDate !== undefined && input.dueDate !== row.duedate ? { field: 'Due date', previousValue: row.duedate, newValue: dto.dueDate } : null,
    input.assigneeIds !== undefined ? { field: 'Assignee', previousValue: previousAssigneeIds.join(', '), newValue: dto.assigneeIds.join(', ') } : null
  ].filter((change): change is { field: string; previousValue: string; newValue: string } => Boolean(change));
  const project = await projectRepo.findProjectById(row.projectid);
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: input.assigneeIds ? 'Assigned/Reassigned' : input.priority ? 'Priority Changed' : 'Updated',
    module: 'Tasks', entityType: 'Task', entityId: dto.id, entityName: dto.title,
    projectId: dto.projectId, projectName: project?.projectname, taskId: dto.id, taskName: dto.title,
    description: `${actorName} updated task “${dto.title}”.`, linkRoute: 'tasks', changes: taskChanges
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
  const project = await projectRepo.findProjectById(row.projectid);
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Deleted', module: 'Tasks', entityType: 'Task', entityId: dto.id, entityName: dto.title,
    projectId: dto.projectId, projectName: project?.projectname, taskId: dto.id, taskName: dto.title,
    description: `${actorName} deleted task “${dto.title}”.`, linkRoute: 'tasks', important: true
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

  // notifyTaskRecipients now always includes the project's Team Lead alongside the assignees,
  // so the Review-specific manual add that used to live here is redundant.
  notifyTaskRecipients(updatedRow!, dto.assigneeIds, actorId, {
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

  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Status Changed', module: 'Kanban', entityType: 'Task', entityId: dto.id, entityName: dto.title,
    projectId: dto.projectId, projectName: projectRow?.projectname, taskId: dto.id, taskName: dto.title,
    description: `${actorName} changed “${dto.title}” from ${row.statuscode} to ${input.status}${projectRow ? ` in “${projectRow.projectname}”` : ''}.`,
    reason: input.note.trim(), linkRoute: 'kanban', important: input.status === 'Review' || input.status === 'Blocked',
    changes: [{ field: 'Status', previousValue: row.statuscode === 'InProgress' ? 'In Progress' : row.statuscode, newValue: input.status }],
    metadata: { requiresReview: input.status === 'Review', overdue: row.duedate < new Date().toISOString().slice(0, 10) }
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

  const projectRow = await projectRepo.findProjectById(row.projectid);
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: decision === 'Approve' ? 'Approved' : 'Rejected', module: 'Approvals',
    entityType: 'Approval', entityId: dto.id, entityName: dto.title,
    projectId: dto.projectId, projectName: projectRow?.projectname, taskId: dto.id, taskName: dto.title,
    description: decision === 'Approve'
      ? `${actorName} approved “${dto.title}” and moved it to Done.`
      : `${actorName} rejected “${dto.title}” and returned it to In Progress.`,
    reason: note.trim(), linkRoute: 'kanban', important: true,
    changes: [{ field: 'Status', previousValue: 'Review', newValue: decision === 'Approve' ? 'Done' : 'In Progress' }],
    metadata: { relatedApproval: true }
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
