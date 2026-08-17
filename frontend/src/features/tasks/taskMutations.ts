import {
  Project,
  Task,
  User,
  UserRole
} from '../../types';
import {
  canCreateTaskForProject,
  canDeleteTask,
  canEditTask,
  getProjectTeamLedBy,
  getTaskTeamId,
  getAssignableProjectUsers,
  isProjectTeamLead,
  getTaskAssigneeIds,
  getTaskPriorityValue,
  getTaskStartDate,
  TaskFormInput,
  TaskMutationData,
  TaskMutationResult,
  toStoredTaskPriority,
  validateTaskInput,
  validateTaskEditInput
} from './taskRules';

interface TaskMutationContext {
  currentRole: UserRole;
  currentUserId: string;
  projects: Project[];
  tasks: Task[];
  users: User[];
}

const findTaskForMutation = (tasks: Task[], taskId: string): (Task & Partial<{ startDate: string }>) | undefined => {
  const directTask = tasks.find((task) => task.id === taskId);
  if (directTask) return directTask;

  const parent = tasks.find((task) => task.subtasks.some((subtask) => subtask.id === taskId));
  const subtask = parent?.subtasks.find((item) => item.id === taskId);
  if (!parent || !subtask) return undefined;

  return {
    ...parent,
    ...subtask,
    id: subtask.id,
    parentTaskId: parent.id,
    title: subtask.title,
    description: subtask.description || '',
    status: subtask.status || (subtask.completed ? 'Done' : 'Todo'),
    priority: subtask.priority || parent.priority,
    assigneeId: subtask.assigneeIds?.[0] || '',
    assigneeIds: subtask.assigneeIds || [],
    startDate: subtask.startDate || getTaskStartDate(parent),
    dueDate: subtask.dueDate || parent.dueDate,
    subtasks: [],
    subtaskCount: 0
  };
};

export const toTaskFormInput = (data: TaskMutationData): TaskFormInput => {
  const assigneeIds = data.assigneeIds?.length
    ? data.assigneeIds
    : data.assigneeId
      ? [data.assigneeId]
      : [];

  return {
    projectId: data.projectId || '',
    title: data.title || '',
    description: data.description || '',
    priority: data.priority || '',
    startDate: data.startDate || '',
    dueDate: data.dueDate || '',
    teamId: data.teamId,
    assigneeIds,
    status: data.status || 'Todo'
  };
};

export const prepareTaskCreation = (
  data: TaskMutationData,
  context: TaskMutationContext,
  now = Date.now()
): TaskMutationResult => {
  const input = toTaskFormInput(data);
  const project = context.projects.find((item) => item.id === input.projectId);
  const leadTeam = project ? getProjectTeamLedBy(project, context.currentUserId) : undefined;
  const isAdminTeamHandoff = context.currentRole === 'Admin' && Boolean(input.teamId);
  const fieldErrors = validateTaskInput(input, project, context.users, true, undefined, {
    allowUnassigned: isAdminTeamHandoff,
    allowedAssigneeIds: leadTeam
      ? getAssignableProjectUsers(project!, context.users, leadTeam.id).map((user) => user.id)
      : undefined
  });

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      message: 'Review the highlighted task fields.',
      fieldErrors
    };
  }
  if (!project || !canCreateTaskForProject(context.currentRole, context.currentUserId, project)) {
    return {
      success: false,
      message: 'You do not have permission to create tasks in this project.'
    };
  }
  if (context.currentRole === 'Admin' && project.teams.length === 0) {
    return { success: false, message: 'This project must have a team before an Admin can create a task.', fieldErrors: { teamId: 'No project teams are available.' } };
  }
  if (context.currentRole === 'Admin' && !input.teamId) {
    return { success: false, message: 'Select a team for this task.', fieldErrors: { teamId: 'Select a team.' } };
  }

  const localId = Math.floor(Math.random() * 900000) + 100000;
  const task: Task & { startDate: string; assigneeIds: string[] } = {
    id: `tsk-${localId}`,
    taskNumber: `${project.code}-${context.tasks.filter(
      (item) => item.projectId === project.id
    ).length + 1}`,
    projectId: input.projectId,
    teamId: input.teamId || leadTeam?.id,
    title: input.title.trim(),
    description: input.description.trim(),
    status: input.status,
    priority: toStoredTaskPriority(input.priority || 'Medium'),
    startDate: input.startDate,
    dueDate: input.dueDate,
    assigneeId: input.assigneeIds[0],
    assigneeIds: input.assigneeIds,
    creatorId: context.currentUserId,
    estimatedHours: data.estimatedHours || 8,
    subtasks: [],
    dependencies: data.dependencies || [],
    tags: data.tags || ['Task'],
    attachments: [],
    approvalStatus: 'Approved',
    createdAt: new Date(now).toISOString().split('T')[0]
  };

  return {
    success: true,
    message: 'Task created successfully.',
    task
  };
};

