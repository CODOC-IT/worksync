import * as repo from './discussion.repository.js';
import { buildCommentDTO, buildThreadDTO } from './discussion.mapper.js';
import { parseAttachmentDataUrl } from './fileStorage.js';
import { fromProjectPk, fromTaskPk, fromUserPk, toCommentPk, toProjectPk, toTaskPk, toThreadPk, toUserPk } from '../utils/idMapping.js';
import { userStore } from '../store/userStore.js';
import * as projectRepo from '../projects/project.repository.js';
import * as taskRepo from '../tasks/task.repository.js';
import { isProjectAccessible } from '../projects/project.service.js';
import * as notificationService from '../notifications/notification.service.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import {
  canReplyToDiscussion,
  canStartDiscussion,
  hasGlobalDiscussionAccess
} from './discussion.access.js';
import {
  API_TO_DB_DISCUSSION_TYPE,
  ChatAttachmentInput,
  CommentKindCode,
  CommentRow,
  DiscussionCommentDTO,
  DiscussionThreadDTO,
  DiscussionThreadRow,
  DiscussionType
} from './discussion.types.js';

// Resolve the actor's display name from the database-authoritative user store.
// `findById` uses the in-memory cache which may be empty on a cold serverless request;
// `syncUsersToDb()` is idempotent and cheap after the first call — it populates the cache
// so `findById` returns the real name for every subsequent lookup in the same request.
const ensureUserCacheWarmed = async (): Promise<void> => {
  await userStore.syncUsersToDb();
};

// Service Layer — business logic, authorization, and notification publishing (matching
// backend/src/projects and backend/src/tasks). No SQL here (discussion.repository.ts); no
// Express req/res here (discussion.controller.ts). Replaces the old
// backend/src/routes/projectChatRoutes.ts, which read/wrote the file-based discussionStore.ts
// and the hardcoded projectStore.ts mock instead of real projects/tasks/users.

export class DiscussionNotFoundError extends Error {}
export class DiscussionAuthorizationError extends Error {}
export class DiscussionValidationError extends Error {
  field?: string;
  constructor(message: string, field?: string) {
    super(message);
    this.field = field;
  }
}

const getAccessibleProjectIds = async (userId: string, role: string): Promise<number[]> => {
  const rows = hasGlobalDiscussionAccess(role)
    ? await projectRepo.findAllProjects()
    : await projectRepo.findProjectsForUser(toUserPk(userId));
  return rows.map((row) => row.projectid);
};

// Every attachment must carry real content — a client sending metadata with no `url` (the old
// mock's behavior for non-image files) gets a clear validation error instead of a silently
// discarded, fake attachment record.
const assertAttachmentsHaveContent = (attachments: ChatAttachmentInput[]): void => {
  for (const attachment of attachments) {
    if (!attachment.url || !parseAttachmentDataUrl(attachment.url)) {
      throw new DiscussionValidationError(
        `"${attachment.name}" has no readable content. Re-select the file and try again.`,
        'attachments'
      );
    }
  }
};

const assertProjectDiscussionOpen = (statusCode: string): void => {
  if (statusCode !== 'Active') {
    throw new DiscussionAuthorizationError('Discussions can only be started or continued in active projects.');
  }
};

const assertValidMentions = async (mentionIds: string[], projectId: number, taskId?: number): Promise<number[]> => {
  const mentionPks = Array.from(new Set(mentionIds.map(toUserPk)));
  if (mentionPks.length === 0) return [];
  const mentionableUserIds = new Set(
    (taskId
      ? await repo.findMentionableUsersForTask(taskId, projectId)
      : await repo.findMentionableUsersForProjects([projectId])
    ).map((row) => row.userid)
  );
  for (const pk of mentionPks) {
    if (!mentionableUserIds.has(pk)) {
      throw new DiscussionValidationError(
        taskId
          ? 'You can only mention task assignees, this project\'s Team Lead, HR, or Admin users.'
          : 'You can only mention active project members, HR, or Admin users.',
        'mentionIds'
      );
    }
  }
  return mentionPks;
};

