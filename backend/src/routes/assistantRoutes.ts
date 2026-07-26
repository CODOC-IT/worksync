import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { projectStore } from '../store/projectStore.js';
import { promptStore } from '../store/promptStore.js';
import { userStore } from '../store/userStore.js';
import { generatePrompt } from '../services/aiService.js';
import * as notificationService from '../notifications/notification.service.js';

const router = Router();

// All routes require authentication
router.use(authenticateJWT);

// GET /api/assistant/projects — authorized projects for current user
router.get('/projects', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  const projects = projectStore.getProjectsForUser(req.user.id, req.user.role);
  const safe = projects.map((p) => ({
    id: p.id,
    code: p.code,
    title: p.title,
    description: p.description,
    status: p.status,
    priority: p.priority,
    startDate: p.startDate,
    endDate: p.endDate,
    milestoneCount: p.milestones.length,
  }));

  res.json({ success: true, data: safe });
});

// GET /api/assistant/projects/:projectId/tasks — authorized tasks
router.get('/projects/:projectId/tasks', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  const { projectId } = req.params;

  if (!projectStore.isProjectAccessible(projectId, req.user.id, req.user.role)) {
    res.status(403).json({ success: false, message: 'Project not found or access denied.' });
    return;
  }

  const tasks = projectStore.getTasksForProject(projectId, req.user.id, req.user.role);
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
});

// GET /api/assistant/categories — available prompt categories
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

// POST /api/assistant/generate — generate a prompt using AI
router.post('/generate', async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  try {
    const { projectId, taskId, category, additionalInstructions, style, projectName: clientProjectName, projectDescription: clientProjectDesc, taskTitle: clientTaskTitle, taskDescription: clientTaskDesc } = req.body;

    if (!projectId || !category) {
      res.status(400).json({ success: false, message: 'Project ID and category are required.' });
      return;
    }

    if (!projectStore.isProjectAccessible(projectId, req.user.id, req.user.role)) {
      res.status(403).json({ success: false, message: 'Project not found or access denied.' });
      return;
    }

    const project = projectStore.getProjectById(projectId)!;

    let task = null;
    if (taskId) {
      if (!projectStore.isTaskAccessible(taskId, req.user.id, req.user.role)) {
        res.status(403).json({ success: false, message: 'Task not found or access denied.' });
        return;
      }
      task = projectStore.getTaskById(taskId)!;
    }

    const allTasks = projectStore.getTasksForProject(projectId, req.user.id, req.user.role);
    const projectTasksStr = allTasks
      .map((t) => `- ${t.taskNumber} [${t.status}] ${t.title}${t.assigneeId ? ' (Assignee: ' + (userStore.findById(t.assigneeId)?.name || 'Unknown') + ')' : ''}${t.dueDate ? ' Due: ' + t.dueDate : ''}`)
      .join('\n');

    const memberNames = project.memberIds
      .map((uid) => userStore.findById(uid)?.name)
      .filter(Boolean)
      .join(', ');

    const context = {
      projectName: clientProjectName || project.title,
      projectDescription: clientProjectDesc || project.description,
      projectStatus: project.status,
      projectPriority: project.priority,
      taskTitle: clientTaskTitle || task?.title,
      taskDescription: clientTaskDesc || task?.description,
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
              const dep = projectStore.getTaskById(depId);
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
    res.status(500).json({
      success: false,
      message: error?.message || 'Failed to generate prompt.',
    });
  }
});

// POST /api/assistant/prompts — save a generated prompt
router.post('/prompts', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  try {
    const { projectId, taskId, category, title, style, additionalInstructions, content, isAiGenerated } = req.body;

    if (!category || !title || !content) {
      res.status(400).json({ success: false, message: 'Category, title, and content are required.' });
      return;
    }

    // Validate project access if projectId provided
    if (projectId && !projectStore.isProjectAccessible(projectId, req.user.id, req.user.role)) {
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

    // Minimal integration hook (per the notification backend spec — this module is not being
    // redesigned): the AI Assistant has no team-visibility concept of its own, saved prompts are
    // private to their author (see promptStore.getPromptsForUser above), so this is a
    // self-notification confirming generation completed, the same "confirm to the actor" pattern
    // already used by the frontend's confirmActionSuccess for other modules. ProjectBreakdown is
    // the one category that produces an actual task breakdown; every other category maps to the
    // generic "recommendation available" type. The other AI type codes seeded in
    // database/18_notify_seed.sql (sprint/meeting/deadline/overdue) have no producing feature in
    // this codebase yet — they stay reserved for when those AI features are built, per "minimal
    // hook, no new subsystems."
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

// GET /api/assistant/prompts — list saved prompts for current user
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

// GET /api/assistant/prompts/:id — get prompt with versions
router.get('/prompts/:id', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  const prompt = promptStore.getPromptById(req.params.id);
  if (!prompt || prompt.userId !== req.user.id) {
    res.status(404).json({ success: false, message: 'Prompt not found.' });
    return;
  }

  res.json({ success: true, data: prompt });
});

// PUT /api/assistant/prompts/:id — update prompt content (creates new version)
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

// GET /api/assistant/prompts/:id/versions — get version history
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

// POST /api/assistant/prompts/:id/restore/:versionId — restore a previous version
router.post('/prompts/:id/restore/:versionId', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  const updated = promptStore.restoreVersion(req.params.id, req.params.versionId, req.user.id);
  if (!updated) {
    res.status(404).json({ success: false, message: 'Prompt or version not found, or access denied.' });
    return;
  }

  res.json({ success: true, data: updated });
});

// DELETE /api/assistant/prompts/:id — archive a prompt (soft delete)
router.delete('/prompts/:id', (req: AuthenticatedRequest, res: Response): void => {
  if (!req.user) { res.status(401).json({ success: false, message: 'Not authenticated.' }); return; }

  const archived = promptStore.archivePrompt(req.params.id, req.user.id);
  if (!archived) {
    res.status(404).json({ success: false, message: 'Prompt not found or access denied.' });
    return;
  }

  res.json({ success: true, message: 'Prompt archived.' });
});

// PATCH /api/assistant/prompts/:id/unarchive
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
