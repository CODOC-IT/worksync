import * as repo from './task.repository.js';
import { DB_TO_API_PRIORITY, rowToHistoryDTO, rowToTaskDTO, toDateKey } from './task.mapper.js';
import { fromProjectPk, fromTaskPk, fromTeamPk, fromUserPk, toProjectPkOrNull, toTaskPk, toTeamPk, toUserPk } from '../utils/idMapping.js';
import { userStore } from '../store/userStore.js';
import * as notificationService from '../notifications/notification.service.js';
import * as projectRepo from '../projects/project.repository.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import { ActivityChange } from '../activity/activity.types.js';
import { isProjectAccessible, isProjectLead, recheckPendingRemovalForMember } from '../projects/project.service.js';
import { resolveTeamLeadUserId } from '../projects/project.mapper.js';
import {
  API_TO_DB_TASK_STATUS,
  ApiTaskStatus,
  ChangeStatusInput,
  CreateTaskInput,
  DB_TO_API_TASK_STATUS,
  SubtaskReviewDecisionInput,
  TaskDTO,
  TaskEditApprovalInput,
  TaskRow,
  TaskStatusCode,
  TaskStatusHistoryDTO,
  UpdateTaskInput
} from './task.types.js';
import { getTaskEditDenialReason } from './task.authorization.js';
import {
  describeTaskEditTarget,
  diffTaskEdit,
  formatTaskEditChange,
  summarizeTaskEditFields,
  TaskEditTarget
} from './taskEditCopy.js';
import { shouldAnnounceProjectCompletion } from './task.projectCompletion.js';
import { actorDisplayName } from '../utils/actorDisplay.js';

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

// Canonical key for matching a task primary key that came from a DB row against one derived from
// a frontend `tsk-<n>` id. Necessary because `work.Tasks.TaskId` is a Postgres `bigint`, and
// node-postgres returns bigint columns as JavaScript *strings* ('49') to avoid precision loss,
// while toTaskPk() returns a *number* (49) — so `row.taskid === toTaskPk(id)` and
// `map.get(row.taskid)` on a number-keyed Map both silently fail every time. TaskRow.taskid is
// declared `number`, which hides this from the compiler (see task.types.ts). Normalizing both
// sides through String() makes the comparison correct regardless of which representation the
// driver hands back.
const taskPkKey = (taskPk: number | string): string => String(taskPk);

// Read-only visibility for a project's tasks. HR sees every project's tasks without being a
// member, mirroring the identical bypass project.service.ts's listProjectsForUser/
// getProjectForUser already grant for projects themselves — otherwise HR's Project Board is
// permanently empty, since HR is never added as a project member.
//
// Deliberately a task-module helper rather than widening the shared isProjectAccessible: that
// function also gates Project Chat's *write* path (discussion.service.ts's postMessage) and the
// AI Assistant, so adding HR there would hand HR the ability to post in every project's chat.
// Every write in this file rejects HR independently (assertCanEditTask/assertCanChangeTaskStatus/
// assertCanDeleteTask, and isProjectLead which returns false for HR), so this can only ever
// widen what HR may READ.
const canReadProjectTasks = async (projectId: string, userId: string, role: string): Promise<boolean> =>
  role === 'HR' || (await isProjectAccessible(projectId, userId, role));

const assertTaskCanBeWorkedOn = (row: TaskRow): void => {
  if (row.archivedatutc) throw new TaskNotFoundError('Task not found.');
  if (row.projectarchivedatutc) {
    throw new TaskAuthorizationError(
      'This task is archived with its project and cannot be changed until the project is restored.'
    );
  }
};

// Mirrors the exact rule frontend/src/features/tasks/taskRules.ts's canEditTask already
// established (Admin always; Team Lead only for their own project; Team Member only if
// assigned) — re-derived server-side since the backend must never trust the client's own
// permission check.
const assertCanEditTask = async (row: TaskRow, userId: string, role: string): Promise<void> => {
  if (role === 'HR') throw new TaskAuthorizationError('HR users cannot edit tasks.');
  const assignees = await repo.findAssigneesForTask(row.taskid);
  const isAssignee = assignees.some((assignee) => fromUserPk(assignee.userid) === userId);

  if (row.parenttaskid) {
    if (await isProjectLead(projectFrontendId(row), userId, role)) return;
    const denialReason = getTaskEditDenialReason({
      actorId: userId,
      assigneeIds: assignees.map((assignee) => fromUserPk(assignee.userid)),
      parentTaskId: row.parenttaskid,
      subtaskCount: Number(row.subtaskcount || 0)
    });
    if (denialReason) throw new TaskAuthorizationError(denialReason);
    if (role === 'Team_Member') {
      throw new TaskAuthorizationError('Submit this subtask edit for your Team Lead\'s approval.');
    }
    return;
  }

  if (Number(row.subtaskcount || 0) > 0) {
    if (await isProjectLead(projectFrontendId(row), userId, role)) return;
    throw new TaskAuthorizationError('Only this project\'s Team Lead can edit a task that has subtasks.');
  }

  const projectId = projectFrontendId(row);
  if (await isProjectLead(projectId, userId, role)) return;
  if (isAssignee && role !== 'Team_Member') return;
  if (isAssignee) {
    throw new TaskAuthorizationError('Submit this task edit for your Team Lead\'s approval.');
  }
  throw new TaskAuthorizationError('You can only edit tasks assigned to you or in projects you lead.');
};

const assertCanDeleteTask = async (row: TaskRow, userId: string, role: string): Promise<void> => {
  if (role === 'HR') throw new TaskAuthorizationError('HR users cannot delete tasks.');
  const assignees = await repo.findAssigneesForTask(row.taskid);
  if (assignees.some((assignee) => fromUserPk(assignee.userid) === userId)) return;
  if (await isProjectLead(projectFrontendId(row), userId, role)) return;
  throw new TaskAuthorizationError('You can only delete tasks assigned to you or in projects you lead.');
};

