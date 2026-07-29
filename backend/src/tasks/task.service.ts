import * as repo from './task.repository.js';
import { rowToHistoryDTO, rowToTaskDTO } from './task.mapper.js';
import { fromProjectPk, fromTaskPk, fromUserPk, toProjectPkOrNull, toTaskPk, toUserPk } from '../utils/idMapping.js';
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
  DB_TO_API_TASK_STATUS,
  TaskDTO,
  TaskRow,
  TaskStatusCode,
  TaskStatusHistoryDTO,
  UpdateTaskInput
} from './task.types.js';
import { getTaskEditDenialReason } from './task.authorization.js';

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
  if (role === 'HR') throw new TaskAuthorizationError('HR users cannot edit tasks.');
  const assignees = await repo.findAssigneesForTask(row.taskid);
  const isAssignee = assignees.some((assignee) => fromUserPk(assignee.userid) === userId);

  // Subtask editing remains intentionally assignee-only, regardless of project role.
  if (row.parenttaskid) {
    const denialReason = getTaskEditDenialReason({
      actorId: userId,
      assigneeIds: assignees.map((assignee) => fromUserPk(assignee.userid)),
      parentTaskId: row.parenttaskid,
      subtaskCount: Number(row.subtaskcount || 0)
    });
    if (denialReason) throw new TaskAuthorizationError(denialReason);
    return;
  }

  if (Number(row.subtaskcount || 0) > 0) {
    throw new TaskAuthorizationError('A task with subtasks is read-only. Edit its assigned subtasks instead.');
  }
  if (isAssignee) return;

  const projectId = projectFrontendId(row);
  if (role === 'Team_Lead' && await isProjectLead(projectId, userId, role)) return;
  throw new TaskAuthorizationError('You can only edit tasks assigned to you or in projects you lead.');
};

