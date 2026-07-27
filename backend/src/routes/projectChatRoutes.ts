import { Router, Response } from 'express';
import { authenticateJWT, AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { discussionStore, DiscussionType, StoredAttachment } from '../store/discussionStore.js';
import { projectStore } from '../store/projectStore.js';
import { userStore } from '../store/userStore.js';
import * as notificationService from '../notifications/notification.service.js';

const router = Router();
const TYPES = new Set<DiscussionType>(['General', 'Progress Update', 'Blocker', 'Review Feedback', 'Clarification', 'Decision']);
const MAX_COMMENT_LENGTH = 5000;
const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['application/pdf', 'text/plain', 'image/png', 'image/jpeg', 'image/webp', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);

const canParticipate = (role: string) => role === 'Admin' || role === 'Team_Member' || role === 'Team_Lead';
const accessible = (projectId: string, req: AuthenticatedRequest) => Boolean(req.user && projectStore.isProjectAccessible(projectId, req.user.id, req.user.role));
const canModerate = (projectId: string, req: AuthenticatedRequest) => {
  if (!req.user) return false;
  if (req.user.role === 'Admin') return true;
  const project = projectStore.getProjectById(projectId);
  // In the current authorization model, Team Lead scope is represented by an active project membership.
  return req.user.role === 'Team_Lead' && project?.status === 'Active' && project.memberIds.includes(req.user.id);
};

const validAttachments = (value: unknown, errors: Record<string, string>): StoredAttachment[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value)) { errors.attachments = 'Attachments must be a list of file metadata.'; return []; }
  const attachments = value as StoredAttachment[];
  if (attachments.some((file) => !file || typeof file.name !== 'string' || !/^[\w. -]+$/.test(file.name) || !ALLOWED_TYPES.has(file.mimeType) || !Number.isFinite(file.size) || file.size <= 0 || file.size > MAX_ATTACHMENT_SIZE)) {
    errors.attachments = 'Each attachment must have a safe name, an allowed type, and be 10 MB or smaller.';
    return [];
  }
  return attachments.map((file) => ({ id: typeof file.id === 'string' ? file.id : `file-${Date.now()}`, name: file.name, mimeType: file.mimeType, size: file.size, url: file.url }));
};

const validMentions = (value: unknown, projectId: string, errors: Record<string, string>): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) { errors.mentionIds = 'Mentions must be valid user identifiers.'; return []; }
  const ids = [...new Set(value as string[])];
  const project = projectStore.getProjectById(projectId);
  if (!project || ids.some((id) => !project.memberIds.includes(id) || userStore.findById(id)?.status !== 'active')) {
    errors.mentionIds = 'Mentioned users must be active members of this project.';
  }
  return ids;
};

// Fire-and-forget, same convention as project.service.ts/task.service.ts's notifyRecipients --
// never blocks the HTTP response on notification delivery, and a publish failure is logged, not
// surfaced to the caller (the discussion/comment/mention itself already succeeded).
const notify = (recipientIds: string[], event: Omit<Parameters<typeof notificationService.publishEvent>[0], 'recipientIds'>) => {
  const ids = Array.from(new Set(recipientIds));
  if (ids.length === 0) return;
  notificationService.publishEvent({ ...event, recipientIds: ids }).catch((error) => {
    console.warn('[projectChatRoutes] Failed to publish notification event.', error);
  });
};

router.use(authenticateJWT);

router.get('/', (req: AuthenticatedRequest, res: Response) => {
  if (!req.user) return;
  const threads = discussionStore.list().filter((thread) => accessible(thread.projectId, req));
  const data = threads.map((thread) => ({ ...thread, comments: discussionStore.comments(thread.id) }));
  res.json({ success: true, data });
});

router.get('/:threadId', (req: AuthenticatedRequest, res: Response) => {
  const thread = discussionStore.get(req.params.threadId);
  if (!thread || !accessible(thread.projectId, req)) return res.status(404).json({ success: false, message: 'Discussion not found.' });
  res.json({ success: true, data: { ...thread, comments: discussionStore.comments(thread.id) } });
});