// Kanban status movement is intentionally independent from the controlled task-detail edit
// workflow. An assigned Team Member can move their work through To Do/In Progress/Review
// directly; only field edits such as title, dates, description, and priority require approval.
const assertCanChangeTaskStatus = async (row: TaskRow, userId: string, role: string): Promise<void> => {
  if (role === 'HR') throw new TaskAuthorizationError('HR users cannot change task status.');
  if (role === 'Admin') return;
  if (await isProjectLead(projectFrontendId(row), userId, role)) return;

  const assignees = await repo.findAssigneesForTask(row.taskid);
  if (assignees.some((assignee) => fromUserPk(assignee.userid) === userId)) return;
  throw new TaskAuthorizationError('Only an assignee or this project\'s Team Lead can change task status.');
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

// Appends the mandatory reason the actor typed to a notification's body. Every status change on
// this board carries one (it is validated as required before anything is written, and stored on
// work.TaskStatusHistory.ProgressNote), so a recipient should not have to open the task just to
// learn *why* it moved. Defensive against a blank note so the line is never left dangling.
const withNote = (message: string, note?: string | null): string => {
  const trimmed = note?.trim();
  return trimmed ? `${message} Note: ${trimmed}` : message;
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
  projectId?: string,
  archived = false
): Promise<TaskDTO[]> => {
  if (projectId) {
    if (!(await canReadProjectTasks(projectId, userId, role))) {
      throw new TaskAuthorizationError('Project not found or access denied.');
    }
    const rows = await repo.findTasksForProject(toProjectPkOrNull(projectId)!, archived);
    return buildDTOs(rows);
  }

  const allRows = archived ? await repo.findArchivedProjectTasks() : await repo.findAllTasks();
  // HR shares Admin's org-wide read here for the same reason it shares it in
  // project.service.ts's listProjectsForUser — read-only visibility of every project.
  if (role === 'Admin' || role === 'HR') return buildDTOs(allRows);

  // Non-admins: filter down to only tasks in projects they can access (mirrors the old
  // projectStore.getTasksForProject's per-project scoping, generalized across all projects).
  const accessible: TaskRow[] = [];
  const checked = new Map<string, boolean>();
  for (const row of allRows) {
    const pid = projectFrontendId(row);
    if (!checked.has(pid)) checked.set(pid, await canReadProjectTasks(pid, userId, role));
    if (checked.get(pid)) accessible.push(row);
  }
  return buildDTOs(accessible);
};

export const getTaskForUser = async (taskId: string, userId: string, role: string): Promise<TaskDTO> => {
  const row = await repo.findTaskById(toTaskPk(taskId));
  if (!row || row.archivedatutc) throw new TaskNotFoundError('Task not found.');
  if (!(await canReadProjectTasks(projectFrontendId(row), userId, role))) {
    throw new TaskAuthorizationError('You do not have access to this task.');
  }
  const children = row.parenttaskid ? [] : await repo.findChildTasks(row.taskid);
  const assignees = await repo.findAssigneesForTasks([row.taskid, ...children.map((child) => child.taskid)]);
  const task = rowToTaskDTO({ ...row, subtaskcount: children.length }, assignees);
  task.subtasks = children.map((child) => rowToTaskDTO(child, assignees));
  return task;
};

export const createTask = async (input: CreateTaskInput, actorId: string, actorRole: string): Promise<TaskDTO> => {
  if (!input.projectId) throw new TaskValidationError('projectId is required.');
  if (actorRole !== 'Admin' && !(await isProjectLead(input.projectId, actorId, actorRole))) {
    throw new TaskAuthorizationError('You do not have permission to create tasks in this project.');
  }

  const projectPk = toProjectPkOrNull(input.projectId);
  const projectRow = projectPk ? await projectRepo.findProjectById(projectPk) : null;
  if (!projectRow) throw new TaskValidationError('The selected project no longer exists.');
  if (projectRow.statuscode !== 'Active') {
    throw new TaskValidationError('Tasks can only be created in active projects.');
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
  // --- Multi-team scoping ----------------------------------------------------------------
  // When a project uses teams, a task belongs to exactly one team. A Team Lead may only build
  // tasks for their own team; an Admin may either target a whole team (handoff -- the task is
  // created unassigned for the team lead to distribute) or create directly for a team's members.
  //
  // Resolved BEFORE the assignee validation below, not after: an Admin->Team handoff is defined by
  // having no assignees yet, so deciding it afterwards made the branch unreachable -- every such
  // create was rejected by "At least one assignee is required" before it could ever be recognized
  // as a handoff, and admin_task_needs_team_assignment could never be published.
  const teams = await projectRepo.findTeamsForProject(projectRow.projectid);
  const teamMembers = await projectRepo.findTeamMembersForProject(projectRow.projectid);
  const userTeamByPk = new Map<number, number>();
  for (const tm of teamMembers) userTeamByPk.set(tm.userid, tm.teamid);
  const teamLeadByTeam = new Map<number, number>();
  for (const tm of teamMembers) if (tm.islead) teamLeadByTeam.set(tm.teamid, tm.userid);

  const teamHandoff = Boolean(
    teams.length > 0 && actorRole === 'Admin' && input.teamId
      && (!input.assigneeIds || input.assigneeIds.length === 0)
  );

  // An assignee is required for every task except an Admin's team handoff, whose whole point is
  // that the receiving Team Lead -- not the Admin -- chooses who does the work (§8: "Admin can only
  // assign the task to a TEAM, not directly to an individual member").
  if (!teamHandoff && (!input.assigneeIds || input.assigneeIds.length === 0)) {
    throw new TaskValidationError('At least one assignee is required.');
  }

  // A handoff is the one create that legitimately arrives with no assignees, so the list is
  // normalized to [] here rather than left possibly-undefined for the validation, insert and
  // notification code below — all of which index into it unconditionally.
  input = {
    ...input,
    assigneeIds: input.assigneeIds || [],
    subtasks: input.subtasks?.map((subtask) => ({ ...subtask, assigneeIds: subtask.assigneeIds || [] }))
  };

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
    if (!teamHandoff && !taskInput.assigneeIds?.length) {
      throw new TaskValidationError(`${label} requires at least one assignee.`);
    }
  }

  const projectMembers = await projectRepo.findMembersForProject(projectRow.projectid);
  const projectMemberIds = new Set(projectMembers.map((member) => fromUserPk(member.userid)));

  let taskTeamId: number | undefined;
  let assignmentStatus: 'NeedsTeamAssignment' | 'Assigned' | undefined;

  if (teamHandoff) {
    const targetTeam = teams.find((team) => team.teamid === toTeamPk(input.teamId!));
    if (!targetTeam) throw new TaskValidationError('Target team not found in this project.');
    taskTeamId = targetTeam.teamid;
    assignmentStatus = 'NeedsTeamAssignment';
  } else if (teams.length > 0) {
    if (actorRole !== 'Admin') {
      // Team Lead (or the single-lead creator path): force the task into the actor's own team.
      const actorTeamId = userTeamByPk.get(toUserPk(actorId));
      if (!actorTeamId) throw new TaskValidationError('You are not assigned to a team in this project.');
      taskTeamId = actorTeamId;
    } else if (input.assigneeIds && input.assigneeIds.length > 0) {
      const firstTeamId = userTeamByPk.get(toUserPk(input.assigneeIds[0]));
      if (!firstTeamId) throw new TaskValidationError('Assignees must be members of a team in this project.');
      taskTeamId = firstTeamId;
    }
    assignmentStatus = 'Assigned';
  }

  for (const taskInput of allInputs) {
    if (taskInput.assigneeIds.some((assigneeId) => !projectMemberIds.has(assigneeId))) {
      throw new TaskValidationError('Every task and subtask assignee must be an active project member.');
    }
    // A Team Lead may assign work to themselves within their own team. Team/project scoping
    // above still prevents them from assigning anyone outside that team.
    const hrAssignee = taskInput.assigneeIds.find((assigneeId) => userStore.findById(assigneeId)?.role === 'HR');
    if (hrAssignee) {
      throw new TaskValidationError('HR users cannot be assigned tasks.');
    }
    if (taskTeamId && !teamHandoff) {
      const foreignAssignee = taskInput.assigneeIds.find((id) => userTeamByPk.get(toUserPk(id)) !== taskTeamId);
      if (foreignAssignee) {
        throw new TaskValidationError('Every task and subtask assignee must belong to the task\'s team.');
      }
    }
  }

  // Subtasks stay within the parent task's selected work group.
  const parentAssigneeIds = new Set(input.assigneeIds);
  for (const subtask of input.subtasks || []) {
    if (subtask.assigneeIds.some((assigneeId) => !parentAssigneeIds.has(assigneeId))) {
      throw new TaskValidationError('Subtask assignees must be selected on the parent task.');
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
    assigneeUserIds: taskInput.assigneeIds.map(toUserPk),
    teamId: taskTeamId,
    assignmentStatus
  });
  const parentInsert = await toInsertRow(input);
  const childInserts = await Promise.all((input.subtasks || []).map(toInsertRow));
  const { parentTaskId: taskId } = await repo.insertTaskBundle(parentInsert, childInserts);

  const row = await repo.findTaskById(taskId);
  const dto = await buildDTO(row!);
  const actorName = actorDisplayName(actorId);

  // Admin -> team handoff: the task has no assignees yet, so tell the receiving team's lead they
  // now own assigning it. (The team lead's identity comes from the TeamMembers IsLead row.)
  if (teamHandoff && taskTeamId && teamLeadByTeam.has(taskTeamId)) {
    const teamLeadFrontendId = fromUserPk(teamLeadByTeam.get(taskTeamId)!);
    publishSafely(
      {
        type: 'admin_task_needs_team_assignment',
        title: 'Task Awaits Your Assignment',
        message: `${actorName} created "${dto.title}" in ${projectRow.projectname} and assigned it to ` +
          'your team. Assign it to a member to get it started.',
        actorId,
        projectId: dto.projectId,
        taskId: dto.id
      },
      [teamLeadFrontendId],
      actorId
    );
  }

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

// --- Task edit notifications ----------------------------------------------------------------
// An edit used to raise a single generic `task_updated` ("X updated <task>.") addressed to every
// assignee plus the Team Lead, no matter what actually changed — which told a recipient nothing
// and reached people the change did not concern. It is replaced by a diff-driven fan-out:
//
//   * someone newly assigned            -> their own "you have been assigned" notification
//   * someone removed from the task     -> their own "you have been removed" notification
//   * priority / due date / other fields-> one notification per *kind* of change, addressed only
//                                          to the people still working on the task (+ the Lead)
//
// Newly-added assignees deliberately do NOT also receive the field-change notices: their
// assignment notification already carries the task's current priority and dates, so sending both
// would describe a change from a state they never saw.

interface TaskFieldChange {
  field: string;
  previousValue: string;
  newValue: string;
}

// Which notification type reports which field. Anything not listed here rolls up into the
// generic `task_updated`, which names the fields it covers rather than staying vague.
const FIELD_CHANGE_EVENTS: Record<string, { type: 'task_priority_changed' | 'task_due_date_changed'; title: string }> = {
  Priority: { type: 'task_priority_changed', title: 'Task Priority Changed' },
  'Due date': { type: 'task_due_date_changed', title: 'Task Due Date Changed' }
};

const notifyTaskEdited = (context: {
  row: TaskRow;
  dto: TaskDTO;
  actorId: string;
  actorName: string;
  projectName?: string;
  previousAssigneeIds: string[];
  changedAssignees: boolean;
  fieldChanges: TaskFieldChange[];
}): void => {
  const { row, dto, actorId, actorName, previousAssigneeIds, changedAssignees, fieldChanges } = context;
  const projectName = context.projectName || 'the project';

  void (async () => {
    try {
      // Same describer the controlled-edit notifications use, so a member reads one consistent
      // phrasing — 'subtask "Testing" under task "Notification Module"' — whether their subtask
      // was reassigned, re-prioritized, or had an edit request decided. It also owns the
      // fallback for an unreadable parent, which the previous inline version got wrong: it
      // emitted `task` and `subtask` metadata with the same value.
      const target = await resolveTaskEditTarget(row, dto.title);
      const isSubtask = target.isSubtask;
      const where = target.label;
      const teamLeadId = await resolveProjectTeamLead(row.projectid);

      const previous = new Set(previousAssigneeIds);
      const current = new Set(dto.assigneeIds);
      const added = changedAssignees ? dto.assigneeIds.filter((id) => !previous.has(id)) : [];
      const removed = changedAssignees ? previousAssigneeIds.filter((id) => !current.has(id)) : [];
      const retained = dto.assigneeIds.filter((id) => !added.includes(id));

      const assignmentType = isSubtask ? 'subtask_assignment_changed' : 'task_reassigned';
      const sharedMetadata = {
        project: projectName,
        ...target.metadata,
        priority: dto.priority,
        dueDate: dto.dueDate,
        updatedBy: actorName
      };

      if (added.length > 0) {
        publishSafely(
          {
            type: assignmentType,
            title: isSubtask ? 'Subtask Assigned' : 'Task Assigned',
            message: `You have been assigned to ${where} in ${projectName}.`,
            detail: [
              `${actorName} assigned you to ${where} in ${projectName}.`,
              '',
              `Priority: ${dto.priority}`,
              `Due: ${dto.dueDate}`
            ].join('\n'),
            metadata: { ...sharedMetadata, change: 'Assigned' },
            actorId,
            projectId: dto.projectId,
            taskId: dto.id
          },
          added,
          actorId
        );
      }

      if (removed.length > 0) {
        publishSafely(
          {
            type: assignmentType,
            title: isSubtask ? 'Removed From Subtask' : 'Removed From Task',
            message: `You have been removed from ${where} in ${projectName}.`,
            detail: `${actorName} removed you from ${where} in ${projectName}. It no longer appears in your assigned work.`,
            metadata: { ...sharedMetadata, change: 'Removed' },
            actorId,
            projectId: dto.projectId,
            taskId: dto.id
          },
          removed,
          actorId
        );
      }

      if (fieldChanges.length === 0) return;

      // One notification per kind of change, so "priority raised to Urgent" is never buried
      // inside a generic update notice — and so a recipient can mute or filter by the specific
      // type. Recipients are the people the change actually affects: whoever is still working on
      // the task, plus the Lead who oversees it.
      const fieldRecipients = [...retained, teamLeadId];
      const grouped = new Map<string, { title: string; changes: TaskFieldChange[] }>();
      for (const change of fieldChanges) {
        const event = FIELD_CHANGE_EVENTS[change.field];
        const key = event ? event.type : 'task_updated';
        const title = event ? event.title : 'Task Updated';
        const bucket = grouped.get(key) || { title, changes: [] };
        bucket.changes.push(change);
        grouped.set(key, bucket);
      }

      for (const [type, { title, changes }] of grouped) {
        const fieldList = changes.map((change) => change.field.toLowerCase()).join(', ');
        const summary =
          changes.length === 1
            ? `${actorName} changed the ${fieldList} of ${where} from "${changes[0].previousValue}" to "${changes[0].newValue}".`
            : `${actorName} updated the ${fieldList} of ${where}.`;
        publishSafely(
          {
            type: type as Parameters<typeof notificationService.publishEvent>[0]['type'],
            title,
            message: summary,
            detail: [
              `${actorName} updated ${where} in ${projectName}.`,
              '',
              'Changes:',
              ...changes.map((change) => `• ${change.field}: "${change.previousValue}" → "${change.newValue}"`)
            ].join('\n'),
            metadata: { ...sharedMetadata, fieldsChanged: changes.map((change) => change.field).join(', ') },
            actorId,
            projectId: dto.projectId,
            taskId: dto.id
          },
          fieldRecipients,
          actorId
        );
      }
    } catch (error) {
      // A notification failure must never surface as a failed edit — the task update itself has
      // already committed by the time this runs.
      console.error('[task.service] Failed to publish task edit notifications.', error);
    }
  })();
};

export const updateTask = async (
  taskId: string,
  input: UpdateTaskInput,
  actorId: string,
  actorRole: string
): Promise<TaskDTO> => {
  const row = await repo.findTaskById(toTaskPk(taskId));
  if (!row) throw new TaskNotFoundError('Task not found.');
  assertTaskCanBeWorkedOn(row);
  await assertCanEditTask(row, actorId, actorRole);

  if (input.assigneeIds !== undefined && !(await isProjectLead(projectFrontendId(row), actorId, actorRole))) {
    throw new TaskAuthorizationError('Only this project\'s Team Lead can change task assignments.');
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
    if (input.assigneeIds.length === 0) throw new TaskValidationError('Tasks must retain at least one assignee.');
    const projectRow = await projectRepo.findProjectById(row.projectid);
    const projectMembers = await projectRepo.findMembersForProject(row.projectid);
    const projectMemberIds = new Set(projectMembers.map((member) => fromUserPk(member.userid)));
    const projectLeadId = projectRow ? resolveTeamLeadUserId(projectRow, projectMembers) : '';
    if (input.assigneeIds.some((id) => !projectMemberIds.has(id))) {
      throw new TaskValidationError('Every assignee must be an active project member.');
    }
    if (projectLeadId && input.assigneeIds.includes(projectLeadId)) {
      throw new TaskValidationError('The active project Team Lead cannot be assigned development tasks in this project.');
    }
    if (row.parenttaskid) {
      const parentAssigneeIds = new Set((await repo.findAssigneesForTask(row.parenttaskid)).map((assignee) => fromUserPk(assignee.userid)));
      if (input.assigneeIds.some((id) => !parentAssigneeIds.has(id))) {
        throw new TaskValidationError('Subtask assignees must also be assigned to the parent task.');
      }
    }
    const hrAssignee = input.assigneeIds.find((id) => userStore.findById(id)?.role === 'HR');
    if (hrAssignee) throw new TaskValidationError('HR users cannot be assigned tasks.');
  }
  await repo.updateTask(row.taskid, updates, assigneePks, toUserPk(actorId));

  const updatedRow = await repo.findTaskById(row.taskid);
  const dto = await buildDTO(updatedRow!);
  const actorName = actorDisplayName(actorId);

  // Both sides of every comparison must be in the same representation before being called a
  // "change". Two traps here, and the notification fan-out below makes both user-visible rather
  // than merely cosmetic in an audit row:
  //   - Dates come back from node-postgres as Date objects, not 'YYYY-MM-DD' strings (TaskRow
  //     declares them `string`, which hides it from the compiler). Comparing the inbound string
  //     directly against the row is true for EVERY value, so an unchanged date — which the edit
  //     form resubmits on every save — reported as changed and notified everyone.
  //   - work.Priorities stores 'Critical' for the tier the product calls 'Urgent', so an
  //     un-translated previous value read "from Critical to High" for a level no user has ever
  //     seen named that.
  const previousStartDate = toDateKey(row.startdate);
  const previousDueDate = toDateKey(row.duedate);
  const taskChanges = [
    input.title !== undefined && input.title.trim() !== row.title ? { field: 'Title', previousValue: row.title, newValue: dto.title } : null,
    input.description !== undefined && input.description.trim() !== row.description ? { field: 'Description', previousValue: row.description, newValue: dto.description } : null,
    input.priority !== undefined && DB_TO_API_PRIORITY_CODE[input.priority] !== row.prioritycode ? { field: 'Priority', previousValue: DB_TO_API_PRIORITY[row.prioritycode] || row.prioritycode, newValue: input.priority } : null,
    input.startDate !== undefined && input.startDate !== previousStartDate ? { field: 'Start date', previousValue: previousStartDate, newValue: dto.startDate } : null,
    input.dueDate !== undefined && input.dueDate !== previousDueDate ? { field: 'Due date', previousValue: previousDueDate, newValue: dto.dueDate } : null,
    input.assigneeIds !== undefined ? { field: 'Assignee', previousValue: previousAssigneeIds.join(', '), newValue: dto.assigneeIds.join(', ') } : null
  ].filter((change): change is { field: string; previousValue: string; newValue: string } => Boolean(change));
  const hasPriorityChange = taskChanges.some((c) => c.field === 'Priority');
  const hasAssigneeChange = taskChanges.some((c) => c.field === 'Assignee');
  const project = await projectRepo.findProjectById(row.projectid);

  notifyTaskEdited({
    row,
    dto,
    actorId,
    actorName,
    projectName: project?.projectname,
    previousAssigneeIds,
    changedAssignees: input.assigneeIds !== undefined,
    fieldChanges: taskChanges.filter((change) => change.field !== 'Assignee')
  });

  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: hasAssigneeChange ? 'Assigned/Reassigned' : hasPriorityChange ? 'Priority Changed' : 'Updated',
    module: 'Tasks', entityType: 'Task', entityId: dto.id, entityName: dto.title,
    projectId: dto.projectId, projectName: project?.projectname, taskId: dto.id, taskName: dto.title,
    description: `${actorName} updated task “${dto.title}”.`, linkRoute: 'tasks', changes: taskChanges
  });

  return dto;
};