const notify = (
  recipientIds: string[],
  event: Omit<Parameters<typeof notificationService.publishEvent>[0], 'recipientIds'>
) => {
  const ids = Array.from(new Set(recipientIds));
  if (ids.length === 0) return;
  notificationService.publishEvent({ ...event, recipientIds: ids }).catch((error) => {
    console.error('[discussion.service] Failed to publish notification event.', event.type, error);
  });
};

const hydrateThreads = async (rows: DiscussionThreadRow[]): Promise<DiscussionThreadDTO[]> => {
  if (rows.length === 0) return [];
  const threadIds = rows.map((row) => row.threadid);
  const projectIds = Array.from(new Set(rows.map((row) => row.effectiveprojectid)));
  const commentRows = await repo.findCommentsForThreads(threadIds);
  const commentIds = commentRows.map((c) => c.commentid);
  const [mentionRows, attachmentRows, mentionableRows] = await Promise.all([
    repo.findMentionsForComments(commentIds),
    repo.findAttachmentsForComments(commentIds),
    repo.findMentionableUsersForProjects(projectIds)
  ]);

  return Promise.all(
    rows.map(async (row) => {
      const rowsForThread = commentRows.filter((c) => c.threadid === row.threadid);
      const comments = await Promise.all(rowsForThread.map((c) => buildCommentDTO(c, mentionRows, attachmentRows)));
      const opening = rowsForThread.find((c) => !c.parentcommentid) || rowsForThread[0];
      const scopedRows = row.taskid
        ? await repo.findMentionableUsersForTask(row.taskid, row.effectiveprojectid)
        : mentionableRows.filter((candidate) => candidate.projectid === row.effectiveprojectid);
      const mentionableUserIds = scopedRows.map((candidate) => fromUserPk(candidate.userid));
      return buildThreadDTO(row, comments, opening?.commentkind || 'General', mentionableUserIds);
    })
  );
};

const hydrateThread = async (row: DiscussionThreadRow): Promise<DiscussionThreadDTO> => (await hydrateThreads([row]))[0];

const assertThreadAccessible = async (row: DiscussionThreadRow, userId: string, role: string): Promise<void> => {
  const accessible = hasGlobalDiscussionAccess(role)
    || (row.taskid
      ? (await repo.findMentionableUsersForTask(row.taskid, row.effectiveprojectid)).some((candidate) => fromUserPk(candidate.userid) === userId)
      : await isProjectAccessible(fromProjectPk(row.effectiveprojectid), userId, role));
  if (!accessible) throw new DiscussionNotFoundError('Discussion not found.');
  const project = await projectRepo.findProjectById(row.effectiveprojectid);
  if (!project) throw new DiscussionNotFoundError('Discussion not found.');
  assertProjectDiscussionOpen(project.statuscode);
};

export const listThreadsForUser = async (userId: string, role: string): Promise<DiscussionThreadDTO[]> => {
  const projectIds = await getAccessibleProjectIds(userId, role);
  const rows = await repo.findThreadsForProjects(projectIds);
  const openRows = (await Promise.all(rows.map(async (row) => {
    const project = await projectRepo.findProjectById(row.effectiveprojectid);
    return project?.statuscode === 'Completed' ? null : row;
  }))).filter((row): row is DiscussionThreadRow => row !== null);
  const accessibleRows = hasGlobalDiscussionAccess(role)
    ? openRows
    : (await Promise.all(openRows.map(async (row) => {
        try { await assertThreadAccessible(row, userId, role); return row; } catch { return null; }
      }))).filter((row): row is DiscussionThreadRow => row !== null);
  return hydrateThreads(accessibleRows);
};

export const getThreadForUser = async (threadId: string, userId: string, role: string): Promise<DiscussionThreadDTO> => {
  const row = await repo.findThreadById(toThreadPk(threadId));
  if (!row) throw new DiscussionNotFoundError('Discussion not found.');
  await assertThreadAccessible(row, userId, role);
  return hydrateThread(row);
};

export interface CreateThreadServiceInput {
  projectId: string;
  taskId?: string;
  title: string;
  type: DiscussionType;
  body: string;
  mentionIds: string[];
  attachments: ChatAttachmentInput[];
}

