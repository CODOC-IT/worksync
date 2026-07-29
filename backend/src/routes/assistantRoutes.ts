import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { promptStore } from '../store/promptStore.js';
import { userStore } from '../store/userStore.js';
import { discussionStore } from '../store/discussionStore.js';
import { generatePrompt } from '../services/aiService.js';
import * as notificationService from '../notifications/notification.service.js';
import * as projectService from '../projects/project.service.js';
import * as taskService from '../tasks/task.service.js';

const router = Router();

router.use(authenticateJWT);

router.get('/projects', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  try {
    const projects = await projectService.listProjectsForUser(req.user.id, req.user.role);
    const safe = projects.map((p) => ({
      id: p.id,
      code: p.code,
      title: p.title,
      description: p.description,
      status: p.status,
      priority: p.priority,
      startDate: p.startDate,
      endDate: p.targetDate,
      milestoneCount: p.milestones.length,
    }));

    res.json({ success: true, data: safe });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to load projects.' });
  }
});

router.get('/projects/:projectId/tasks', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  try {
    const { projectId } = req.params;
    const tasks = await taskService.listTasksForUser(req.user.id, req.user.role, projectId);
    const safe = tasks.map((t) => ({
      id: t.id,
      taskNumber: t.taskNumber,
      title: t.title,
      description: t.description,
      status: t.status,
      priority: t.priority,
      assigneeId: t.assigneeId,
      dueDate: t.dueDate,
      dependencies: t.dependencies,
    }));

    res.json({ success: true, data: safe });
  } catch (error: any) {
    if (error instanceof projectService.ProjectAuthorizationError) {
      res.status(403).json({ success: false, message: 'Project not found or access denied.' });
      return;
    }
    res.status(500).json({ success: false, message: error.message || 'Failed to load tasks.' });
  }
});

router.get('/categories', (_req: AuthenticatedRequest, res: Response): void => {
  const categories = [
    { code: 'ProjectOverview', name: 'Project Overview', requiresProject: true, requiresTask: false },
    { code: 'ProjectBreakdown', name: 'Project Breakdown', requiresProject: true, requiresTask: false },
    { code: 'TaskDescription', name: 'Task Description', requiresProject: true, requiresTask: true },
    { code: 'AcceptanceCriteria', name: 'Acceptance Criteria', requiresProject: true, requiresTask: true },
    { code: 'CodeReview', name: 'Code Review', requiresProject: true, requiresTask: true },
    { code: 'TestCases', name: 'Test Cases', requiresProject: true, requiresTask: true },
    { code: 'Documentation', name: 'Documentation', requiresProject: true, requiresTask: false },
  ];
  res.json({ success: true, data: categories });
});