const taskEditSnapshot = (row: TaskRow): TaskEditApprovalInput => ({
  title: row.title,
  description: row.description,
  priority: row.prioritycode === 'Critical' ? 'Urgent' : row.prioritycode,
  startDate: row.startdate,
  dueDate: row.duedate
});

// Field-level diff between the stored task snapshot and the proposed edit, recorded on both the
// request event (what the member wants changed) and the decision event (what was actually
// applied or rejected). Mirrors the changes[] shape updateTask writes for direct edits so the
// Activity Log renders one consistent edit trail regardless of which path changed the task.
const taskEditDiff = (previous: TaskEditApprovalInput, proposed: TaskEditApprovalInput): ActivityChange[] => [
  previous.title !== proposed.title ? { field: 'Title', previousValue: previous.title, newValue: proposed.title } : null,
  previous.description !== proposed.description ? { field: 'Description', previousValue: previous.description, newValue: proposed.description } : null,
  previous.priority !== proposed.priority ? { field: 'Priority', previousValue: previous.priority, newValue: proposed.priority } : null,
  previous.startDate !== proposed.startDate ? { field: 'Start date', previousValue: previous.startDate, newValue: proposed.startDate } : null,
  previous.dueDate !== proposed.dueDate ? { field: 'Due date', previousValue: previous.dueDate, newValue: proposed.dueDate } : null,
].filter((change): change is ActivityChange => Boolean(change));

