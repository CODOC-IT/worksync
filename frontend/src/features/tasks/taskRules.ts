import {
  Project,
  Task,
  TaskPriority,
  TaskStatus,
  User,
  UserRole
} from '../../types';

export const TASK_STATUSES: TaskStatus[] = [
  'Todo',
  'In Progress',
  'Review',
  'Blocked',
  'Done'
];

// Completion and blockers are managed through their dedicated workflows, never at creation time.
export const CREATE_TASK_STATUSES: TaskStatus[] = TASK_STATUSES.filter(
  (status) => status !== 'Done' && status !== 'Blocked'
);

// Existing blocked tasks remain readable, but Blocked is not a Task-module filter choice.
export const TASK_FILTER_STATUSES: TaskStatus[] = TASK_STATUSES.filter((status) => status !== 'Blocked');

export type TaskModulePriority = TaskPriority;

export const TASK_PRIORITIES: TaskModulePriority[] = [
  'Low',
  'Medium',
  'High',
  'Urgent'
];

export interface TaskFormInput {
  projectId: string;
  title: string;
  description: string;
  priority: TaskModulePriority | '';
  startDate: string;
  dueDate: string;
  teamId?: string;
  assigneeIds: string[];
  status: TaskStatus;
}

export interface SubtaskFormInput extends Omit<TaskFormInput, 'projectId'> {}

export type TaskModuleTask = Task & Partial<{
  assigneeIds: string[];
  startDate: string;
  teamId?: string;
}>;

export interface TaskMutationResult {
  success: boolean;
  message: string;
  task?: TaskModuleTask;
  fieldErrors?: Record<string, string>;
}

export type TaskMutationData = Partial<Omit<Task, 'priority' | 'subtasks'>> & {
  priority?: TaskModulePriority;
  assigneeIds?: string[];
  startDate?: string;
  parentTaskId?: string;
  teamId?: string;
  subtasks?: SubtaskFormInput[];
};

type CompatibleProject = Project & Partial<{
  name: string;
  endDate: string;
  members: string[];
}>;

export interface TaskFilters {
  search: string;
  projectId: string;
  teamId?: string;
  status: string;
  priority: string;
  assigneeId: string;
  myTasksOnly: boolean;
  currentUserId: string;
  dueDateDirection: 'asc' | 'desc';
}

export const getTaskAssigneeIds = (task: Task): string[] =>
  (task as TaskModuleTask).assigneeIds?.length
    ? (task as TaskModuleTask).assigneeIds!
    : [task.assigneeId];

export const getTaskStartDate = (task: Task): string =>
  (task as TaskModuleTask).startDate || task.createdAt;

export const getTaskPriorityValue = (priority: TaskPriority): TaskModulePriority => priority;

export const toStoredTaskPriority = (priority: TaskModulePriority): TaskPriority => priority;

export const getProjectName = (project: Project): string =>
  (project as CompatibleProject).name || project.title;

export const getProjectEndDate = (project: Project): string =>
  (project as CompatibleProject).endDate || project.targetDate;

export const getProjectMemberIds = (project: Project): string[] =>
  (project as CompatibleProject).members || project.memberIds;

export const getProjectTeamLedBy = (project: Project, userId: string) =>
  project.teams.find((team) => team.leadId === userId);

export const isProjectTeamLead = (project: Project, userId: string): boolean =>
  Boolean(userId) && (project.teams.length > 0
    ? project.teams.some((team) => team.leadId === userId)
    : project.teamLeadId === userId);

export const getTaskTeamId = (task: Task): string | undefined =>
  (task as TaskModuleTask).teamId;

export const getAssignableProjectUsers = (project: Project, users: User[], teamId?: string): User[] => {
  const team = teamId ? project.teams.find((candidate) => candidate.id === teamId) : undefined;
  const memberIds = new Set(team ? team.memberIds : getProjectMemberIds(project));
  // Administrative and HR accounts may belong to a project for oversight, but are not
  // work assignees. Keeping this in the shared selector also protects validation and
  // every task/subtask creation control that consumes it.
  return users.filter((user) =>
    user.status !== 'inactive'
    && memberIds.has(user.id)
    && user.role !== 'Admin'
    && user.role !== 'HR'
  );
};

export const getTaskStatusLabel = (status: TaskStatus): string =>
  status === 'Todo' ? 'To Do' : status;

export const getTodayIsoDate = (): string => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const getLatestDate = (...dates: Array<string | undefined>): string | undefined =>
  dates
    .filter((date): date is string => Boolean(date))
    .reduce<string | undefined>(
      (latest, date) => !latest || date > latest ? date : latest,
      undefined
    );

export const isActiveProject = (project: Project): boolean =>
  project.status === 'Active' && project.approvalStatus === 'Approved';

export const canCreateTaskForProject = (
  role: UserRole,
  userId: string,
  project: Project
): boolean => {
  if (!isActiveProject(project)) {
    return false;
  }

  return role === 'Admin' || (role !== 'HR' && isProjectTeamLead(project, userId));
};