export const prepareTaskUpdate = (
  taskId: string,
  data: TaskMutationData,
  context: TaskMutationContext
): TaskMutationResult => {
  const task = findTaskForMutation(context.tasks, taskId);
  if (!task) return { success: false, message: 'Task not found.' };

  const project = context.projects.find((item) => item.id === task.projectId);
  if (
    !project
    || !canEditTask(context.currentRole, context.currentUserId, project, task)
  ) {
    return { success: false, message: 'You do not have permission to edit this task.' };
  }

  const isTaskTeamLead = context.currentRole !== 'HR'
    && isProjectTeamLead(project, context.currentUserId)
    && (!getTaskTeamId(task) || getProjectTeamLedBy(project, context.currentUserId)?.id === getTaskTeamId(task));
  if ((data.assigneeId !== undefined || data.assigneeIds !== undefined) && !isTaskTeamLead) {
    return {
      success: false,
      message: 'Only this project\'s Team Lead can change task assignments.'
    };
  }

  const assigneeIds = data.assigneeIds?.length
    ? data.assigneeIds
    : data.assigneeId
      ? [data.assigneeId]
      : getTaskAssigneeIds(task);
  const { priority, subtasks: _subtasks, ...otherChanges } = data;
  const updatedTask: Task & Partial<{ startDate: string; assigneeIds: string[] }> = {
    ...task,
    ...otherChanges,
    priority: priority ? toStoredTaskPriority(priority) : task.priority,
    title: (data.title ?? task.title).trim(),
    description: (data.description ?? task.description).trim(),
    assigneeId: assigneeIds[0],
    assigneeIds
  };
  const input: TaskFormInput = {
    projectId: updatedTask.projectId,
    title: updatedTask.title,
    description: updatedTask.description,
    priority: getTaskPriorityValue(updatedTask.priority),
    startDate: getTaskStartDate(updatedTask),
    dueDate: updatedTask.dueDate,
    assigneeIds,
    status: updatedTask.status
  };
  const taskTeamId = getTaskTeamId(task) || getProjectTeamLedBy(project, context.currentUserId)?.id;
  const fieldErrors = validateTaskEditInput(input, project, context.users, {
    allowedAssigneeIds: getAssignableProjectUsers(project, context.users, taskTeamId).map((user) => user.id)
  });

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      message: 'Review the highlighted task fields.',
      fieldErrors
    };
  }

  return {
    success: true,
    message: 'Task updated successfully.',
    task: updatedTask
  };
};

export const prepareTaskDeletion = (
  taskId: string,
  context: TaskMutationContext
): TaskMutationResult => {
  const task = context.tasks.find((item) => item.id === taskId);
  if (!task) return { success: false, message: 'Task not found.' };

  const project = context.projects.find((item) => item.id === task.projectId);

  if (
    !project
    || !canDeleteTask(context.currentRole, context.currentUserId, project, task)
  ) {
    return { success: false, message: 'You do not have permission to delete this task.' };
  }

  return { success: true, message: 'Task deleted.', task };
};