const validateTaskEditApprovalInput = (input: TaskEditApprovalInput): void => {
  if (!input.title?.trim()) throw new TaskValidationError('Task title cannot be empty.');
  if (!input.description?.trim()) throw new TaskValidationError('Task description cannot be empty.');
  if (!['Low', 'Medium', 'High', 'Urgent'].includes(input.priority)) {
    throw new TaskValidationError('Task priority is invalid.');
  }
  if (!input.startDate || !input.dueDate || input.dueDate < input.startDate) {
    throw new TaskValidationError('Due date cannot be before the start date.');
  }
};

// --- Controlled task edits ------------------------------------------------------------------
// The diffing and copy-building are pure and live in taskEditCopy.ts (unit-tested there). This
// is the only part that needs the database: resolving a subtask's parent title so the
// notification can name it. Costs one indexed primary-key lookup, and only for subtasks — a
// top-level task never touches the database here.
const resolveTaskEditTarget = async (row: TaskRow, title: string): Promise<TaskEditTarget> => {
  if (!row.parenttaskid) return describeTaskEditTarget(title);
  const parent = await repo.findTaskById(row.parenttaskid);
  return describeTaskEditTarget(title, parent?.title || '');
};

export interface TaskEditApprovalDTO {
  id: string;
  type: 'Controlled_Edit';
  targetId: string;
  targetTitle: string;
  requestedBy: string;
  requestedRole: 'Team_Member';
  createdAt: string;
  details: string;
  status: 'Pending';
  projectId: string;
  proposedTaskUpdate: TaskEditApprovalInput;
  previousTaskSnapshot: TaskEditApprovalInput;
}

export const createTaskEditApproval = async (
  taskId: string,
  input: TaskEditApprovalInput,
  actorId: string,
  actorRole: string
): Promise<TaskEditApprovalDTO> => {
  if (actorRole !== 'Team_Member') {
    throw new TaskAuthorizationError('Only Team Members can submit task edit requests.');
  }
  const row = await repo.findTaskById(toTaskPk(taskId));
  if (!row) throw new TaskNotFoundError('Task not found.');
  assertTaskCanBeWorkedOn(row);
  const assignees = await repo.findAssigneesForTask(row.taskid);
  if (!assignees.some((assignee) => fromUserPk(assignee.userid) === actorId)) {
    throw new TaskAuthorizationError('You can only request edits to tasks assigned to you.');
  }
  if (!row.parenttaskid && Number(row.subtaskcount || 0) > 0) {
    throw new TaskAuthorizationError('Tasks with subtasks cannot be edited by Team Members.');
  }
  validateTaskEditApprovalInput(input);
  const project = await projectRepo.findProjectById(row.projectid);
  if (!project) throw new TaskNotFoundError('Project not found.');
  if (input.startDate < project.startdate || input.dueDate > project.enddate) {
    throw new TaskValidationError('Task dates must be within the project dates.');
  }

  const members = await projectRepo.findMembersForProject(row.projectid);
  // Multi-team architecture: the reviewer is the Team Lead of the *assignee's team* (falling back
  // to the project lead for legacy no-team projects), so a member's edit lands with the person who
  // actually owns the work being changed rather than a project lead in a different team.
  let reviewerId = resolveTeamLeadUserId(project, members);
  const teams = await projectRepo.findTeamsForProject(row.projectid);
  const teamMembers = await projectRepo.findTeamMembersForProject(row.projectid);
  if (teams.length > 0) {
    const actorTeamId = teamMembers.find((tm) => tm.userid === toUserPk(actorId))?.teamid;
    const actorTeamLead = actorTeamId
      ? teamMembers.find((tm) => tm.teamid === actorTeamId && tm.islead)
      : undefined;
    if (actorTeamLead) reviewerId = fromUserPk(actorTeamLead.userid);
  }
  if (!reviewerId || reviewerId === actorId) {
    throw new TaskAuthorizationError('This project does not have an eligible Team Lead.');
  }
  const previous = taskEditSnapshot(row);
  const proposed: TaskEditApprovalInput = {
    ...input,
    title: input.title.trim(),
    description: input.description.trim()
  };
  if (JSON.stringify(previous) === JSON.stringify(proposed)) {
    throw new TaskValidationError('No task changes were supplied.');
  }
  let requestPk: number;
  try {
    requestPk = await repo.insertTaskEditApproval(
      row,
      toUserPk(actorId),
      toUserPk(reviewerId),
      previous,
      proposed
    );
  } catch (error) {
    if ((error as Error)?.message === 'This task already has a pending edit request.') {
      throw new TaskValidationError((error as Error).message);
    }
    throw error;
  }
  const createdAt = new Date().toISOString();
  const changes = diffTaskEdit(previous, proposed);
  const requesterName = actorDisplayName(actorId);
  const reviewerName = actorDisplayName(reviewerId);
  const target = await resolveTaskEditTarget(row, row.title);

  // The request must land in the Activity Log before the response is sent: it is the member's
  // only audit trace for their proposed edit (the task itself is not touched until approval).
  // affectedUser is the reviewing Team Lead, so the request surfaces in the Lead's activity as
  // well as the member's own, and the changes[] diff previews exactly what was proposed.
  recordActivitySafe({
    actorId, actorName: requesterName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    affectedUserId: reviewerId, affectedUserName: reviewerName,
    action: 'Task Edit Requested', module: 'Tasks', entityType: 'Task',
    entityId: taskId, entityName: row.title,
    projectId: fromProjectPk(row.projectid), projectName: project.projectname,
    taskId, taskName: row.title,
    description: `${requesterName} requested an edit to task “${row.title}” — pending ${reviewerName}'s approval.`,
    linkRoute: 'approvals', important: true,
    changes: taskEditDiff(previous, proposed),
    metadata: { approvalId: `task-edit-${requestPk}`, requestedBy: actorId, reviewerId }
  });

  // The project's current Team Lead is the only recipient: they are the sole person authorized to
  // decide this request (decideTaskEditApproval re-checks isProjectLead), so nobody else has an
  // action to take and nobody else is told. Published server-side, in the same request that wrote
  // work.TaskChangeRequests, so it is persisted, appears in notification history, and survives a
  // refresh — the frontend no longer dispatches anything for this event.
  publishSafely(
    {
      type: 'task_edit_approval_requested',
      title: target.isSubtask ? 'Subtask Edit Request' : 'Task Edit Request',
      message: `${requesterName} requested an edit to ${target.label} (${summarizeTaskEditFields(changes)}).`,
      detail: [
        `${requesterName} submitted an edit request for ${target.label} in ${project.projectname} and is waiting on your decision.`,
        '',
        'Requested changes:',
        ...changes.map((change) => `• ${formatTaskEditChange(change)}`)
      ].join('\n'),
      metadata: {
        project: project.projectname,
        ...target.metadata,
        requestedBy: requesterName,
        fieldsChanged: changes.map((change) => change.label).join(', '),
        requestedAt: createdAt
      },
      actorId,
      projectId: fromProjectPk(row.projectid),
      // Stays the edited row's own id, including for a subtask: it is the accurate provenance of
      // the event and is what groupNotifications keys on, so two subtasks of the same parent
      // never collapse into one row. The parent is carried in `metadata.task` instead.
      taskId
    },
    [reviewerId],
    actorId
  );
  return {
    id: `task-edit-${requestPk}`,
    type: 'Controlled_Edit',
    targetId: taskId,
    targetTitle: row.title,
    requestedBy: actorId,
    requestedRole: 'Team_Member',
    createdAt,
    details: `${userStore.findById(actorId)?.name || 'A Team Member'} requested an update to "${row.title}". Pending Team Lead approval.`,
    status: 'Pending',
    projectId: fromProjectPk(row.projectid),
    proposedTaskUpdate: proposed,
    previousTaskSnapshot: previous
  };
};