router.post('/generate', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  try {
    const { projectId, taskId, category, additionalInstructions, style } = req.body;

    if (!projectId || !category) {
      res.status(400).json({ success: false, message: 'Project ID and category are required.' });
      return;
    }

    if (!(await projectService.isProjectAccessible(projectId, req.user.id, req.user.role))) {
      res.status(403).json({ success: false, message: 'Project not found or access denied.' });
      return;
    }

    const project = await projectService.getProjectForUser(projectId, req.user.id, req.user.role);

    let task = null;
    if (taskId) {
      try {
        task = await taskService.getTaskForUser(taskId, req.user.id, req.user.role);
      } catch {
        res.status(403).json({ success: false, message: 'Task not found or access denied.' });
        return;
      }
    }

    const allTasks = await taskService.listTasksForUser(req.user.id, req.user.role, projectId);
    const allDiscussions = discussionStore.list().filter((d) => d.projectId === projectId);

    const taskById = new Map(allTasks.map((t) => [t.id, t]));

    const projectTasksStr = allTasks
      .map((t) => {
        const depNames = t.dependencies
          .map((depId) => taskById.get(depId)?.taskNumber)
          .filter(Boolean)
          .join(', ');

        const taskDiscussions = allDiscussions.filter((d) => d.taskId === t.id);
        const discussionsStr = taskDiscussions.length
          ? '\n  Discussions:\n' + taskDiscussions.map((d) => {
              const comments = discussionStore.comments(d.id);
              const latestComment = comments.length ? comments[comments.length - 1] : null;
              const authorName = latestComment ? userStore.findById(latestComment.authorId)?.name || 'Unknown' : '';
              return `    - [${d.type}] "${d.title}"${d.resolved ? ' (Resolved)' : ''}${latestComment ? ` — Latest by ${authorName}: "${latestComment.body.slice(0, 150)}${latestComment.body.length > 150 ? '...' : ''}"` : ''}`;
            }).join('\n')
          : '';

        return `- ${t.taskNumber} [${t.status}] ${t.title}
  Description: ${t.description}
  Priority: ${t.priority} | Assignee: ${userStore.findById(t.assigneeId)?.name || 'Unassigned'} | Due: ${t.dueDate || 'No due date'}
  Dependencies: ${depNames || 'None'}${discussionsStr}`;
      })
      .join('\n\n---\n\n');

    const memberNames = project.memberIds
      .map((uid) => userStore.findById(uid)?.name)
      .filter(Boolean)
      .join(', ');

    const context = {
      projectName: project.title,
      projectDescription: project.description,
      projectStatus: project.status,
      projectPriority: project.priority,
      taskTitle: task?.title,
      taskDescription: task?.description,
      taskStatus: task?.status,
      taskPriority: task?.priority,
      taskDeadline: task?.dueDate,
      taskAssignees: task ? userStore.findById(task.assigneeId)?.name : undefined,
      milestones: project.milestones
        .map((m) => `- ${m.title} (${m.completed ? 'Completed' : 'Due: ' + m.dueDate})`)
        .join('\n'),
      dependencies: task?.dependencies?.length
        ? task.dependencies
            .map((depId) => {
              const dep = taskById.get(depId);
              return dep ? `- ${dep.taskNumber}: ${dep.title}` : null;
            })
            .filter(Boolean)
            .join('\n')
        : undefined,
      projectTasks: projectTasksStr || undefined,
      projectMembers: memberNames || undefined,
    };

    const promptText = await generatePrompt({
      category,
      context,
      additionalInstructions: additionalInstructions || undefined,
      style: style || 'Default',
    });

    res.json({
      success: true,
      data: {
        promptText,
        contextSnapshot: context,
      },
    });
  } catch (error: any) {
    if (error instanceof projectService.ProjectAuthorizationError || error instanceof projectService.ProjectNotFoundError) {
      res.status(403).json({ success: false, message: 'Project not found or access denied.' });
      return;
    }
    res.status(500).json({
      success: false,
      message: error?.message || 'Failed to generate prompt.',
    });
  }
});

router.post('/prompts', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  try {
    const { projectId, taskId, category, title, style, additionalInstructions, content, isAiGenerated } = req.body;

    if (!category || !title || !content) {
      res.status(400).json({ success: false, message: 'Category, title, and content are required.' });
      return;
    }

    if (projectId && !(await projectService.isProjectAccessible(projectId, req.user.id, req.user.role))) {
      res.status(403).json({ success: false, message: 'Project not found or access denied.' });
      return;
    }

    const prompt = promptStore.createPrompt({
      userId: req.user.id,
      projectId: projectId || null,
      taskId: taskId || null,
      category,
      title,
      style: style || 'Default',
      additionalInstructions: additionalInstructions || null,
      content,
      isAiGenerated: isAiGenerated !== false,
    });

    const latestVersion = prompt.versions[prompt.versions.length - 1];
    if (latestVersion?.isAiGenerated && req.user) {
      notificationService
        .publishEvent({
          type: category === 'ProjectBreakdown' ? 'ai_tasks_generated' : 'ai_recommendation_available',
          title: category === 'ProjectBreakdown' ? 'AI task breakdown generated' : 'AI content generated',
          message: `Your AI-generated "${title}" is ready to review.`,
          recipientIds: [req.user.id],
          actorId: req.user.id,
          projectId: projectId || undefined,
          taskId: taskId || undefined
        })
        .catch((error) => console.error('[assistantRoutes] Failed to publish AI notification event:', error));
    }

    res.status(201).json({ success: true, data: prompt });
  } catch (error: any) {
    res.status(500).json({ success: false, message: error.message || 'Failed to save prompt.' });
  }
});

