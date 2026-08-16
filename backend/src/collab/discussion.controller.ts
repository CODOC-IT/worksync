import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import * as service from './discussion.service.js';
import {
  validateAddCommentBody,
  validateCreateThreadBody,
  validateEditCommentBody
} from './discussion.validation.js';
import { ChatAttachmentInput, DiscussionType } from './discussion.types.js';

// Controller = thin HTTP adapter (matching project.controller.ts/task.controller.ts). Every
// handler: read req, call the service, map the result/error to a response. No SQL, no
// authorization decisions here.

const requireUser = (req: AuthenticatedRequest, res: Response): { id: string; role: string } | null => {
  if (!req.user) {
    res.status(401).json({ success: false, message: 'Not authenticated.' });
    return null;
  }
  return req.user;
};

const handleServiceError = (error: unknown, res: Response, fallback: string): void => {
  if (error instanceof service.DiscussionNotFoundError) {
    res.status(404).json({ success: false, message: error.message });
  } else if (error instanceof service.DiscussionAuthorizationError) {
    res.status(403).json({ success: false, message: error.message });
  } else if (error instanceof service.DiscussionValidationError) {
    res.status(400).json({
      success: false,
      message: error.message,
      fieldErrors: error.field ? { [error.field]: error.message } : undefined
    });
  } else {
    console.error('[discussion.controller]', error);
    res.status(500).json({ success: false, message: (error as Error)?.message || fallback });
  }
};

export const listThreads = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.listThreadsForUser(user.id, user.role);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load discussions.');
  }
};

export const getThread = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.getThreadForUser(req.params.threadId, user.id, user.role);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to load discussion.');
  }
};

export const createThread = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateCreateThreadBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  const { projectId, taskId, teamId, title, type, body, mentionIds, attachments } = req.body as {
    projectId: string; taskId?: string; teamId?: string; title: string; type: DiscussionType; body: string;
    mentionIds?: string[]; attachments?: ChatAttachmentInput[];
  };

  try {
    const { thread, notifiedUserIds } = await service.createThread(
      { projectId, taskId, teamId, title, type, body, mentionIds: mentionIds || [], attachments: attachments || [] },
      user.id,
      user.role
    );
    res.status(201).json({ success: true, data: thread, notifiedUserIds });
  } catch (error) {
    handleServiceError(error, res, 'Failed to create discussion.');
  }
};

export const addComment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateAddCommentBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, message: validation.message });
    return;
  }

  const { body, parentCommentId, mentionIds, attachments } = req.body as {
    body: string; parentCommentId?: string; mentionIds?: string[]; attachments?: ChatAttachmentInput[];
  };

  try {
    const { comment, notifiedUserIds } = await service.addComment(
      req.params.threadId,
      { body, parentCommentId, mentionIds: mentionIds || [], attachments: attachments || [] },
      user.id,
      user.role
    );
    res.status(201).json({ success: true, data: comment, notifiedUserIds });
  } catch (error) {
    handleServiceError(error, res, 'Failed to add reply.');
  }
};

export const editComment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;

  const validation = validateEditCommentBody(req.body);
  if (!validation.valid) {
    res.status(400).json({ success: false, fieldErrors: { body: validation.message } });
    return;
  }

  try {
    const data = await service.editComment(req.params.commentId, (req.body as { body: string }).body, user.id, user.role);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to edit comment.');
  }
};

export const deleteComment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const user = requireUser(req, res);
  if (!user) return;
  try {
    const data = await service.deleteComment(req.params.commentId, user.id, user.role);
    res.json({ success: true, data });
  } catch (error) {
    handleServiceError(error, res, 'Failed to delete comment.');
  }
};