export const listTaskEditApprovals = async (
  actorId: string,
  actorRole: string
): Promise<TaskEditApprovalDTO[]> => {
  const rows = await repo.findPendingTaskEditApprovalsForReviewer(toUserPk(actorId));
  const grouped = new Map<number, typeof rows>();
  for (const row of rows) grouped.set(row.changerequestid, [...(grouped.get(row.changerequestid) || []), row]);

  const result: TaskEditApprovalDTO[] = [];
  for (const requestRows of grouped.values()) {
    const row = requestRows[0];
    if (!(await isProjectLead(fromProjectPk(row.projectid), actorId, actorRole))) continue;
    const item = requestRows.find((candidate) => candidate.fieldcode === 'taskUpdate');
    if (!item?.oldvaluejson || !item.proposedvaluejson) continue;
    try {
      const previous = JSON.parse(item.oldvaluejson) as TaskEditApprovalInput;
      const proposed = JSON.parse(item.proposedvaluejson) as TaskEditApprovalInput;
      result.push({
        id: `task-edit-${row.changerequestid}`,
        type: 'Controlled_Edit',
        targetId: fromTaskPk(row.taskid),
        targetTitle: row.tasktitle,
        requestedBy: fromUserPk(row.requestedbyuserid),
        requestedRole: 'Team_Member',
        createdAt: new Date(row.submittedatutc).toISOString(),
        details: `Task update requested for "${row.tasktitle}". Pending Team Lead approval.`,
        status: 'Pending',
        projectId: fromProjectPk(row.projectid),
        proposedTaskUpdate: proposed,
        previousTaskSnapshot: previous
      });
    } catch {
      // Ignore malformed legacy rows instead of creating an unusable inbox item.
    }
  }
  return result;
};

export const decideTaskEditApproval = async (
  approvalId: string,
  decision: 'Approved' | 'Rejected',
  actorId: string,
  actorRole: string,
  reason?: string
): Promise<TaskDTO | null> => {
  const requestPk = Number(approvalId.replace(/^task-edit-/, ''));
  if (!Number.isInteger(requestPk) || requestPk <= 0) {
    throw new TaskValidationError('Invalid task edit approval id.');
  }
  const approvals = await listTaskEditApprovals(actorId, actorRole);
  const approval = approvals.find((candidate) => candidate.id === approvalId);
  if (!approval) throw new TaskAuthorizationError('This task edit request is not assigned to you.');
  const row = await repo.findTaskById(toTaskPk(approval.targetId));
  if (!row) throw new TaskNotFoundError('Task not found.');
  assertTaskCanBeWorkedOn(row);
  if (!(await isProjectLead(fromProjectPk(row.projectid), actorId, actorRole))) {
    throw new TaskAuthorizationError('Only this project\'s Team Lead can decide the task update.');
  }
  const taskPk = await repo.decideTaskEditApproval(
    requestPk,
    toUserPk(actorId),
    decision,
    approval.proposedTaskUpdate,
    reason
  );
  if (!taskPk) throw new TaskValidationError('This task edit request is no longer pending.');

  // Only the Team Member who submitted the request is notified — nobody else asked for anything,
  // so nobody else hears about the outcome (and in particular the rejection reason, which is
  // feedback addressed to one person, never broadcast).
  //
  // `reason` is the exact value repo.decideTaskEditApproval just persisted to
  // work.ChangeRequestReviews.ReviewNote in the transaction above, so the notification body and
  // the stored review history can never disagree; it is also written to
  // notify.Notifications.DetailText here, which is what keeps it visible in the Notification
  // Center after a refresh without re-reading the change-request tables.
  const changes = diffTaskEdit(approval.previousTaskSnapshot, approval.proposedTaskUpdate);
  const approverName = actorDisplayName(actorId);
  const projectRow = await projectRepo.findProjectById(row.projectid);
  const projectName = projectRow?.projectname || 'the project';
  const decidedAt = new Date().toISOString();
  const trimmedReason = reason?.trim();
  // Named from the snapshot taken when the request was submitted, not from `row.title`: an
  // approved title change would otherwise report the outcome under the *new* name, leaving the
  // requester unable to match the notification to the request they actually made.
  const target = await resolveTaskEditTarget(row, approval.targetTitle);
  const subject = target.isSubtask ? 'Subtask' : 'Task';

  publishSafely(
    decision === 'Approved'
      ? {
          type: 'task_edit_approval_approved',
          title: `${subject} Edit Request Approved`,
          message: `${approverName} approved your edit request for ${target.label}.`,
          detail: [
            `${approverName} approved your edit request for ${target.label} in ${projectName}. The changes are now live on the ${target.noun}.`,
            '',
            'Approved changes:',
            ...changes.map((change) => `• ${formatTaskEditChange(change)}`),
            ...(trimmedReason ? ['', `Comment: ${trimmedReason}`] : [])
          ].join('\n'),
          metadata: {
            project: projectName,
            ...target.metadata,
            approvedBy: approverName,
            fieldsChanged: changes.map((change) => change.label).join(', '),
            decidedAt
          },
          actorId,
          projectId: approval.projectId,
          taskId: approval.targetId
        }
      : {
          type: 'task_edit_approval_rejected',
          title: `${subject} Edit Request Rejected`,
          message: `${approverName} rejected your edit request for ${target.label}.`,
          detail: [
            `${approverName} rejected your edit request for ${target.label} in ${projectName}. The ${target.noun} is unchanged.`,
            '',
            'Requested changes:',
            ...changes.map((change) => `• ${formatTaskEditChange(change)}`),
            '',
            `Reason: ${trimmedReason || 'No reason was recorded.'}`
          ].join('\n'),
          metadata: {
            project: projectName,
            ...target.metadata,
            rejectedBy: approverName,
            fieldsChanged: changes.map((change) => change.label).join(', '),
            rejectionReason: trimmedReason || '',
            decidedAt
          },
          actorId,
          projectId: approval.projectId,
          taskId: approval.targetId
        },
    [approval.requestedBy],
    actorId
  );

  // The decision is the audit event for the applied (or refused) edit: the change is executed
  // inside the repository transaction above (never through service.updateTask, which writes its
  // own activity), so this is the only place it can be recorded. affectedUserId is the
  // requesting member, which is what makes the decision surface in the member's own Activity Log
  // (affecteduseridtext matches the viewer's frontend id in activity.repository.ts) rather than
  // only the reviewer's. Uses the same subtask-aware `target` the notification above does, so a
  // subtask decision reads "subtask 'Testing' under task 'Notification Module'" here too, instead
  // of the ambiguous bare title a second identically-named subtask would otherwise share.
  const requesterName = actorDisplayName(approval.requestedBy);
  recordActivitySafe({
    actorId, actorName: approverName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    affectedUserId: approval.requestedBy, affectedUserName: requesterName,
    action: decision === 'Approved' ? 'Task Edit Approved' : 'Task Edit Rejected',
    module: 'Tasks', entityType: 'Task',
    entityId: approval.targetId, entityName: approval.targetTitle,
    projectId: approval.projectId, projectName: projectRow?.projectname,
    taskId: approval.targetId, taskName: approval.targetTitle,
    description: decision === 'Approved'
      ? `${approverName} approved ${requesterName}'s edit request for ${target.label}.`
      : `${approverName} rejected ${requesterName}'s edit request for ${target.label}.`,
    reason: trimmedReason, linkRoute: 'approvals', important: true,
    changes: changes.map((change) => ({
      field: change.label,
      previousValue: change.previousValue,
      newValue: change.newValue
    })),
    metadata: { approvalId, requestedBy: approval.requestedBy, decidedBy: actorId }
  });

  if (decision === 'Rejected') return null;
  const updated = await repo.findTaskById(taskPk);
  return updated ? buildDTO(updated) : null;
};