export const createThread = async (
  input: CreateThreadServiceInput,
  actorId: string,
  actorRole: string
): Promise<{ thread: DiscussionThreadDTO; notifiedUserIds: string[] }> => {
  if (!canStartDiscussion(actorRole)) {
    throw new DiscussionAuthorizationError('You do not have permission to start discussions.');
  }

  const projectRow = await projectRepo.findProjectById(toProjectPk(input.projectId));
  if (!projectRow) throw new DiscussionValidationError('Select a valid project.', 'projectId');
  assertProjectDiscussionOpen(projectRow.statuscode);
  if (!(await isProjectAccessible(input.projectId, actorId, actorRole))) {
    throw new DiscussionValidationError('You do not have access to this project.', 'projectId');
  }

  let taskPk: number | undefined;
  let taskTitle: string | undefined;
  if (input.taskId) {
    const taskRow = await taskRepo.findTaskById(toTaskPk(input.taskId));
    if (!taskRow || taskRow.projectid !== projectRow.projectid) {
      throw new DiscussionValidationError('The selected task must belong to the selected project.', 'taskId');
    }
    taskPk = taskRow.taskid;
    taskTitle = taskRow.title;
    const taskAudience = await repo.findMentionableUsersForTask(taskPk, projectRow.projectid);
    if (!hasGlobalDiscussionAccess(actorRole) && !taskAudience.some((candidate) => fromUserPk(candidate.userid) === actorId)) {
      throw new DiscussionAuthorizationError('Only a task assignee or this project\'s Team Lead can start a task discussion.');
    }
  }

  const title = input.title.trim();
  const body = input.body.trim();
  const mentionPks = await assertValidMentions(input.mentionIds, projectRow.projectid, taskPk);
  assertAttachmentsHaveContent(input.attachments);
  const commentKind: CommentKindCode = API_TO_DB_DISCUSSION_TYPE[input.type];

  const { threadId } = await repo.insertThread({
    projectId: projectRow.projectid,
    taskId: taskPk,
    title,
    commentKind,
    creatorUserId: toUserPk(actorId),
    body,
    mentionUserIds: mentionPks,
    attachments: input.attachments
  });

  const row = await repo.findThreadById(threadId);
  const thread = await hydrateThread(row!);

  const members = taskPk
    ? await repo.findMentionableUsersForTask(taskPk, projectRow.projectid)
    : await projectRepo.findMembersForProject(projectRow.projectid);
  await ensureUserCacheWarmed();
  const actorName = userStore.findById(actorId)?.name || actorId;
  const mentionedIds = new Set(mentionPks.map(fromUserPk).filter((id) => id !== actorId));

  notify(
    members.map((m) => fromUserPk(m.userid)).filter((id) => id !== actorId && !mentionedIds.has(id)),
    {
      type: 'chat_new_message',
      title: 'New Discussion Started',
      message: `${actorName} started a discussion "${title}" in ${projectRow.projectname}.`,
      actorId,
      projectId: input.projectId,
      taskId: input.taskId
    }
  );
  notify([...mentionedIds], {
    type: 'mention',
    title: 'You Were Mentioned',
    message: `${actorName} mentioned you in a new discussion "${title}" in ${projectRow.projectname}.`,
    actorId,
    projectId: input.projectId,
    taskId: input.taskId
  });

  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: mentionPks.length ? 'Mentioned' : 'Created', module: 'Project Chats',
    entityType: 'Comment', entityId: thread.id, entityName: title,
    projectId: input.projectId, projectName: projectRow.projectname,
    taskId: input.taskId, taskName: taskTitle,
    description: `${actorName} started discussion "${title}" in "${projectRow.projectname}".`,
    reason: body, linkRoute: 'project-chats', important: input.type === 'Blocker' || input.type === 'Decision',
    metadata: {
      discussionType: input.type,
      hasMentions: mentionPks.length > 0,
      hasAttachments: input.attachments.length > 0,
      mentionCount: mentionPks.length,
      attachments: input.attachments.map((file) => ({ name: file.name, mimeType: file.mimeType, size: file.size }))
    }
  });

  return { thread, notifiedUserIds: [...mentionedIds] };
};