router.post('/', (req: AuthenticatedRequest, res: Response) => {
  if (!req.user || !canParticipate(req.user.role)) return res.status(403).json({ success: false, message: 'You do not have permission to start discussions.' });
  const { projectId, taskId, type, mentionIds, attachments } = req.body || {};
  let { title, body } = req.body || {};
  const errors: Record<string, string> = {};
  const project = typeof projectId === 'string' ? projectStore.getProjectById(projectId) : undefined;
  if (!projectId || !project) errors.projectId = 'Select a valid project.';
  else if (!accessible(projectId, req)) errors.projectId = 'You do not have access to this project.';
  const task = typeof taskId === 'string' ? projectStore.getTaskById(taskId) : undefined;
  if (taskId && (!task || task.projectId !== projectId)) errors.taskId = 'The selected task must belong to the selected project.';
  if (typeof title !== 'string' || !(title = title.trim()) || title.length > 200) errors.title = 'Enter a discussion title of up to 200 characters.';
  if (typeof body !== 'string' || !(body = body.trim()) || body.length > MAX_COMMENT_LENGTH) errors.body = `Enter a message of up to ${MAX_COMMENT_LENGTH} characters.`;
  if (!TYPES.has(type)) errors.type = 'Select a valid discussion type.';
  const checkedMentions = validMentions(mentionIds, projectId, errors);
  const checkedAttachments = validAttachments(attachments, errors);
  if (Object.keys(errors).length) return res.status(400).json({ success: false, message: 'Review the highlighted discussion fields.', fieldErrors: errors });
  const thread = discussionStore.createThread({ projectId, taskId, title, type, creatorId: req.user.id, body, mentionIds: checkedMentions, attachments: checkedAttachments });

  const actorName = userStore.findById(req.user.id)?.name || 'Someone';
  const mentioned = new Set(checkedMentions.filter((id) => id !== req.user!.id));
  // Everyone else on the project (owner + members) hears a discussion started; anyone
  // specifically @mentioned gets the more specific "you were mentioned" notification instead,
  // so nobody gets both for the same message.
  notify(
    (project!.memberIds || []).filter((id) => id !== req.user!.id && !mentioned.has(id)),
    {
      type: 'chat_new_message',
      title: 'New Discussion Started',
      message: `${actorName} started a discussion "${title}" in ${project!.title}.`,
      actorId: req.user.id,
      projectId,
      taskId: taskId || undefined
    }
  );
  notify([...mentioned], {
    type: 'mention',
    title: 'You Were Mentioned',
    message: `${actorName} mentioned you in a new discussion "${title}" in ${project!.title}.`,
    actorId: req.user.id,
    projectId,
    taskId: taskId || undefined
  });

  res.status(201).json({ success: true, data: { ...thread, comments: discussionStore.comments(thread.id) }, notifiedUserIds: checkedMentions.filter((id) => id !== req.user!.id) });
});