// --- Cross-team subtask transfer (multi-team architecture) --------------------------------
// A Team Lead hands one of their team's subtasks to another team. The request is reviewed by an
// Admin (Approvals inbox); on approval the subtask's TeamId flips to the target team and its lead
// is notified. Server-side authorization only -- never trust the frontend.

export interface SubtaskTransferRequestDTO {
  id: string;
  subtaskId: string;
  subtaskTitle: string;
  projectId: string;
  fromTeamId: string | null;
  toTeamId: string;
  toTeamName: string;
  requestedByUserId: string;
  reason: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  requestedAt: string;
  decidedAt?: string;
  decisionReason?: string;
}

const toTransferDTO = async (row: repo.SubtaskTransferRequestRow): Promise<SubtaskTransferRequestDTO> => {
  const subtask = await repo.findTaskById(row.subtaskid);
  const toTeam = row.toteamid ? await projectRepo.findTeamById(row.toteamid) : null;
  return {
    id: String(row.requestid),
    subtaskId: fromTaskPk(row.subtaskid),
    subtaskTitle: subtask?.title || fromTaskPk(row.subtaskid),
    projectId: fromProjectPk(row.projectid),
    fromTeamId: row.fromteamid !== null ? fromTeamPk(row.fromteamid) : null,
    toTeamId: fromTeamPk(row.toteamid),
    toTeamName: toTeam?.teamname || fromTeamPk(row.toteamid),
    requestedByUserId: fromUserPk(row.requestedbyuserid),
    reason: row.requestreason || '',
    status: row.requeststatus,
    requestedAt: row.requestedatutc.toISOString(),
    decidedAt: row.decidedatutc ? row.decidedatutc.toISOString() : undefined,
    decisionReason: row.decisionreason || undefined
  };
};

export const requestSubtaskTransfer = async (
  subtaskId: string,
  toTeamId: string,
  reason: string,
  actorId: string,
  actorRole: string
): Promise<SubtaskTransferRequestDTO> => {
  const row = await repo.findTaskById(toTaskPk(subtaskId));
  if (!row) throw new TaskNotFoundError('Subtask not found.');
  if (!row.parenttaskid) throw new TaskValidationError('Only subtasks can be transferred to another team.');
  if (!row.teamid) throw new TaskValidationError('This subtask is not part of a team.');
  assertTaskCanBeWorkedOn(row);

  const project = await projectRepo.findProjectById(row.projectid);
  if (!project) throw new TaskNotFoundError('Project not found.');

  const toTeam = await projectRepo.findTeamById(toTeamPk(toTeamId));
  if (!toTeam || toTeam.projectid !== row.projectid) {
    throw new TaskValidationError('Target team not found in this project.');
  }
  if (toTeam.teamid === row.teamid) {
    throw new TaskValidationError('The subtask already belongs to that team.');
  }
  if (!reason?.trim()) throw new TaskValidationError('A reason is required to request a subtask transfer.');

  const teamMembers = await projectRepo.findTeamMembersForProject(row.projectid);
  const sourceTeamLead = teamMembers.find((tm) => tm.teamid === row.teamid && tm.islead);
  if (!sourceTeamLead || fromUserPk(sourceTeamLead.userid) !== actorId) {
    throw new TaskAuthorizationError('Only the subtask\'s Team Lead can request a transfer.');
  }

  const requestPk = await repo.insertSubtaskTransferRequest({
    subtaskId: row.taskid,
    projectId: row.projectid,
    fromTeamId: row.teamid,
    toTeamId: toTeam.teamid,
    requestedByUserId: toUserPk(actorId),
    reason: reason.trim()
  });

  const actorName = actorDisplayName(actorId);
  const admins = (await userStore.getAllUsers()).filter((user) => user.role === 'Admin');
  // Everything an Admin needs in order to decide, in the expanded body rather than the preview:
  // which parent task the subtask hangs off, which team holds it now, which team is asking for it,
  // who leads each, and the requester's stated reason (§9).
  const fromTeam = await projectRepo.findTeamById(row.teamid);
  const targetLead = teamMembers.find((tm) => tm.teamid === toTeam.teamid && tm.islead);
  const parentTask = row.parenttaskid ? await repo.findTaskById(row.parenttaskid) : null;
  const fromTeamName = fromTeam?.teamname || 'the current team';
  const targetLeadName = targetLead ? actorDisplayName(fromUserPk(targetLead.userid)) : 'unassigned';

  publishSafely(
    {
      type: 'subtask_transfer_requested',
      title: 'Subtask Transfer Requested',
      message: `${actorName} requested to transfer subtask "${row.title}" from the "${fromTeamName}" to the ` +
        `"${toTeam.teamname}".`,
      detail: [
        `${actorName}, Team Lead of the "${fromTeamName}", requested to transfer subtask "${row.title}" to the ` +
          `"${toTeam.teamname}" in project "${project.projectname}", and is waiting on your decision.`,
        '',
        `Reason: ${reason.trim()}`
      ].join('\n'),
      metadata: {
        project: project.projectname,
        ...(parentTask ? { parentTask: parentTask.title } : {}),
        subtask: row.title,
        currentTeam: fromTeamName,
        proposedTeam: toTeam.teamname,
        currentTeamLead: actorName,
        targetTeamLead: targetLeadName,
        requestedBy: actorName,
        reason: reason.trim()
      },
      actorId,
      projectId: fromProjectPk(row.projectid),
      taskId: fromTaskPk(row.taskid)
    },
    admins.map((admin) => admin.id),
    actorId
  );
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Requested', module: 'Tasks', entityType: 'Task', entityId: fromTaskPk(row.taskid),
    entityName: row.title, projectId: fromProjectPk(row.projectid), projectName: project.projectname,
    description: `${actorName} requested to transfer subtask “${row.title}” to team “${toTeam.teamname}”.`,
    reason: reason.trim(), linkRoute: 'approvals', important: true
  });

  const created = await repo.findSubtaskTransferRequestById(requestPk);
  return toTransferDTO(created!);
};

export const listPendingSubtaskTransfers = async (actorRole: string): Promise<SubtaskTransferRequestDTO[]> => {
  if (actorRole !== 'Admin') {
    throw new TaskAuthorizationError('Only Admins can view the subtask transfer inbox.');
  }
  const rows = await repo.findPendingSubtaskTransferRequests();
  return Promise.all(rows.map(toTransferDTO));
};

