import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { projectStore } from '../store/projectStore.js';
import {
  StoredTaskPriority,
  StoredTaskStatus,
  taskStore
} from '../store/taskStore.js';
import { userStore } from '../store/userStore.js';

const router = Router();

const TASK_STATUSES = new Set<StoredTaskStatus>([
  'Todo',
  'In Progress',
  'Review',
  'Blocked',
  'Done'
]);
const TASK_PRIORITIES = new Set(['Low', 'Medium', 'High', 'Critical', 'Urgent']);
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const isValidIsoDate = (value: unknown): value is string =>
  typeof value === 'string'
  && ISO_DATE_PATTERN.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));

router.use(authenticateJWT);

// GET /api/tasks?projectId=prj-1
router.get('/', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated.' });
    return;
  }

  const projectId = typeof req.query.projectId === 'string'
    ? req.query.projectId
    : undefined;

  if (
    projectId
    && !projectStore.isProjectAccessible(projectId, req.user.id, req.user.role)
  ) {
    res.status(403).json({
      success: false,
      message: 'Project not found or access denied.'
    });
    return;
  }

  const tasks = taskStore.list().filter((task) => {
    if (projectId && task.projectId !== projectId) return false;
    return projectStore.isProjectAccessible(
      task.projectId,
      req.user!.id,
      req.user!.role
    );
  });

  res.status(200).json({ success: true, data: tasks });
});

// POST /api/tasks
router.post('/', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated.' });
    return;
  }

  const {
    projectId,
    title,
    description,
    priority,
    startDate,
    dueDate,
    assigneeIds,
    status = 'Todo'
  } = req.body || {};
  const fieldErrors: Record<string, string> = {};
  const project = typeof projectId === 'string'
    ? projectStore.getProjectById(projectId)
    : undefined;

  if (!projectId || typeof projectId !== 'string') {
    fieldErrors.projectId = 'Select a project.';
  } else if (!project) {
    fieldErrors.projectId = 'The selected project no longer exists.';
  } else if (project.status !== 'Active') {
    fieldErrors.projectId = 'Tasks can only be created in active projects.';
  }

  if (typeof title !== 'string' || !title.trim()) {
    fieldErrors.title = 'Enter a task title.';
  } else if (title.trim().length > 200) {
    fieldErrors.title = 'Task title cannot exceed 200 characters.';
  }

  if (typeof description !== 'string' || !description.trim()) {
    fieldErrors.description = 'Enter a task description.';
  } else if (description.trim().length > 2000) {
    fieldErrors.description = 'Task description cannot exceed 2000 characters.';
  }

  if (typeof priority !== 'string' || !TASK_PRIORITIES.has(priority)) {
    fieldErrors.priority = 'Select a valid priority.';
  }

  if (!isValidIsoDate(startDate)) {
    fieldErrors.startDate = 'Select a valid start date.';
  }
  if (!isValidIsoDate(dueDate)) {
    fieldErrors.dueDate = 'Select a valid due date.';
  }
  if (isValidIsoDate(startDate) && isValidIsoDate(dueDate) && dueDate < startDate) {
    fieldErrors.dueDate = 'Due date cannot be before the start date.';
  }
  if (project && isValidIsoDate(startDate) && startDate < project.startDate) {
    fieldErrors.startDate = `Start date cannot be before ${project.startDate}.`;
  }
  if (project && isValidIsoDate(dueDate) && dueDate > project.endDate) {
    fieldErrors.dueDate = `Due date cannot be after ${project.endDate}.`;
  }

  if (!Array.isArray(assigneeIds) || assigneeIds.length === 0) {
    fieldErrors.assigneeIds = 'Select at least one assignee.';
  } else if (
    assigneeIds.some((id) => typeof id !== 'string')
    || new Set(assigneeIds).size !== assigneeIds.length
  ) {
    fieldErrors.assigneeIds = 'Assignees must be unique valid users.';
  } else if (project) {
    const invalidAssignee = assigneeIds.some((userId) => {
      const user = userStore.findById(userId);
      return !user
        || user.status !== 'active'
        || (
          !project.memberIds.includes(userId)
          && project.ownerUserId !== userId
        );
    });
    if (invalidAssignee) {
      fieldErrors.assigneeIds = 'Every assignee must be an active project member.';
    }
  }

  if (typeof status !== 'string' || !TASK_STATUSES.has(status as StoredTaskStatus)) {
    fieldErrors.status = 'Select a valid task status.';
  }

  if (Object.keys(fieldErrors).length > 0) {
    res.status(400).json({
      success: false,
      message: 'Review the highlighted task fields.',
      fieldErrors
    });
    return;
  }

  const canCreate = req.user.role === 'Admin'
    || (
      req.user.role === 'Team_Lead'
      && projectStore.isProjectAccessible(projectId, req.user.id, req.user.role)
    );
  if (!canCreate) {
    res.status(403).json({
      success: false,
      message: 'You do not have permission to create tasks in this project.'
    });
    return;
  }

  const normalizedPriority: StoredTaskPriority =
    priority === 'Critical' ? 'Urgent' : priority as StoredTaskPriority;
  const task = taskStore.create({
    projectId,
    projectCode: project!.code,
    title: title.trim(),
    description: description.trim(),
    priority: normalizedPriority,
    startDate,
    dueDate,
    assigneeIds,
    status: status as StoredTaskStatus,
    creatorId: req.user.id
  });

  res.status(201).json({
    success: true,
    message: 'Task created successfully.',
    data: task
  });
});

export default router;