const assertCanDeleteTask = async (row: TaskRow, userId: string, role: string): Promise<void> => {
  if (role === 'HR') throw new TaskAuthorizationError('HR users cannot delete tasks.');
  const assignees = await repo.findAssigneesForTask(row.taskid);
  if (assignees.some((assignee) => fromUserPk(assignee.userid) === userId)) return;
  if (role === 'Team_Lead' && await isProjectLead(projectFrontendId(row), userId, role)) return;
  throw new TaskAuthorizationError('You can only delete tasks assigned to you or in projects you lead.');
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

// The project's Team Lead — the recipient for every "someone finished work you oversee" signal
// the subtask cascade raises. resolveTeamLeadUserId falls back to the project Owner when there
// is no separate 'TeamLead' membership row (the common case for a project a Team Lead created
// for themselves), matching how authorization already resolves the lead in project.service.ts.
const resolveProjectTeamLead = async (projectPk: number): Promise<string> => {
  const projectRow = await projectRepo.findProjectById(projectPk);
  if (!projectRow) return '';
  const members = await projectRepo.findMembersForProject(projectPk);
  return resolveTeamLeadUserId(projectRow, members);
};

// Publishes to an explicit recipient list (deduped, actor and blanks removed). Distinct from
// notifyTaskRecipients, which derives its own recipients from a task's assignees + Team Lead;
// the subtask cascade already knows exactly who should hear about each event, so it passes them
// in directly rather than re-deriving. Failures are logged, never thrown: a notification problem
// must not roll back a status change that already committed.
const publishSafely = (
  event: Omit<Parameters<typeof notificationService.publishEvent>[0], 'recipientIds'>,
  recipientIds: string[],
  actorId: string
): void => {
  const ids = Array.from(new Set(recipientIds)).filter((id) => id && id !== actorId);
  if (ids.length === 0) return;
  notificationService.publishEvent({ ...event, recipientIds: ids }).catch((error) => {
    console.error('[task.service] Failed to publish notification event.', event.type, error);
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

  const parentPk = input.parentTaskId ? toTaskPk(input.parentTaskId) : undefined;

  const toInsertRow = async (taskInput: CreateTaskInput | NonNullable<CreateTaskInput['subtasks']>[number]) => ({
    projectId: projectRow.projectid,
    parentTaskId: parentPk,
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

  // A subtask can be assigned to someone who is not on the parent task at all, so each one gets
  // its own targeted notification rather than being folded into the parent's. Only the
  // subtask's own assignees are told — the Team Lead already heard about the parent above and
  // does not need one notification per checklist item at creation time.
  if (childInserts.length > 0) {
    const children = await repo.findChildTasks(taskId);
    const childAssignees = await repo.findAssigneesForTasks(children.map((child) => child.taskid));
    for (const child of children) {
      publishSafely(
        {
          type: 'subtask_assigned',
          title: 'Subtask Assigned',
          message: `${actorName} assigned you subtask "${child.title}" of "${dto.title}".`,
          actorId,
          projectId: dto.projectId,
          taskId: fromTaskPk(child.taskid)
        },
        childAssignees.filter((a) => a.taskid === child.taskid).map((a) => fromUserPk(a.userid)),
        actorId
      );
    }
  }

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

  if (input.assigneeIds !== undefined) {
    throw new TaskAuthorizationError('Task assignments cannot be changed from the assignee edit form.');
  }

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
  await assertCanDeleteTask(row, actorId, actorRole);

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
  // A Done task is locked to everyone on this generic path, including its assignees and Admins.
  // Reopening it is a deliberate, separately-authorized act (Team Lead only) that must carry its
  // own reason and history entry -- see reopenTask below.
  if (row.statuscode === 'Done' && input.status !== 'Done') {
    throw new TaskValidationError(
      'This task is completed and locked. Only the project\'s Team Lead can reopen it, with a reason.'
    );
  }

  const fromMeta = await repo.getTaskStatusMeta(row.statuscode);
  const toMeta = await repo.getTaskStatusMeta(API_TO_DB_TASK_STATUS[input.status]);
  if (!toMeta) throw new TaskValidationError('Unknown task status.');
  // The Review gate applies to top-level tasks only. A subtask is a checklist item: its assignee
  // marks it done directly, and it is the *parent* that then requires the Team Lead's approval
  // once every subtask is complete (see syncParentFromSubtasks -> Review, never straight to Done).
  // Without this exemption a subtask could never be completed at all.
  if (toMeta.requiresReview && input.status === 'Done' && !row.parenttaskid) {
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

  // This task is itself a subtask -> tell whoever tracks the parent, and let the parent's own
  // status follow the subtask-completion rules. Awaited (not fire-and-forget) so the response
  // the board renders already reflects any parent transition this change triggered.
  if (row.parenttaskid) {
    await notifySubtaskStatusChange(updatedRow!, row.statuscode, input.status, actorId, actorName);
    await syncParentFromSubtasks(row.parenttaskid, actorId, actorRole);
  }

  return dto;
};

// --- Subtask -> parent progress cascade ----------------------------------------------------
// Subtasks are work.Tasks rows with ParentTaskId set (the Task Module's model — untouched here),
// so a subtask's own status change already flows through changeTaskStatus above. What the Board
// module adds is the *consequence* for the parent, per the board's subtask rules:
//   - at least one subtask completed, parent still Todo  -> parent becomes In Progress
//   - every subtask completed                            -> parent becomes Review (never Done;
//     Done stays gated behind the Team Lead's explicit Approve, exactly as before)
// A parent that is Done or Blocked is never auto-moved: Done is locked (only reopenTask may
// leave it) and Blocked is owned by the Task Module's blocker workflow.

const AUTO_ACTOR_NOTE = 'Automatic: subtask progress';

const notifySubtaskStatusChange = async (
  subtaskRow: TaskRow,
  fromStatus: string,
  toStatus: ApiTaskStatus,
  actorId: string,
  actorName: string
): Promise<void> => {
  const parentRow = await repo.findTaskById(subtaskRow.parenttaskid!);
  if (!parentRow) return;

  const becameComplete = toStatus === 'Done';
  const wasComplete = fromStatus === 'Done';
  if (!becameComplete && !wasComplete) return; // only completion/reopening is worth reporting

  // Subtask completion is a Team Lead signal (they track throughput); reopening additionally
  // concerns the subtask's own assignees, who now have work back on their plate.
  const teamLeadId = await resolveProjectTeamLead(subtaskRow.projectid);
  const assignees = (await repo.findAssigneesForTask(subtaskRow.taskid)).map((a) => fromUserPk(a.userid));
  const recipients = becameComplete ? [teamLeadId] : [teamLeadId, ...assignees];

  publishSafely(
    {
      type: becameComplete ? 'subtask_completed' : 'subtask_reopened',
      title: becameComplete ? 'Subtask Completed' : 'Subtask Reopened',
      message: becameComplete
        ? `${actorName} completed subtask "${subtaskRow.title}" of "${parentRow.title}".`
        : `${actorName} reopened subtask "${subtaskRow.title}" of "${parentRow.title}".`,
      actorId,
      projectId: fromProjectPk(subtaskRow.projectid),
      taskId: fromTaskPk(subtaskRow.taskid)
    },
    recipients,
    actorId
  );
};

const syncParentFromSubtasks = async (
  parentTaskId: number,
  actorId: string,
  actorRole: string
): Promise<void> => {
  const parent = await repo.findTaskById(parentTaskId);
  if (!parent) return;
  if (parent.statuscode === 'Done' || parent.statuscode === 'Blocked') return;

  const total = Number(parent.subtaskcount || 0);
  const completed = Number(parent.completedsubtaskcount || 0);
  if (total === 0) return;

  const target: TaskStatusCode | null =
    completed === total ? 'Review' : completed > 0 && parent.statuscode === 'Todo' ? 'InProgress' : null;
  if (!target || target === parent.statuscode) return;

  const fromMeta = await repo.getTaskStatusMeta(parent.statuscode);
  const toMeta = await repo.getTaskStatusMeta(target);
  if (!fromMeta || !toMeta) return;

  await repo.changeTaskStatus({
    taskId: parent.taskid,
    fromStatusId: fromMeta.taskStatusId,
    toStatusId: toMeta.taskStatusId,
    changedByUserId: toUserPk(actorId),
    note: `${AUTO_ACTOR_NOTE} (${completed}/${total} subtasks completed).`,
    isCompletedState: toMeta.isCompletedState
  });

  const actorName = userStore.findById(actorId)?.name || 'Someone';
  const teamLeadId = await resolveProjectTeamLead(parent.projectid);
  const assignees = (await repo.findAssigneesForTask(parent.taskid)).map((a) => fromUserPk(a.userid));
  const projectId = fromProjectPk(parent.projectid);
  const parentFrontendId = fromTaskPk(parent.taskid);

  if (target === 'Review') {
    // Two distinct facts, two notifications: "the checklist is finished" and "a review is now
    // waiting on you". The Team Lead is the actionable recipient of both; assignees are told
    // their task moved so they don't keep looking for it in In Progress.
    publishSafely(
      {
        type: 'checklist_completed',
        title: 'All Subtasks Completed',
        message: `Every subtask of "${parent.title}" is now complete (${total}/${total}).`,
        actorId,
        projectId,
        taskId: parentFrontendId
      },
      [teamLeadId, ...assignees],
      actorId
    );
    publishSafely(
      {
        type: 'task_review_requested',
        title: 'Task Ready For Review',
        message: `"${parent.title}" moved to Review automatically after ${actorName} completed its final subtask.`,
        actorId,
        projectId,
        taskId: parentFrontendId
      },
      [teamLeadId],
      actorId
    );
  } else {
    publishSafely(
      {
        type: 'task_status_changed',
        title: 'Task Status Changed',
        message: `"${parent.title}" moved to In Progress automatically (${completed}/${total} subtasks completed).`,
        actorId,
        projectId,
        taskId: parentFrontendId
      },
      [teamLeadId, ...assignees],
      actorId
    );
  }

  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Status Changed', module: 'Kanban', entityType: 'Task',
    entityId: parentFrontendId, entityName: parent.title,
    projectId, taskId: parentFrontendId, taskName: parent.title,
    description: `“${parent.title}” moved to ${DB_TO_API_TASK_STATUS[target]} automatically after ${completed}/${total} subtasks completed.`,
    reason: AUTO_ACTOR_NOTE, linkRoute: 'kanban', important: target === 'Review',
    changes: [{ field: 'Status', previousValue: DB_TO_API_TASK_STATUS[parent.statuscode], newValue: DB_TO_API_TASK_STATUS[target] }]
  });
};

// --- Team Lead reopen ----------------------------------------------------------------------
// The only way a Done task may leave that state. Deliberately its own endpoint rather than a
// special case inside changeTaskStatus: reopening reverses a completed, approved outcome, so it
// carries a stricter authorization rule (project Team Lead only -- an Admin may view but not
// reopen), a mandatory reason, and its own notification type. The generic status path stays
// locked for Done (see changeTaskStatus), so there is exactly one auditable route back.

export const REOPEN_TARGETS: ApiTaskStatus[] = ['Review', 'In Progress', 'Todo'];

export const reopenTask = async (
  taskId: string,
  input: { status: ApiTaskStatus; reason: string },
  actorId: string,
  actorRole: string
): Promise<TaskDTO> => {
  const row = await repo.findTaskById(toTaskPk(taskId));
  if (!row) throw new TaskNotFoundError('Task not found.');

  // Admin is intentionally excluded here, unlike everywhere else in this service: reopening is a
  // delivery decision owned by whoever leads the project, not a system-administration action.
  if (actorRole !== 'Team_Lead') {
    throw new TaskAuthorizationError('Only the project\'s Team Lead can reopen a completed task.');
  }
  if (!(await isProjectLead(projectFrontendId(row), actorId, actorRole))) {
    throw new TaskAuthorizationError('You can only reopen tasks in projects you lead.');
  }

  if (row.statuscode !== 'Done') {
    throw new TaskValidationError('Only a completed task can be reopened.');
  }
  if (!input.reason?.trim()) {
    throw new TaskValidationError('A reason is required to reopen a completed task.');
  }
  if (!REOPEN_TARGETS.includes(input.status)) {
    throw new TaskValidationError(`A task can only be reopened into ${REOPEN_TARGETS.join(', ')}.`);
  }

  const fromMeta = await repo.getTaskStatusMeta('Done');
  const toMeta = await repo.getTaskStatusMeta(API_TO_DB_TASK_STATUS[input.status]);
  if (!fromMeta || !toMeta) throw new TaskValidationError('Unknown task status.');

  // Same repository call every other transition uses, so the reopen lands in
  // work.TaskStatusHistory with its reason exactly like any other status change -- one shared
  // audit trail, no parallel history table.
  await repo.changeTaskStatus({
    taskId: row.taskid,
    fromStatusId: fromMeta.taskStatusId,
    toStatusId: toMeta.taskStatusId,
    changedByUserId: toUserPk(actorId),
    note: input.reason.trim(),
    isCompletedState: toMeta.isCompletedState
  });

  const updatedRow = await repo.findTaskById(row.taskid);
  const dto = await buildDTO(updatedRow!);
  const actorName = userStore.findById(actorId)?.name || 'Someone';
  const projectRow = await projectRepo.findProjectById(row.projectid);

  // Assignees must know their finished work is live again; Admins are told too because
  // reopening reverses a recorded completion (see the deny-list note in notificationTypes.ts).
  const admins = (await userStore.getAllUsers()).filter((user) => user.role === 'Admin').map((user) => user.id);
  publishSafely(
    {
      type: 'task_reopened',
      title: 'Task Reopened',
      message: `${actorName} reopened "${dto.title}" to ${input.status}. Reason: ${input.reason.trim()}`,
      actorId,
      projectId: dto.projectId,
      taskId: dto.id
    },
    [...dto.assigneeIds, ...admins],
    actorId
  );

  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Reopened', module: 'Kanban', entityType: 'Task', entityId: dto.id, entityName: dto.title,
    projectId: dto.projectId, projectName: projectRow?.projectname, taskId: dto.id, taskName: dto.title,
    description: `${actorName} reopened “${dto.title}” from Done to ${input.status}.`,
    reason: input.reason.trim(), linkRoute: 'kanban', important: true,
    changes: [{ field: 'Status', previousValue: 'Done', newValue: input.status }]
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