export const decideSubtaskTransfer = async (
  requestId: string,
  decision: 'Approved' | 'Rejected',
  decisionReason: string | null,
  actorId: string,
  actorRole: string
): Promise<SubtaskTransferRequestDTO> => {
  if (actorRole !== 'Admin') {
    throw new TaskAuthorizationError('Only Admins can decide subtask transfer requests.');
  }
  if (decision === 'Rejected' && !decisionReason?.trim()) {
    throw new TaskValidationError('A rejection reason is required.');
  }
  const requestPk = Number(requestId);
  const decided = await repo.decideSubtaskTransferRequest(requestPk, decision, toUserPk(actorId), decisionReason);
  if (!decided) throw new TaskValidationError('This transfer request has already been decided.');

  const subtask = await repo.findTaskById(decided.subtaskid);
  const project = await projectRepo.findProjectById(decided.projectid);
  const toTeam = decided.toteamid ? await projectRepo.findTeamById(decided.toteamid) : null;
  const fromTeam = decided.fromteamid ? await projectRepo.findTeamById(decided.fromteamid) : null;
  const teamMembers = await projectRepo.findTeamMembersForProject(decided.projectid);
  const toTeamLead = toTeam ? teamMembers.find((tm) => tm.teamid === toTeam.teamid && tm.islead) : undefined;
  const actorName = actorDisplayName(actorId);
  const requesterId = fromUserPk(decided.requestedbyuserid);
  const subtaskTitle = subtask?.title || '';
  const toTeamName = toTeam?.teamname || '';
  const fromTeamName = fromTeam?.teamname || 'the previous team';
  const projectName = project?.projectname || '';
  const trimmedReason = decisionReason?.trim();

  if (decision === 'Approved') {
    // Both leads, each reading it from their own side: the requesting lead hears their request was
    // carried out, the receiving lead hears they have gained ownership of the subtask.
    const recipients = [requesterId];
    const recipientMessages: Record<string, string> = {};
    const recipientDetails: Record<string, string> = {};
    if (toTeamLead) {
      const toTeamLeadId = fromUserPk(toTeamLead.userid);
      recipients.push(toTeamLeadId);
      recipientMessages[toTeamLeadId] = `Subtask "${subtaskTitle}" has been transferred to your team.`;
      recipientDetails[toTeamLeadId] = [
        `${actorName} approved transferring subtask "${subtaskTitle}" from the "${fromTeamName}" to your ` +
          `team, the "${toTeamName}", in project "${projectName}".`,
        '',
        'It is now your team\'s work — assign it to one of your members, or to yourself.'
      ].join('\n');
    }
    publishSafely(
      {
        type: 'subtask_transfer_approved',
        title: 'Subtask Transfer Approved',
        message: `${actorName} approved the transfer of subtask "${subtaskTitle}" to the "${toTeamName}".`,
        detail: [
          `${actorName} approved your request to transfer subtask "${subtaskTitle}" from the ` +
            `"${fromTeamName}" to the "${toTeamName}" in project "${projectName}".`,
          '',
          `The subtask now belongs to the "${toTeamName}", whose Team Lead owns assigning it.`,
          ...(trimmedReason ? ['', `Comment: ${trimmedReason}`] : [])
        ].join('\n'),
        metadata: {
          project: projectName,
          subtask: subtaskTitle,
          previousTeam: fromTeamName,
          newTeam: toTeamName,
          approvedBy: `${actorName} (Admin)`,
          status: 'Approved'
        },
        actorId,
        projectId: fromProjectPk(decided.projectid),
        taskId: fromTaskPk(decided.subtaskid),
        recipientMessages,
        recipientDetails
      },
      recipients,
      actorId
    );
  } else {
    // Only the requester. recipientMessages used to be built before the decision was branched on,
    // so its wording was fixed at "approved ... to your team" — meaning on a *rejection* the
    // receiving team's lead was told the subtask had been transferred to them when it had not. They
    // gain nothing from a transfer that did not happen, so they are no longer written to at all.
    //
    // The reason moves out of the compact preview into detail/metadata, where every other rejection
    // in the app keeps it (§13). It is the value decideSubtaskTransferRequest just persisted to
    // work.SubtaskTransferRequests.DecisionReason, so the notification and the stored record cannot
    // disagree, and it stays readable after a refresh without re-reading the request table.
    publishSafely(
      {
        type: 'subtask_transfer_rejected',
        title: 'Subtask Transfer Rejected',
        message: `${actorName} rejected the request to transfer subtask "${subtaskTitle}".`,
        detail: [
          `${actorName} rejected your request to transfer subtask "${subtaskTitle}" from the ` +
            `"${fromTeamName}" to the "${toTeamName}" in project "${projectName}".`,
          '',
          `The subtask stays with the "${fromTeamName}".`,
          '',
          `Reason: ${trimmedReason || 'No reason was recorded.'}`
        ].join('\n'),
        metadata: {
          project: projectName,
          subtask: subtaskTitle,
          currentTeam: fromTeamName,
          proposedTeam: toTeamName,
          rejectedBy: `${actorName} (Admin)`,
          status: 'Rejected',
          rejectionReason: trimmedReason || ''
        },
        actorId,
        projectId: fromProjectPk(decided.projectid),
        taskId: fromTaskPk(decided.subtaskid)
      },
      [requesterId],
      actorId
    );
  }
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: decision === 'Approved' ? 'Approved' : 'Rejected', module: 'Tasks', entityType: 'Task',
    entityId: fromTaskPk(decided.subtaskid), entityName: subtask?.title || fromTaskPk(decided.subtaskid),
    projectId: fromProjectPk(decided.projectid), projectName: project?.projectname || '',
    description:
      `${actorName} ${decision === 'Approved' ? 'approved' : 'rejected'} a request to transfer subtask ` +
      `“${subtask?.title || ''}” to team “${toTeam?.teamname || ''}”.`,
    reason: decisionReason?.trim() || null, linkRoute: 'approvals', important: true
  });

  return toTransferDTO(decided);
};