export interface AddCommentServiceInput {
  parentCommentId?: string;
  body: string;
  mentionIds: string[];
  attachments: ChatAttachmentInput[];
}

export const addComment = async (
  threadId: string,
  input: AddCommentServiceInput,
  actorId: string,
  actorRole: string
): Promise<{ comment: DiscussionCommentDTO; notifiedUserIds: string[] }> => {
  const row = await repo.findThreadById(toThreadPk(threadId));
  if (!row) throw new DiscussionNotFoundError('Discussion not found.');
  await assertThreadAccessible(row, actorId, actorRole);
  if (!canReplyToDiscussion(actorRole)) {
    throw new DiscussionAuthorizationError('You do not have permission to reply.');
  }

  let parentRow: CommentRow | null = null;
  if (input.parentCommentId) {
    parentRow = await repo.findCommentById(toCommentPk(input.parentCommentId));
    if (!parentRow || parentRow.threadid !== row.threadid) {
      throw new DiscussionValidationError('Replies must reference a comment in this discussion.', 'parentCommentId');
    }
  }

  const body = input.body.trim();
  const mentionPks = await assertValidMentions(input.mentionIds, row.effectiveprojectid, row.taskid || undefined);
  assertAttachmentsHaveContent(input.attachments);

  const commentId = await repo.insertComment({
    threadId: row.threadid,
    parentCommentId: parentRow?.commentid,
    authorUserId: toUserPk(actorId),
    body,
    mentionUserIds: mentionPks,
    attachments: input.attachments
  });

  const [commentRow, mentionRows, attachmentRows] = await Promise.all([
    repo.findCommentById(commentId),
    repo.findMentionsForComments([commentId]),
    repo.findAttachmentsForComments([commentId])
  ]);
  const comment = await buildCommentDTO(commentRow!, mentionRows, attachmentRows);

  await ensureUserCacheWarmed();
  const actorName = userStore.findById(actorId)?.name || actorId;
  const mentionedIds = new Set(mentionPks.map(fromUserPk).filter((id) => id !== actorId));
  const projectId = fromProjectPk(row.effectiveprojectid);
  const taskId = row.taskid ? fromTaskPk(row.taskid) : undefined;

  notify([...mentionedIds], {
    type: 'mention',
    title: 'You Were Mentioned',
    message: `${actorName} mentioned you in a reply on "${row.subject}".`,
    actorId,
    projectId,
    taskId
  });

  const parentAuthorId = parentRow ? fromUserPk(parentRow.authoruserid) : undefined;
  if (parentAuthorId && parentAuthorId !== actorId && !mentionedIds.has(parentAuthorId)) {
    notify([parentAuthorId], {
      type: 'chat_thread_reply',
      title: 'New Reply',
      message: `${actorName} replied to your comment on "${row.subject}".`,
      actorId,
      projectId,
      taskId
    });
  }

  const projectRow = await projectRepo.findProjectById(row.effectiveprojectid);
  const taskRow = row.taskid ? await taskRepo.findTaskById(row.taskid) : undefined;
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: mentionPks.length ? 'Mentioned' : 'Commented', module: 'Project Chats',
    entityType: 'Comment', entityId: comment.id, entityName: row.subject || undefined,
    projectId, projectName: projectRow?.projectname, taskId,
    taskName: taskRow?.title, description: `${actorName} commented on "${row.subject}".`, reason: body,
    linkRoute: 'project-chats',
    metadata: {
      hasMentions: mentionPks.length > 0, hasAttachments: input.attachments.length > 0,
      parentCommentId: input.parentCommentId || null,
      attachments: input.attachments.map((file) => ({ name: file.name, mimeType: file.mimeType, size: file.size }))
    }
  });

  const notifiedUserIds = [...new Set([...mentionedIds, ...(parentAuthorId && parentAuthorId !== actorId ? [parentAuthorId] : [])])];
  return { comment, notifiedUserIds };
};