export const canEditTask = (
  role: UserRole,
  userId: string,
  project: Project,
  task: Task
): boolean => {
  if (!isActiveProject(project) || task.isArchived) return false;
  if (role === 'Admin') return true;
  const isTaskTeamLead = role !== 'HR'
    && isProjectTeamLead(project, userId)
    && (!getTaskTeamId(task) || getProjectTeamLedBy(project, userId)?.id === getTaskTeamId(task));
  if (task.parentTaskId) return isTaskTeamLead || getTaskAssigneeIds(task).includes(userId);

  if (Math.max(task.subtaskCount || 0, task.subtasks?.length || 0) > 0) {
    return isTaskTeamLead;
  }
  return getTaskAssigneeIds(task).includes(userId) || isTaskTeamLead;
};

export const canDeleteTask = (
  role: UserRole,
  userId: string,
  project: Project,
  task: Task,
  teamLeadCanDeleteTasks = true
): boolean => {
  if (!teamLeadCanDeleteTasks || !isActiveProject(project) || task.isArchived) return false;
  if (role === 'Admin') return true;
  return role !== 'HR'
    && isProjectTeamLead(project, userId)
    && (!getTaskTeamId(task) || getProjectTeamLedBy(project, userId)?.id === getTaskTeamId(task));
};

export const validateTaskInput = (
  input: TaskFormInput,
  project: Project | undefined,
  users: User[],
  requireActiveProject = true,
  minimumStartDate?: string,
  options: { allowedAssigneeIds?: string[]; allowUnassigned?: boolean } = {}
): Record<string, string> => {
  const errors: Record<string, string> = {};

  if (!input.projectId) errors.projectId = 'Select a project.';
  if (!project && input.projectId) errors.projectId = 'The selected project no longer exists.';
  if (project && requireActiveProject && !isActiveProject(project)) {
    errors.projectId = 'Tasks can only be created in active projects.';
  }

  if (!input.title.trim()) errors.title = 'Enter a task title.';
  if (!input.description.trim()) errors.description = 'Enter a task description.';
  if (!input.priority) errors.priority = 'Select a priority.';
  if (!input.startDate) errors.startDate = 'Select a start date.';
  if (!input.dueDate) errors.dueDate = 'Select a due date.';

  if (input.startDate && input.dueDate && input.dueDate < input.startDate) {
    errors.dueDate = 'Due date cannot be before the start date.';
  }

  if (minimumStartDate && input.startDate && input.startDate < minimumStartDate) {
    errors.startDate = `Start date cannot be before ${minimumStartDate}.`;
  }

  if (project && input.startDate && input.startDate < project.startDate) {
    errors.startDate = `Start date cannot be before ${project.startDate}.`;
  }

  if (project && input.dueDate && input.dueDate > getProjectEndDate(project)) {
    errors.dueDate = `Due date cannot be after ${getProjectEndDate(project)}.`;
  }

  if (input.assigneeIds.length === 0 && !options.allowUnassigned) {
    errors.assigneeIds = 'Select at least one assignee.';
  } else if (new Set(input.assigneeIds).size !== input.assigneeIds.length) {
    errors.assigneeIds = 'Duplicate assignees are not allowed.';
  } else if (project) {
    const validMemberIds = new Set(options.allowedAssigneeIds || getAssignableProjectUsers(project, users).map((user) => user.id));
    if (input.assigneeIds.some((id) => !validMemberIds.has(id))) {
      errors.assigneeIds = 'Every assignee must be an active project member.';
    }
  }

  return errors;
};

// Editing deliberately has no "today" minimum.  Historical tasks must retain their
// recorded dates when an unrelated field changes; the form confirms a changed past date.
export const validateTaskEditInput = (
  input: TaskFormInput,
  project: Project | undefined,
  users: User[],
  options: { allowedAssigneeIds?: string[] } = {}
): Record<string, string> => validateTaskInput(input, project, users, false, undefined, options);

export const filterAndSortTasks = (
  tasks: Task[],
  projects: Project[],
  filters: TaskFilters
): Task[] => {
  const normalizedSearch = filters.search.trim().toLowerCase();

  return tasks
    .filter((task) => {
      const project = projects.find((item) => item.id === task.projectId);
      const matchesSearch = !normalizedSearch
        || task.title.toLowerCase().includes(normalizedSearch);
      const matchesProject = !filters.projectId || task.projectId === filters.projectId;
      const matchesTeam = !filters.teamId || getTaskTeamId(task) === filters.teamId;
      const matchesStatus = !filters.status || task.status === filters.status;
      const matchesPriority = !filters.priority
        || getTaskPriorityValue(task.priority) === filters.priority;
      const matchesAssignee = !filters.assigneeId
        || getTaskAssigneeIds(task).includes(filters.assigneeId);
      const matchesMine = !filters.myTasksOnly
        || getTaskAssigneeIds(task).includes(filters.currentUserId);

      return Boolean(project)
        && matchesSearch
        && matchesProject
        && matchesTeam
        && matchesStatus
        && matchesPriority
        && matchesAssignee
        && matchesMine;
    })
    .sort((left, right) => {
      const comparison = left.dueDate.localeCompare(right.dueDate);
      return filters.dueDateDirection === 'asc' ? comparison : -comparison;
    });
};

export const isTaskOverdue = (task: Task, today: string): boolean =>
  task.status !== 'Done' && task.dueDate < today;