router.post('/:threadId/comments', (req: AuthenticatedRequest, res: Response) => {
  const thread = discussionStore.get(req.params.threadId);
  if (!req.user || !thread || !accessible(thread.projectId, req)) return res.status(404).json({ success: false, message: 'Discussion not found.' });
  if (!canParticipate(req.user.role)) return res.status(403).json({ success: false, message: 'You do not have permission to reply.' });
  let { body, parentCommentId, mentionIds, attachments } = req.body || {};
  const errors: Record<string, string> = {};
  if (typeof body !== 'string' || !(body = body.trim()) || body.length > MAX_COMMENT_LENGTH) errors.body = `Enter a reply of up to ${MAX_COMMENT_LENGTH} characters.`;
  const parent = parentCommentId ? discussionStore.comments(thread.id).find((item) => item.id === parentCommentId) : undefined;
  if (parentCommentId && !parent) errors.parentCommentId = 'Replies must reference a comment in this discussion.';
  if (parent?.parentCommentId) errors.parentCommentId = 'Only one reply level is supported.';
  const checkedMentions = validMentions(mentionIds, thread.projectId, errors);
  const checkedAttachments = validAttachments(attachments, errors);
  if (Object.keys(errors).length) return res.status(400).json({ success: false, message: 'Review the highlighted reply fields.', fieldErrors: errors });
  const comment = discussionStore.addComment({ threadId: thread.id, parentCommentId, authorId: req.user.id, body, mentionIds: checkedMentions, attachments: checkedAttachments });
  const notifiedUserIds = [...new Set([...checkedMentions, ...(parent && parent.authorId !== req.user.id ? [parent.authorId] : [])])];

  const actorName = userStore.findById(req.user.id)?.name || 'Someone';
  const mentioned = new Set(checkedMentions.filter((id) => id !== req.user!.id));
  notify([...mentioned], {
    type: 'mention',
    title: 'You Were Mentioned',
    message: `${actorName} mentioned you in a reply on "${thread.title}".`,
    actorId: req.user.id,
    projectId: thread.projectId,
    taskId: thread.taskId || undefined
  });
  // The comment being directly replied to hears about it too, unless they're already covered
  // by the mention notification above.
  if (parent && parent.authorId !== req.user.id && !mentioned.has(parent.authorId)) {
    notify([parent.authorId], {
      type: 'chat_thread_reply',
      title: 'New Reply',
      message: `${actorName} replied to your comment on "${thread.title}".`,
      actorId: req.user.id,
      projectId: thread.projectId,
      taskId: thread.taskId || undefined
    });
  }

  res.status(201).json({ success: true, data: comment, notifiedUserIds });
});

router.patch('/comments/:commentId', (req: AuthenticatedRequest, res: Response) => {
  const comment = discussionStore.list().flatMap((thread) => discussionStore.comments(thread.id)).find((item) => item.id === req.params.commentId);
  const thread = comment && discussionStore.get(comment.threadId);
  if (!req.user || !comment || !thread || !accessible(thread.projectId, req)) return res.status(404).json({ success: false, message: 'Comment not found.' });
  if (comment.authorId !== req.user.id) return res.status(403).json({ success: false, message: 'You can only edit your own comments.' });
  const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
  if (!body || body.length > MAX_COMMENT_LENGTH) return res.status(400).json({ success: false, fieldErrors: { body: `Enter a message of up to ${MAX_COMMENT_LENGTH} characters.` } });
  res.json({ success: true, data: discussionStore.editComment(comment.id, body) });
});

router.delete('/comments/:commentId', (req: AuthenticatedRequest, res: Response) => {
  const comment = discussionStore.list().flatMap((thread) => discussionStore.comments(thread.id)).find((item) => item.id === req.params.commentId);
  const thread = comment && discussionStore.get(comment.threadId);
  if (!req.user || !comment || !thread || !accessible(thread.projectId, req)) return res.status(404).json({ success: false, message: 'Comment not found.' });
  if (comment.authorId !== req.user.id && req.user.role !== 'Admin') return res.status(403).json({ success: false, message: 'You can only delete your own comments.' });
  res.json({ success: true, data: discussionStore.softDeleteComment(comment.id) });
});

router.post('/:threadId/resolution', (req: AuthenticatedRequest, res: Response) => {
  const thread = discussionStore.get(req.params.threadId);
  if (!req.user || !thread || !accessible(thread.projectId, req)) return res.status(404).json({ success: false, message: 'Discussion not found.' });
  if (!canModerate(thread.projectId, req)) return res.status(403).json({ success: false, message: 'Only an administrator or active scoped Team Lead can resolve discussions.' });
  if (typeof req.body?.resolved !== 'boolean') return res.status(400).json({ success: false, fieldErrors: { resolved: 'Choose a resolution state.' } });
  res.json({ success: true, data: discussionStore.setResolved(thread.id, req.body.resolved, req.user.id) });
});

export default router;