// All remaining routes (GET/PUT/DELETE prompts) are unchanged since they use promptStore directly

router.get('/prompts', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  const includeArchived = req.query.includeArchived === 'true';
  const category = req.query.category as string | undefined;
  const search = (req.query.search as string || '').toLowerCase();

  let prompts = promptStore.getPromptsForUser(req.user.id, includeArchived);

  if (category) {
    prompts = prompts.filter((p) => p.category === category);
  }

  if (search) {
    prompts = prompts.filter(
      (p) =>
        p.title.toLowerCase().includes(search) ||
        p.versions[p.versions.length - 1]?.content.toLowerCase().includes(search)
    );
  }

  const safe = prompts.map((p) => ({
    id: p.id,
    title: p.title,
    category: p.category,
    style: p.style,
    isArchived: p.isArchived,
    versionCount: p.versions.length,
    latestContent: p.versions[p.versions.length - 1]?.content.substring(0, 200) || '',
    createdAtUtc: p.createdAtUtc,
    updatedAtUtc: p.updatedAtUtc,
  }));

  res.json({ success: true, data: safe });
});

router.get('/prompts/:id', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  const prompt = promptStore.getPromptById(req.params.id);
  if (!prompt || prompt.userId !== req.user.id) {
    res.status(404).json({ success: false, message: 'Prompt not found.' });
    return;
  }

  res.json({ success: true, data: prompt });
});

router.put('/prompts/:id', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  const { content, title } = req.body;
  if (!content) {
    res.status(400).json({ success: false, message: 'Content is required.' });
    return;
  }

  const updated = promptStore.updatePrompt(req.params.id, req.user.id, { content, title });
  if (!updated) {
    res.status(404).json({ success: false, message: 'Prompt not found or access denied.' });
    return;
  }

  res.json({ success: true, data: updated });
});

router.get('/prompts/:id/versions', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  const prompt = promptStore.getPromptById(req.params.id);
  if (!prompt || prompt.userId !== req.user.id) {
    res.status(404).json({ success: false, message: 'Prompt not found.' });
    return;
  }

  const safe = prompt.versions.map((v) => ({
    versionId: v.versionId,
    versionNumber: v.versionNumber,
    content: v.content,
    isAiGenerated: v.isAiGenerated,
    createdByUserId: v.createdByUserId,
    createdByName: userStore.findById(v.createdByUserId)?.name || 'Unknown',
    createdAtUtc: v.createdAtUtc,
  }));

  res.json({ success: true, data: safe });
});

router.post('/prompts/:id/restore/:versionId', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  const updated = promptStore.restoreVersion(req.params.id, req.params.versionId, req.user.id);
  if (!updated) {
    res.status(404).json({ success: false, message: 'Prompt or version not found, or access denied.' });
    return;
  }

  res.json({ success: true, data: updated });
});

router.delete('/prompts/:id', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  const archived = promptStore.archivePrompt(req.params.id, req.user.id);
  if (!archived) {
    res.status(404).json({ success: false, message: 'Prompt not found or access denied.' });
    return;
  }

  res.json({ success: true, message: 'Prompt archived.' });
});

router.patch('/prompts/:id/unarchive', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  const unarchived = promptStore.unarchivePrompt(req.params.id, req.user.id);
  if (!unarchived) {
    res.status(404).json({ success: false, message: 'Prompt not found or access denied.' });
    return;
  }

  res.json({ success: true, message: 'Prompt restored from archive.' });
});

export default router;
