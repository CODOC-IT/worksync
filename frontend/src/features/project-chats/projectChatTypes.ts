export type DiscussionType = 'General' | 'Progress Update' | 'Blocker' | 'Review Feedback' | 'Clarification' | 'Decision';
export type DiscussionSort = '' | 'newest' | 'oldest' | 'replies';

export interface ChatAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
}

export interface DiscussionComment {
  id: string;
  threadId: string;
  parentCommentId?: string;
  authorId: string;
  body: string;
  mentionIds: string[];
  attachments: ChatAttachment[];
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
}

export interface DiscussionThread {
  id: string;
  projectId: string;
  projectName: string;
  taskId?: string;
  taskName?: string;
  title: string;
  type: DiscussionType;
  creatorId: string;
  createdAt: string;
  updatedAt: string;
  mentionableUserIds: string[];
  comments: DiscussionComment[];
}

export interface DiscussionFilters {
  search: string;
  projectId: string;
  taskId: string;
  type: string;
  authorId: string;
  mentionedOnly: boolean;
  mineOnly: boolean;
  from: string;
  to: string;
  sort: DiscussionSort;
}

export const DISCUSSION_TYPES: DiscussionType[] = ['General', 'Progress Update', 'Blocker', 'Review Feedback', 'Clarification', 'Decision'];