export const deleteTask = async (taskId: string, actorId: string, actorRole: string): Promise<void> => {
  const row = await repo.findTaskById(toTaskPk(taskId));
  if (!row) throw new TaskNotFoundError('Task not found.');
  assertTaskCanBeWorkedOn(row);
  await assertCanDeleteTask(row, actorId, actorRole);

  const dto = await buildDTO(row);
  const archived = await repo.archiveTask(row.taskid);
  if (!archived) throw new TaskValidationError('Task is already deleted.');

  const actorName = actorDisplayName(actorId);
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
  assertTaskCanBeWorkedOn(row);
  await assertCanChangeTaskStatus(row, actorId, actorRole);

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
  const actorName = actorDisplayName(actorId);
  const projectRow = await projectRepo.findProjectById(row.projectid);

  // This is how a subtask reaches Done (a top-level task's only path to Done is the Approve
  // action in decideReview below, which has its own identical call) -- Issue #6's completion hook.
  if (toMeta.isCompletedState) {
    recheckPendingRemovalSafe(dto.projectId, dto.assigneeIds, actorId);
  }

  // notifyTaskRecipients now always includes the project's Team Lead alongside the assignees,
  // so the Review-specific manual add that used to live here is redundant.
  notifyTaskRecipients(updatedRow!, dto.assigneeIds, actorId, {
    type: (input.status === 'Review'
      ? 'task_review_requested'
      : TASK_STATUS_NOTIFICATION_TYPE[input.status]) as Parameters<typeof notificationService.publishEvent>[0]['type'],
    title: input.status === 'Review' ? 'Review Requested' : 'Task Status Changed',
    message: withNote(
      `${actorName} moved "${dto.title}" from ${row.statuscode} to ${input.status}${
        projectRow ? ` in ${projectRow.projectname}` : ''
      }.`,
      input.note
    ),
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
    await notifySubtaskStatusChange(updatedRow!, row.statuscode, input.status, actorId, actorName, input.note);
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
  actorName: string,
  note?: string
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
      message: withNote(
        becameComplete
          ? `${actorName} completed subtask "${subtaskRow.title}" of "${parentRow.title}".`
          : `${actorName} reopened subtask "${subtaskRow.title}" of "${parentRow.title}".`,
        note
      ),
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

  const actorName = actorDisplayName(actorId);
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
  assertTaskCanBeWorkedOn(row);

  // Admin is intentionally excluded here, unlike everywhere else in this service: reopening is a
  // delivery decision owned by whoever leads the project, not a system-administration action.
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
  const actorName = actorDisplayName(actorId);
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

// --- Project completion announcement -------------------------------------------------------
// Raised when the last outstanding task in a project reaches a completed state. Recipients are
// every Admin, the project's Team Lead, and every project member (PRD §6.6: project-level
// outcomes are exactly what an Admin does track, unlike routine task chatter).
//
// Fires once per completion, not once per Done task. The guard compares the last time this
// project was announced complete against the last time any of its tasks LEFT a completed state
// (repo.findLastProjectReopenTime): if the announcement is the more recent of the two, this
// project's current finished streak has already been announced and nothing is sent. A project
// that is reopened and finished again does announce again — that is a genuinely new completion,
// and the thing being prevented is a *repeat* announcement of the same one. Both facts are read
// from durable tables (notify.Notifications, work.TaskStatusHistory) rather than in-process
// state, so it holds across restarts, concurrent requests, and serverless cold starts.
const PROJECT_COMPLETION_TYPE = 'report_project_completion' as const;

const announceProjectCompletionIfFinished = async (
  projectPk: number,
  actorId: string,
  actorRole: string
): Promise<void> => {
  const { total, completed } = await repo.getProjectTaskCompletion(projectPk);
  if (total === 0 || completed < total) return; // cheap exit before spending two more queries

  const projectId = fromProjectPk(projectPk);
  const [lastAnnouncedAt, lastReopenedAt] = await Promise.all([
    notificationService.getLatestEventTimeForProject(projectId, PROJECT_COMPLETION_TYPE),
    repo.findLastProjectReopenTime(projectPk)
  ]);
  if (!shouldAnnounceProjectCompletion({ total, completed, lastAnnouncedAt, lastReopenedAt })) return;

  const projectRow = await projectRepo.findProjectById(projectPk);
  if (!projectRow) return;
  const members = await projectRepo.findMembersForProject(projectPk);
  const leadId = resolveTeamLeadUserId(projectRow, members);
  const adminIds = (await userStore.getAllUsers())
    .filter((user) => user.role === 'Admin')
    .map((user) => user.id);
  // Everyone with a stake hears it, including whoever approved the final task. The usual
  // "exclude the actor from their own event" rule (publishSafely) is deliberately not applied:
  // this is a project milestone rather than a receipt for an action, and the Team Lead who
  // approved the last task is an explicitly required recipient. Same reasoning as exportBackup's
  // self-notification to the acting Admin.
  const recipientIds = Array.from(
    new Set([...adminIds, leadId, ...members.map((member) => fromUserPk(member.userid))])
  ).filter(Boolean);
  if (recipientIds.length === 0) return;

  await notificationService.publishEvent({
    type: PROJECT_COMPLETION_TYPE,
    title: 'Project Completed',
    message: `All ${total} task${total === 1 ? '' : 's'} in "${projectRow.projectname}" are now complete.`,
    actorId,
    projectId,
    recipientIds
  });

  recordActivitySafe({
    actorId, actorName: actorDisplayName(actorId), actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Completed', module: 'Projects', entityType: 'Project', entityId: projectId,
    entityName: projectRow.projectname, projectId, projectName: projectRow.projectname,
    description: `All ${total} task${total === 1 ? '' : 's'} in “${projectRow.projectname}” are complete.`,
    linkRoute: 'projects', important: true
  });
};

// Never allowed to break the status change that triggered it: by the time this runs the task is
// already committed as Done, so a failure here must surface as a log line, not a failed request.
const announceProjectCompletionSafe = (projectPk: number, actorId: string, actorRole: string): void => {
  announceProjectCompletionIfFinished(projectPk, actorId, actorRole).catch((error) => {
    console.error('[task.service] Failed to announce project completion.', error);
  });
};

// Issue #6: whenever a task or subtask reaches Done, any of its (former) assignees who are
// currently Pending Removal in this project might now be clear to actually remove -- same
// "never break the status change that triggered it" rule as announceProjectCompletionSafe above.
// Fired for every assignee unconditionally; project.service.ts's recheckPendingRemovalForMember
// itself no-ops for anyone not flagged, so this is cheap for the (overwhelmingly common) case of
// no one being Pending Removal at all.
const recheckPendingRemovalSafe = (projectId: string, assigneeIds: string[], actorId: string): void => {
  for (const memberUserId of assigneeIds) {
    recheckPendingRemovalForMember(projectId, memberUserId, actorId).catch((error) => {
      console.error('[task.service] Failed to recheck pending removal.', error);
    });
  }
};

const decideReview = async (
  taskId: string,
  decision: 'Approve' | 'Reject',
  note: string,
  actorId: string,
  actorRole: string,
  subtaskDecisions?: SubtaskReviewDecisionInput[]
): Promise<TaskDTO> => {
  const row = await repo.findTaskById(toTaskPk(taskId));
  if (!row) throw new TaskNotFoundError('Task not found.');
  assertTaskCanBeWorkedOn(row);
  if (row.statuscode !== 'Review') {
    throw new TaskValidationError('Only a task currently in Review can be approved or rejected.');
  }
  // Unlike most authorization checks in this file, Admin gets NO bypass here: only the project's
  // own per-project Team Lead (ProjectMembers.MemberRoleCode = 'TeamLead', resolved by
  // isProjectLead — never the actor's account role) may decide a review. Reviewing delivered
  // work is that project's responsibility, not a system-administration action.
  if (!(await isProjectLead(projectFrontendId(row), actorId, actorRole, { allowAdmin: false }))) {
    throw new TaskAuthorizationError('Only this project\'s Team Lead may decide a review.');
  }
  if (!note?.trim()) throw new TaskValidationError('A reason is required.');

  const actorName = actorDisplayName(actorId);

  // Rejecting a task with completed subtasks requires a per-subtask verdict: accepted subtasks
  // stay Done, rejected ones return to InProgress with their own comment persisted on
  // work.TaskStatusHistory (see notifySubtaskStatusChange below). Only subtasks currently Done
  // are in scope — anything not yet completed was never part of what's being reviewed.
  const rejectedSubtaskRows: TaskRow[] = [];
  if (decision === 'Reject') {
    const children = row.parenttaskid ? [] : await repo.findChildTasks(row.taskid);
    const doneChildren = children.filter((child) => child.statuscode === 'Done');
    if (doneChildren.length > 0) {
      const decisionByTaskId = new Map(
        (subtaskDecisions || []).map((entry) => [taskPkKey(toTaskPk(entry.subtaskId)), entry])
      );
      for (const child of doneChildren) {
        const childDecision = decisionByTaskId.get(taskPkKey(child.taskid));
        if (!childDecision) {
          throw new TaskValidationError(
            `A decision (Accept or Reject) is required for every completed subtask, including "${child.title}".`
          );
        }
        if (childDecision.decision === 'Reject' && !childDecision.comment?.trim()) {
          throw new TaskValidationError(`A comment is required for the rejected subtask "${child.title}".`);
        }
      }
      // Rejecting the overall review while accepting every completed subtask is contradictory --
      // if the checklist was genuinely fine, the reviewer should Approve instead. At least one
      // subtask must carry a Reject verdict for a Reject decision to be valid here.
      if (!doneChildren.some((child) => decisionByTaskId.get(taskPkKey(child.taskid))!.decision === 'Reject')) {
        throw new TaskValidationError('Reject at least one subtask to reject this review, or approve it instead.');
      }

      const doneMeta = await repo.getTaskStatusMeta('Done');
      const inProgressMeta = await repo.getTaskStatusMeta('InProgress');
      for (const child of doneChildren) {
        const childDecision = decisionByTaskId.get(taskPkKey(child.taskid))!;
        if (childDecision.decision !== 'Reject') continue; // Accepted -- remains Done, untouched.
        await repo.changeTaskStatus({
          taskId: child.taskid,
          fromStatusId: doneMeta!.taskStatusId,
          toStatusId: inProgressMeta!.taskStatusId,
          changedByUserId: toUserPk(actorId),
          note: childDecision.comment!.trim(),
          isCompletedState: false
        });
        rejectedSubtaskRows.push((await repo.findTaskById(child.taskid))!);
      }
    }
  }

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

  notifyTaskRecipients(updatedRow!, dto.assigneeIds, actorId, {
    type: decision === 'Approve' ? 'task_review_approved' : 'task_review_rejected',
    title: decision === 'Approve' ? 'Review Approved' : 'Review Rejected',
    message: withNote(
      decision === 'Approve'
        ? `${actorName} approved your review request for "${dto.title}" and marked it Done.`
        : `${actorName} rejected your review request for "${dto.title}" and returned it to In Progress.`,
      note
    ),
    actorId,
    projectId: dto.projectId,
    taskId: dto.id
  });

  // Each rejected subtask's own assignees hear specifically that THEIR subtask was rejected
  // (not the generic "reopened" wording notifySubtaskStatusChange uses for an assignee reopening
  // their own finished work — a Project Lead rejecting it during review is a different event and
  // reads differently), with the Lead's comment for that subtask. The Team Lead is the actor
  // here, so they're excluded from their own notification by publishSafely as usual.
  for (const childRow of rejectedSubtaskRows) {
    const childDecision = (subtaskDecisions || []).find(
      (entry) => taskPkKey(toTaskPk(entry.subtaskId)) === taskPkKey(childRow.taskid)
    );
    // Only rows the loop above actually rejected land in rejectedSubtaskRows, so a decision is
    // always present — but this stays defensive rather than asserting, because the status change
    // and history write have already committed by this point and a notification lookup must
    // never be what throws afterwards.
    if (!childDecision) continue;
    const childAssignees = (await repo.findAssigneesForTask(childRow.taskid)).map((a) => fromUserPk(a.userid));
    publishSafely(
      {
        type: 'subtask_reopened',
        title: 'Subtask Rejected',
        message: withNote(
          `${actorName} rejected your subtask "${childRow.title}" during review of "${dto.title}".`,
          childDecision.comment
        ),
        actorId,
        projectId: dto.projectId,
        taskId: fromTaskPk(childRow.taskid)
      },
      childAssignees,
      actorId
    );
  }

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

  // Approving a review is the only way a top-level task reaches Done (changeTaskStatus rejects a
  // direct move to Done for any task that requires review), so this is the one place a project
  // can become fully complete.
  if (decision === 'Approve') {
    announceProjectCompletionSafe(row.projectid, actorId, actorRole);
    // Issue #6's completion hook -- same reasoning as changeTaskStatus's identical call above.
    recheckPendingRemovalSafe(dto.projectId, dto.assigneeIds, actorId);
  }

  return dto;
};

export const approveTask = (taskId: string, note: string, actorId: string, actorRole: string): Promise<TaskDTO> =>
  decideReview(taskId, 'Approve', note, actorId, actorRole);

export const rejectTask = (
  taskId: string,
  note: string,
  actorId: string,
  actorRole: string,
  subtaskDecisions?: SubtaskReviewDecisionInput[]
): Promise<TaskDTO> => decideReview(taskId, 'Reject', note, actorId, actorRole, subtaskDecisions);

export const getTaskHistory = async (taskId: string, userId: string, role: string): Promise<TaskStatusHistoryDTO[]> => {
  const row = await repo.findTaskById(toTaskPk(taskId));
  if (!row) throw new TaskNotFoundError('Task not found.');
  if (!(await canReadProjectTasks(projectFrontendId(row), userId, role))) {
    throw new TaskAuthorizationError('You do not have access to this task.');
  }
  const rows = await repo.findStatusHistoryForTask(row.taskid);
  return rows.map(rowToHistoryDTO);
};
