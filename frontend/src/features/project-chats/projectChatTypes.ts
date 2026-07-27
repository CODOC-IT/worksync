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
  taskId?: string;
  title: string;
  type: DiscussionType;
  creatorId: string;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  comments: DiscussionComment[];
}

export interface DiscussionFilters {
  search: string;
  projectId: string;
  taskId: string;
  type: string;
  authorId: string;
  state: '' | 'resolved' | 'unresolved';
  mentionedOnly: boolean;
  mineOnly: boolean;
  from: string;
  to: string;
  sort: DiscussionSort;
}

export const DISCUSSION_TYPES: DiscussionType[] = ['General', 'Progress Update', 'Blocker', 'Review Feedback', 'Clarification', 'Decision'];