export const editComment = async (commentId: string, body: string, actorId: string, actorRole: string): Promise<DiscussionCommentDTO> => {
  const commentRow = await repo.findCommentById(toCommentPk(commentId));
  if (!commentRow) throw new DiscussionNotFoundError('Comment not found.');
  const threadRow = await repo.findThreadById(commentRow.threadid);
  if (!threadRow) throw new DiscussionNotFoundError('Comment not found.');
  await assertThreadAccessible(threadRow, actorId, actorRole);
  if (commentRow.authoruserid !== toUserPk(actorId)) {
    throw new DiscussionAuthorizationError('You can only edit your own comments.');
  }

  const trimmedBody = body.trim();
  await repo.updateCommentText(commentRow.commentid, trimmedBody);

  const [updatedRow, mentionRows, attachmentRows] = await Promise.all([
    repo.findCommentById(commentRow.commentid),
    repo.findMentionsForComments([commentRow.commentid]),
    repo.findAttachmentsForComments([commentRow.commentid])
  ]);
  const dto = await buildCommentDTO(updatedRow!, mentionRows, attachmentRows);

  await ensureUserCacheWarmed();
  const projectRow = await projectRepo.findProjectById(threadRow.effectiveprojectid);
  const taskRow = threadRow.taskid ? await taskRepo.findTaskById(threadRow.taskid) : undefined;
  const actorName = userStore.findById(actorId)?.name || actorId;
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Updated', module: 'Project Chats', entityType: 'Comment', entityId: dto.id,
    entityName: threadRow.subject || undefined, projectId: fromProjectPk(threadRow.effectiveprojectid),
    projectName: projectRow?.projectname, taskName: taskRow?.title,
    description: `${actorName} edited a comment on "${threadRow.subject}".`, linkRoute: 'project-chats',
    changes: [{ field: 'Comment', previousValue: commentRow.commenttext, newValue: trimmedBody }]
  });

  return dto;
};

export const deleteComment = async (commentId: string, actorId: string, actorRole: string): Promise<DiscussionCommentDTO> => {
  const commentRow = await repo.findCommentById(toCommentPk(commentId));
  if (!commentRow) throw new DiscussionNotFoundError('Comment not found.');
  const threadRow = await repo.findThreadById(commentRow.threadid);
  if (!threadRow) throw new DiscussionNotFoundError('Comment not found.');
  await assertThreadAccessible(threadRow, actorId, actorRole);
  const actorPk = toUserPk(actorId);
  if (commentRow.authoruserid !== actorPk && actorRole !== 'Admin') {
    throw new DiscussionAuthorizationError('You can only delete your own comments.');
  }

  await repo.softDeleteComment(commentRow.commentid);
  const [updatedRow, mentionRows, attachmentRows] = await Promise.all([
    repo.findCommentById(commentRow.commentid),
    repo.findMentionsForComments([commentRow.commentid]),
    repo.findAttachmentsForComments([commentRow.commentid])
  ]);
  const dto = await buildCommentDTO(updatedRow!, mentionRows, attachmentRows);

  await ensureUserCacheWarmed();
  const projectRow = await projectRepo.findProjectById(threadRow.effectiveprojectid);
  const actorName = userStore.findById(actorId)?.name || actorId;
  const originalAuthor = userStore.findById(fromUserPk(commentRow.authoruserid));
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    affectedUserId: actorPk !== commentRow.authoruserid ? fromUserPk(commentRow.authoruserid) : undefined,
    affectedUserName: actorPk !== commentRow.authoruserid ? originalAuthor?.name : undefined,
    action: 'Deleted', module: 'Project Chats', entityType: 'Comment', entityId: dto.id,
    entityName: threadRow.subject || undefined, projectId: fromProjectPk(threadRow.effectiveprojectid),
    projectName: projectRow?.projectname,
    description: actorPk !== commentRow.authoruserid
      ? `${actorName} (Admin) deleted a comment by ${originalAuthor?.name || fromUserPk(commentRow.authoruserid)} on "${threadRow.subject}".`
      : `${actorName} deleted a comment on "${threadRow.subject}".`,
    reason: commentRow.commenttext,
    linkRoute: 'project-chats',
    important: actorPk !== commentRow.authoruserid,
  });

  return dto;
};

