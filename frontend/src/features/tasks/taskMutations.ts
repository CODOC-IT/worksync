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
  getTaskAssigneeIds,
  getTaskPriorityValue,
  getTaskStartDate,
  TaskFormInput,
  TaskMutationData,
  TaskMutationResult,
  toStoredTaskPriority,
  validateTaskInput
} from './taskRules';

interface TaskMutationContext {
  currentRole: UserRole;
  currentUserId: string;
  projects: Project[];
  tasks: Task[];
  users: User[];
}

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
  const fieldErrors = validateTaskInput(input, project, context.users);

  if (Object.keys(fieldErrors).length > 0) {
    return {
      success: false,
      message: 'Review the highlighted task fields.',
      fieldErrors
    };
  }
  if (
    !project
    || !canCreateTaskForProject(context.currentRole, context.currentUserId, project)
  ) {
    return {
      success: false,
      message: 'You do not have permission to create tasks in this project.'
    };
  }

  const task: Task & { startDate: string; assigneeIds: string[] } = {
    id: `tsk-${now}`,
    taskNumber: `${project.code}-${context.tasks.filter(
      (item) => item.projectId === project.id
    ).length + 1}`,
    projectId: input.projectId,
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
    subtasks: data.subtasks || [],
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
  const task = context.tasks.find((item) => item.id === taskId);
  if (!task) return { success: false, message: 'Task not found.' };

  const project = context.projects.find((item) => item.id === task.projectId);
  if (
    !project
    || !canEditTask(context.currentRole, context.currentUserId, project, task)
  ) {
    return { success: false, message: 'You do not have permission to edit this task.' };
  }

  if (context.currentRole === 'Team_Member') {
    const restrictedFields: Array<keyof TaskMutationData> = [
      'projectId',
      'title',
      'description',
      'priority',
      'startDate',
      'dueDate',
      'assigneeId',
      'assigneeIds'
    ];
    if (restrictedFields.some((field) => data[field] !== undefined)) {
      return {
        success: false,
        message: 'Team Members can only update task status until the protected-change workflow is available.'
      };
    }
  }

  const assigneeIds = data.assigneeIds?.length
    ? data.assigneeIds
    : data.assigneeId
      ? [data.assigneeId]
      : getTaskAssigneeIds(task);
  const { priority, ...otherChanges } = data;
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
  const fieldErrors = validateTaskInput(input, project, context.users, false);

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

  // The mock repository has no Team Lead scope-permission record. Keep delete
  // denied for Team Leads until CanDeleteTasks is returned by the server.
  if (
    !project
    || !canDeleteTask(context.currentRole, context.currentUserId, project, false)
  ) {
    return { success: false, message: 'You do not have permission to delete this task.' };
  }

  return { success: true, message: 'Task deleted.', task };
};
