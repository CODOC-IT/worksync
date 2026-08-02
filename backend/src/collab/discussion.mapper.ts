import { fromCommentPk, fromProjectPk, fromTaskPk, fromThreadPk, fromUserPk } from '../utils/idMapping.js';
import { getAttachmentUrl } from './fileStorage.js';
import {
  ChatAttachmentDTO,
  CommentFileRow,
  CommentKindCode,
  CommentMentionRow,
  CommentRow,
  DB_TO_API_DISCUSSION_TYPE,
  DiscussionCommentDTO,
  DiscussionThreadDTO,
  DiscussionThreadRow
} from './discussion.types.js';

// Mapper = row -> DTO conversion only (matching project.mapper.ts/notification.mapper.ts). No
// SQL, no authorization, no Express here.

// Attachment bytes are re-read from disk and re-encoded as a data: URL on every fetch rather than
// cached anywhere — proves the persisted file is the real source of truth (a server restart or a
// different request still reconstructs identical bytes), matching how the frontend already
// expects to consume `url` directly as an <img src>.
const buildAttachmentDTO = async (row: CommentFileRow): Promise<ChatAttachmentDTO> => {
  let url: string | undefined;
  try {
    url = await getAttachmentUrl(row.storageobjectkey, row.mimetype);
  } catch (error) {
    console.warn(`[discussion.mapper] Could not read stored attachment "${row.storageobjectkey}" from disk.`, error);
  }
  return {
    id: `file-${row.fileid}`,
    name: row.originalfilename,
    mimeType: row.mimetype,
    size: Number(row.sizebytes),
    url
  };
};

export const buildCommentDTO = async (
  row: CommentRow,
  mentions: CommentMentionRow[],
  attachmentRows: CommentFileRow[]
): Promise<DiscussionCommentDTO> => ({
  id: fromCommentPk(row.commentid),
  threadId: fromThreadPk(row.threadid),
  parentCommentId: row.parentcommentid ? fromCommentPk(row.parentcommentid) : undefined,
  authorId: fromUserPk(row.authoruserid),
  body: row.commenttext,
  mentionIds: mentions.filter((m) => m.commentid === row.commentid).map((m) => fromUserPk(m.mentioneduserid)),
  attachments: await Promise.all(
    attachmentRows.filter((a) => a.commentid === row.commentid).map(buildAttachmentDTO)
  ),
  createdAt: row.createdatutc.toISOString(),
  editedAt: row.editedatutc ? row.editedatutc.toISOString() : undefined,
  deletedAt: row.deletedatutc ? row.deletedatutc.toISOString() : undefined
});

// The thread's frontend-facing `type` has no dedicated column in the real schema — it's derived
// from the opening comment's CommentKind (the earliest, top-level comment; the service passes it
// in since DiscussionCommentDTO itself doesn't carry the raw DB kind). `updatedAt` is likewise
// derived (collab.DiscussionThreads has no UpdatedAtUtc column) as the latest created/edited
// timestamp across all of the thread's comments, falling back to the thread's own CreatedAtUtc
// for the (impossible in practice, since every thread is created with an opening comment) case of
// zero comments.
export const buildThreadDTO = (
  row: DiscussionThreadRow,
  comments: DiscussionCommentDTO[],
  openingCommentKind: CommentKindCode,
  mentionableUserIds: string[]
): DiscussionThreadDTO => {
  const latestActivity = comments.reduce<string>((latest, comment) => {
    const candidate = comment.editedAt || comment.createdAt;
    return candidate > latest ? candidate : latest;
  }, row.createdatutc.toISOString());

  return {
    id: fromThreadPk(row.threadid),
    projectId: fromProjectPk(row.effectiveprojectid),
    projectName: row.projectname,
    taskId: row.taskid ? fromTaskPk(row.taskid) : undefined,
    taskName: row.tasktitle || undefined,
    title: row.subject || '',
    type: DB_TO_API_DISCUSSION_TYPE[openingCommentKind],
    creatorId: fromUserPk(row.createdbyuserid),
    createdAt: row.createdatutc.toISOString(),
    updatedAt: latestActivity,
    mentionableUserIds,
    comments
  };
};
