// Domain types + DTOs for Project Chat (collab.DiscussionThreads/Comments), duplicated from the
// frontend on purpose — same convention as project.types.ts/notification.types.ts (separate
// TypeScript projects, no shared package).

export type ThreadTypeCode = 'Project' | 'Task';
export type CommentKindCode =
  | 'General' | 'Progress' | 'Blocker' | 'Review' | 'CorrectionRequest' | 'ClarificationRequest' | 'Decision';

// Frontend vocabulary (frontend/src/features/project-chats/projectChatTypes.ts) has no
// thread-level "type" column in the real schema — collab.DiscussionThreads only has ThreadType
// ('Project'/'Task', which parent column is set), not a free-form category. The mock's
// thread-level `type` is represented here as the *opening comment's* CommentKind instead, since
// every discussion always has a first message.
export type DiscussionType = 'General' | 'Progress Update' | 'Blocker' | 'Review Feedback' | 'Clarification' | 'Decision';

export const API_TO_DB_DISCUSSION_TYPE: Record<DiscussionType, CommentKindCode> = {
  General: 'General',
  'Progress Update': 'Progress',
  Blocker: 'Blocker',
  'Review Feedback': 'Review',
  Clarification: 'ClarificationRequest',
  Decision: 'Decision'
};

// CorrectionRequest has no frontend equivalent (never produced by this module today — it's
// reserved for a future Attendance-correction discussion thread) so it falls back to the closest
// semantic match rather than leaving the mapping partial.
export const DB_TO_API_DISCUSSION_TYPE: Record<CommentKindCode, DiscussionType> = {
  General: 'General',
  Progress: 'Progress Update',
  Blocker: 'Blocker',
  Review: 'Review Feedback',
  CorrectionRequest: 'Clarification',
  ClarificationRequest: 'Clarification',
  Decision: 'Decision'
};

export interface DiscussionThreadRow {
  threadid: number;
  threadtype: ThreadTypeCode;
  subject: string | null;
  effectiveprojectid: number;
  taskid: number | null;
  createdbyuserid: number;
  createdatutc: Date;
}

export interface CommentRow {
  commentid: number;
  threadid: number;
  parentcommentid: number | null;
  authoruserid: number;
  commentkind: CommentKindCode;
  commenttext: string;
  createdatutc: Date;
  editedatutc: Date | null;
  deletedatutc: Date | null;
}

export interface CommentMentionRow {
  commentid: number;
  mentioneduserid: number;
}

export interface CommentFileRow {
  commentid: number;
  fileid: number;
  originalfilename: string;
  mimetype: string;
  sizebytes: string;
  storageobjectkey: string;
}

// --- API-facing shapes (mirrors frontend/src/features/project-chats/projectChatTypes.ts) ---

export interface ChatAttachmentDTO {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
}

export interface ChatAttachmentInput {
  id?: string;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
}

export interface DiscussionCommentDTO {
  id: string;
  threadId: string;
  parentCommentId?: string;
  authorId: string;
  body: string;
  mentionIds: string[];
  attachments: ChatAttachmentDTO[];
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
}

export interface DiscussionThreadDTO {
  id: string;
  projectId: string;
  taskId?: string;
  title: string;
  type: DiscussionType;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
  comments: DiscussionCommentDTO[];
}

export interface CreateThreadInput {
  projectId: string;
  taskId?: string;
  title: string;
  type: DiscussionType;
  creatorId: string;
  body: string;
  mentionIds: string[];
  attachments: ChatAttachmentInput[];
}

export interface AddCommentInput {
  threadId: string;
  parentCommentId?: string;
  authorId: string;
  body: string;
  mentionIds: string[];
  attachments: ChatAttachmentInput[];
}
