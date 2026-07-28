```typescript
import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { projectStore } from '../store/projectStore.js';
import { promptStore } from '../store/promptStore.js';
import { userStore } from '../store/userStore.js';
import { discussionStore } from '../store/discussionStore.js';
import { generatePrompt } from '../services/aiService.js';
import * as notificationService from '../notifications/notification.service.js';

const router = Router();

// All routes require authentication
router.use(authenticateJWT);

/**
 * GET /api/assistant/projects
 * Returns projects accessible to the current user.
 */
router.get(
  '/projects',
  (req: AuthenticatedRequest, res: Response): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated.',
      });
      return;
    }

    try {
      const projects = projectStore.getProjectsForUser(
        req.user.id,
        req.user.role
      );

      const safe = projects.map((project) => ({
        id: project.id,
        code: project.code,
        title: project.title,
        description: project.description,
        status: project.status,
        priority: project.priority,
        ownerUserId: project.ownerUserId,
        memberIds: project.memberIds,
        startDate: project.startDate,
        endDate: project.endDate,
        milestoneCount: project.milestones.length,
        milestones: project.milestones,
      }));

      res.json({
        success: true,
        data: safe,
      });
    } catch (error: any) {
      console.error('[assistantRoutes] Failed to load projects:', error);

      res.status(500).json({
        success: false,
        message: error?.message || 'Failed to load projects.',
      });
    }
  }
);

/**
 * GET /api/assistant/projects/:projectId/tasks
 * Returns tasks belonging to an accessible project.
 */
router.get(
  '/projects/:projectId/tasks',
  (req: AuthenticatedRequest, res: Response): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated.',
      });
      return;
    }

    try {
      const { projectId } = req.params;

      if (
        !projectStore.isProjectAccessible(
          projectId,
          req.user.id,
          req.user.role
        )
      ) {
        res.status(403).json({
          success: false,
          message: 'Project not found or access denied.',
        });
        return;
      }

      const tasks = projectStore.getTasksForProject(
        projectId,
        req.user.id,
        req.user.role
      );

      const safe = tasks.map((task) => ({
        id: task.id,
        projectId: task.projectId,
        taskNumber: task.taskNumber,
        title: task.title,
        description: task.description,
        status: task.status,
        priority: task.priority,
        assigneeId: task.assigneeId,
        dueDate: task.dueDate,
        dependencies: task.dependencies,
      }));

      res.json({
        success: true,
        data: safe,
      });
    } catch (error: any) {
      console.error('[assistantRoutes] Failed to load project tasks:', error);

      res.status(500).json({
        success: false,
        message: error?.message || 'Failed to load project tasks.',
      });
    }
  }
);

/**
 * GET /api/assistant/categories
 * Returns available AI prompt categories.
 */
router.get(
  '/categories',
  (_req: AuthenticatedRequest, res: Response): void => {
    const categories = [
      {
        code: 'ProjectOverview',
        name: 'Project Overview',
        requiresProject: true,
        requiresTask: false,
      },
      {
        code: 'ProjectBreakdown',
        name: 'Project Breakdown',
        requiresProject: true,
        requiresTask: false,
      },
      {
        code: 'TaskDescription',
        name: 'Task Description',
        requiresProject: true,
        requiresTask: true,
      },
      {
        code: 'AcceptanceCriteria',
        name: 'Acceptance Criteria',
        requiresProject: true,
        requiresTask: true,
      },
      {
        code: 'CodeReview',
        name: 'Code Review',
        requiresProject: true,
        requiresTask: true,
      },
      {
        code: 'TestCases',
        name: 'Test Cases',
        requiresProject: true,
        requiresTask: true,
      },
      {
        code: 'Documentation',
        name: 'Documentation',
        requiresProject: true,
        requiresTask: false,
      },
    ];

    res.json({
      success: true,
      data: categories,
    });
  }
);

/**
 * POST /api/assistant/generate
 * Generates AI content using selected project/task context.
 */
router.post(
  '/generate',
  async (
    req: AuthenticatedRequest,
    res: Response
  ): Promise<void> => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated.',
      });
      return;
    }

    try {
      const {
        projectId,
        taskId,
        category,
        additionalInstructions,
        style,
        projectName: clientProjectName,
        projectDescription: clientProjectDesc,
        taskTitle: clientTaskTitle,
        taskDescription: clientTaskDesc,
      } = req.body;

      if (!projectId || !category) {
        res.status(400).json({
          success: false,
          message: 'Project ID and category are required.',
        });
        return;
      }

      // Check project access
      if (
        !projectStore.isProjectAccessible(
          projectId,
          req.user.id,
          req.user.role
        )
      ) {
        res.status(403).json({
          success: false,
          message: 'Project not found or access denied.',
        });
        return;
      }

      const project = projectStore.getProjectById(projectId);

      if (!project) {
        res.status(404).json({
          success: false,
          message: 'Project not found.',
        });
        return;
      }

      // Load selected task if provided
      let task = null;

      if (taskId) {
        if (
          !projectStore.isTaskAccessible(
            taskId,
            req.user.id,
            req.user.role
          )
        ) {
          res.status(403).json({
            success: false,
            message: 'Task not found or access denied.',
          });
          return;
        }

        task = projectStore.getTaskById(taskId);

        if (!task) {
          res.status(404).json({
            success: false,
            message: 'Task not found.',
          });
          return;
        }

        // Make sure the selected task actually belongs to the selected project
        if (task.projectId !== projectId) {
          res.status(400).json({
            success: false,
            message: 'Selected task does not belong to the selected project.',
          });
          return;
        }
      }

      // Get all accessible tasks for the project
      const allTasks = projectStore.getTasksForProject(
        projectId,
        req.user.id,
        req.user.role
      );

      // Get project discussions
      const allDiscussions = discussionStore
        .list()
        .filter((discussion) => discussion.projectId === projectId);

      /**
       * Build a detailed task context for the AI.
       */
      const projectTasksStr = allTasks
        .map((currentTask) => {
          const dependencyNames = currentTask.dependencies
            .map((dependencyId) =>
              projectStore.getTaskById(dependencyId)?.taskNumber
            )
            .filter(Boolean)
            .join(', ');

          const taskDiscussions = allDiscussions.filter(
            (discussion) => discussion.taskId === currentTask.id
          );

          const discussionsStr = taskDiscussions.length
            ? '\n  Discussions:\n' +
              taskDiscussions
                .map((discussion) => {
                  const comments = discussionStore.comments(
                    discussion.id
                  );

                  const latestComment =
                    comments.length > 0
                      ? comments[comments.length - 1]
                      : null;

                  const authorName = latestComment
                    ? userStore.findById(latestComment.authorId)?.name ||
                      'Unknown'
                    : '';

                  const latestCommentText = latestComment
                    ? latestComment.body.length > 150
                      ? `${latestComment.body.slice(0, 150)}...`
                      : latestComment.body
                    : '';

                  return (
                    `    - [${discussion.type}] "${discussion.title}"` +
                    `${discussion.resolved ? ' (Resolved)' : ''}` +
                    `${
                      latestComment
                        ? ` — Latest by ${authorName}: "${latestCommentText}"`
                        : ''
                    }`
                  );
                })
                .join('\n')
            : '';

          const assigneeName =
            userStore.findById(currentTask.assigneeId)?.name ||
            'Unassigned';

          return `- ${currentTask.taskNumber} [${currentTask.status}] ${currentTask.title}
  Description: ${currentTask.description}
  Priority: ${currentTask.priority} | Assignee: ${assigneeName} | Due: ${
            currentTask.dueDate || 'No due date'
          }
  Dependencies: ${
            dependencyNames || 'None'
          }${discussionsStr}`;
        })
        .join('\n\n---\n\n');

      /**
       * Resolve project member names.
       */
      const memberNames = project.memberIds
        .map((userId) => userStore.findById(userId)?.name)
        .filter(Boolean)
        .join(', ');

      /**
       * Build structured context passed to the AI service.
       */
      const context = {
        projectName:
          clientProjectName || project.title,

        projectDescription:
          clientProjectDesc || project.description,

        projectStatus:
          project.status,

        projectPriority:
          project.priority,

        taskTitle:
          clientTaskTitle || task?.title,

        taskDescription:
          clientTaskDesc || task?.description,

        taskStatus:
          task?.status,

        taskPriority:
          task?.priority,

        taskDeadline:
          task?.dueDate,

        taskAssignees:
          task
            ? userStore.findById(task.assigneeId)?.name
            : undefined,

        milestones:
          project.milestones
            .map(
              (milestone) =>
                `- ${milestone.title} (${
                  milestone.completed
                    ? 'Completed'
                    : `Due: ${milestone.dueDate}`
                })`
            )
            .join('\n'),

        dependencies:
          task?.dependencies?.length
            ? task.dependencies
                .map((dependencyId) => {
                  const dependency =
                    projectStore.getTaskById(dependencyId);

                  return dependency
                    ? `- ${dependency.taskNumber}: ${dependency.title}`
                    : null;
                })
                .filter(Boolean)
                .join('\n')
            : undefined,

        projectTasks:
          projectTasksStr || undefined,

        projectMembers:
          memberNames || undefined,
      };

      /**
       * Generate AI prompt.
       */
      const promptText = await generatePrompt({
        category,
        context,
        additionalInstructions:
          additionalInstructions || undefined,
        style:
          style || 'Default',
      });

      res.json({
        success: true,
        data: {
          promptText,
          contextSnapshot: context,
        },
      });
    } catch (error: any) {
      console.error(
        '[assistantRoutes] Failed to generate prompt:',
        error
      );

      res.status(500).json({
        success: false,
        message:
          error?.message ||
          'Failed to generate prompt.',
      });
    }
  }
);

/**
 * POST /api/assistant/prompts
 * Save a generated prompt.
 */
router.post(
  '/prompts',
  (req: AuthenticatedRequest, res: Response): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated.',
      });
      return;
    }

    try {
      const {
        projectId,
        taskId,
        category,
        title,
        style,
        additionalInstructions,
        content,
        isAiGenerated,
      } = req.body;

      if (!category || !title || !content) {
        res.status(400).json({
          success: false,
          message:
            'Category, title, and content are required.',
        });
        return;
      }

      // Validate project access
      if (
        projectId &&
        !projectStore.isProjectAccessible(
          projectId,
          req.user.id,
          req.user.role
        )
      ) {
        res.status(403).json({
          success: false,
          message: 'Project not found or access denied.',
        });
        return;
      }

      // Validate task access
      if (
        taskId &&
        !projectStore.isTaskAccessible(
          taskId,
          req.user.id,
          req.user.role
        )
      ) {
        res.status(403).json({
          success: false,
          message: 'Task not found or access denied.',
        });
        return;
      }

      // Validate task belongs to project
      if (projectId && taskId) {
        const task = projectStore.getTaskById(taskId);

        if (!task || task.projectId !== projectId) {
          res.status(400).json({
            success: false,
            message:
              'Selected task does not belong to the selected project.',
          });
          return;
        }
      }

      const prompt = promptStore.createPrompt({
        userId: req.user.id,
        projectId: projectId || null,
        taskId: taskId || null,
        category,
        title,
        style: style || 'Default',
        additionalInstructions:
          additionalInstructions || null,
        content,
        isAiGenerated:
          isAiGenerated !== false,
      });

      /**
       * Publish notification for AI-generated content.
       */
      const latestVersion =
        prompt.versions[
          prompt.versions.length - 1
        ];

      if (latestVersion?.isAiGenerated) {
        notificationService
          .publishEvent({
            type:
              category === 'ProjectBreakdown'
                ? 'ai_tasks_generated'
                : 'ai_recommendation_available',

            title:
              category === 'ProjectBreakdown'
                ? 'AI task breakdown generated'
                : 'AI content generated',

            message:
              `Your AI-generated "${title}" is ready to review.`,

            recipientIds: [
              req.user.id,
            ],

            actorId:
              req.user.id,

            projectId:
              projectId || undefined,

            taskId:
              taskId || undefined,
          })
          .catch((error) =>
            console.error(
              '[assistantRoutes] Failed to publish AI notification event:',
              error
            )
          );
      }

      res.status(201).json({
        success: true,
        data: prompt,
      });
    } catch (error: any) {
      console.error(
        '[assistantRoutes] Failed to save prompt:',
        error
      );

      res.status(500).json({
        success: false,
        message:
          error?.message ||
          'Failed to save prompt.',
      });
    }
  }
);

/**
 * GET /api/assistant/prompts
 * List saved prompts for current user.
 */
router.get(
  '/prompts',
  (req: AuthenticatedRequest, res: Response): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated.',
      });
      return;
    }

    try {
      const includeArchived =
        req.query.includeArchived === 'true';

      const category =
        req.query.category as string | undefined;

      const search =
        (
          req.query.search as string || ''
        ).toLowerCase();

      let prompts =
        promptStore.getPromptsForUser(
          req.user.id,
          includeArchived
        );

      if (category) {
        prompts = prompts.filter(
          (prompt) =>
            prompt.category === category
        );
      }

      if (search) {
        prompts = prompts.filter(
          (prompt) => {
            const latestContent =
              prompt.versions[
                prompt.versions.length - 1
              ]?.content || '';

            return (
              prompt.title
                .toLowerCase()
                .includes(search) ||
              latestContent
                .toLowerCase()
                .includes(search)
            );
          }
        );
      }

      const safe = prompts.map(
        (prompt) => ({
          id: prompt.id,
          title: prompt.title,
          category: prompt.category,
          style: prompt.style,
          isArchived: prompt.isArchived,
          versionCount:
            prompt.versions.length,
          latestContent:
            prompt.versions[
              prompt.versions.length - 1
            ]?.content.substring(0, 200) || '',
          createdAtUtc:
            prompt.createdAtUtc,
          updatedAtUtc:
            prompt.updatedAtUtc,
        })
      );

      res.json({
        success: true,
        data: safe,
      });
    } catch (error: any) {
      console.error(
        '[assistantRoutes] Failed to load prompts:',
        error
      );

      res.status(500).json({
        success: false,
        message:
          error?.message ||
          'Failed to load prompts.',
      });
    }
  }
);

/**
 * GET /api/assistant/prompts/:id
 * Get a saved prompt with all versions.
 */
router.get(
  '/prompts/:id',
  (req: AuthenticatedRequest, res: Response): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated.',
      });
      return;
    }

    const prompt =
      promptStore.getPromptById(
        req.params.id
      );

    if (
      !prompt ||
      prompt.userId !== req.user.id
    ) {
      res.status(404).json({
        success: false,
        message: 'Prompt not found.',
      });
      return;
    }

    res.json({
      success: true,
      data: prompt,
    });
  }
);

/**
 * PUT /api/assistant/prompts/:id
 * Update prompt content and create a new version.
 */
router.put(
  '/prompts/:id',
  (req: AuthenticatedRequest, res: Response): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated.',
      });
      return;
    }

    const {
      content,
      title,
    } = req.body;

    if (!content) {
      res.status(400).json({
        success: false,
        message: 'Content is required.',
      });
      return;
    }

    const updated =
      promptStore.updatePrompt(
        req.params.id,
        req.user.id,
        {
          content,
          title,
        }
      );

    if (!updated) {
      res.status(404).json({
        success: false,
        message:
          'Prompt not found or access denied.',
      });
      return;
    }

    res.json({
      success: true,
      data: updated,
    });
  }
);

/**
 * GET /api/assistant/prompts/:id/versions
 * Get prompt version history.
 */
router.get(
  '/prompts/:id/versions',
  (req: AuthenticatedRequest, res: Response): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated.',
      });
      return;
    }

    const prompt =
      promptStore.getPromptById(
        req.params.id
      );

    if (
      !prompt ||
      prompt.userId !== req.user.id
    ) {
      res.status(404).json({
        success: false,
        message: 'Prompt not found.',
      });
      return;
    }

    const safe =
      prompt.versions.map(
        (version) => ({
          versionId:
            version.versionId,

          versionNumber:
            version.versionNumber,

          content:
            version.content,

          isAiGenerated:
            version.isAiGenerated,

          createdByUserId:
            version.createdByUserId,

          createdByName:
            userStore.findById(
              version.createdByUserId
            )?.name || 'Unknown',

          createdAtUtc:
            version.createdAtUtc,
        })
      );

    res.json({
      success: true,
      data: safe,
    });
  }
);

/**
 * POST /api/assistant/prompts/:id/restore/:versionId
 * Restore a previous prompt version.
 */
router.post(
  '/prompts/:id/restore/:versionId',
  (req: AuthenticatedRequest, res: Response): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated.',
      });
      return;
    }

    const updated =
      promptStore.restoreVersion(
        req.params.id,
        req.params.versionId,
        req.user.id
      );

    if (!updated) {
      res.status(404).json({
        success: false,
        message:
          'Prompt or version not found, or access denied.',
      });
      return;
    }

    res.json({
      success: true,
      data: updated,
    });
  }
);

/**
 * DELETE /api/assistant/prompts/:id
 * Archive a prompt.
 */
router.delete(
  '/prompts/:id',
  (req: AuthenticatedRequest, res: Response): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated.',
      });
      return;
    }

    const archived =
      promptStore.archivePrompt(
        req.params.id,
        req.user.id
      );

    if (!archived) {
      res.status(404).json({
        success: false,
        message:
          'Prompt not found or access denied.',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Prompt archived.',
    });
  }
);

/**
 * PATCH /api/assistant/prompts/:id/unarchive
 * Restore an archived prompt.
 */
router.patch(
  '/prompts/:id/unarchive',
  (req: AuthenticatedRequest, res: Response): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        message: 'Not authenticated.',
      });
      return;
    }

    const unarchived =
      promptStore.unarchivePrompt(
        req.params.id,
        req.user.id
      );

    if (!unarchived) {
      res.status(404).json({
        success: false,
        message:
          'Prompt not found or access denied.',
      });
      return;
    }

    res.json({
      success: true,
      message:
        'Prompt restored from archive.',
    });
  }
);

export default router;
```
