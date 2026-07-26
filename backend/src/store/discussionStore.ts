import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export type DiscussionType = 'General' | 'Progress Update' | 'Blocker' | 'Review Feedback' | 'Clarification' | 'Decision';

export interface StoredAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  url?: string;
}

export interface StoredComment {
  id: string;
  threadId: string;
  parentCommentId?: string;
  authorId: string;
  body: string;
  mentionIds: string[];
  attachments: StoredAttachment[];
  createdAt: string;
  editedAt?: string;
  deletedAt?: string;
}

export interface StoredDiscussion {
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
}

interface StoredDiscussionData {
  discussions: StoredDiscussion[];
  comments: StoredComment[];
}

const DB_PATH = process.env.PROJECT_CHAT_DB_PATH
  ? path.resolve(process.env.PROJECT_CHAT_DB_PATH)
  : path.resolve(process.cwd(), 'database', 'project_chats_db.json');

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

class DiscussionStore {
  private data: StoredDiscussionData = { discussions: [], comments: [] };

  constructor() { this.load(); }

  private load(): void {
    try {
      if (fs.existsSync(DB_PATH)) {
        this.data = JSON.parse(fs.readFileSync(DB_PATH, 'utf-8')) as StoredDiscussionData;
      }
    } catch (error: any) {
      console.error(`[DiscussionStore] Failed to load discussions: ${error.message}`);
      this.data = { discussions: [], comments: [] };
    }
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
      fs.writeFileSync(DB_PATH, JSON.stringify(this.data, null, 2), 'utf-8');
    } catch (error: any) {
      console.error(`[DiscussionStore] Failed to persist discussions: ${error.message}`);
    }
  }

  list(): StoredDiscussion[] { return clone(this.data.discussions); }
  get(threadId: string): StoredDiscussion | undefined {
    const thread = this.data.discussions.find((item) => item.id === threadId);
    return thread && clone(thread);
  }
  comments(threadId: string): StoredComment[] {
    return clone(this.data.comments.filter((comment) => comment.threadId === threadId));
  }

  createThread(input: Omit<StoredDiscussion, 'id' | 'createdAt' | 'updatedAt' | 'resolved'> & { body: string; mentionIds: string[]; attachments: StoredAttachment[] }): StoredDiscussion {
    const now = new Date().toISOString();
    const thread: StoredDiscussion = { ...input, id: `dsc-${randomUUID()}`, resolved: false, createdAt: now, updatedAt: now };
    const comment: StoredComment = { id: `cmt-${randomUUID()}`, threadId: thread.id, authorId: input.creatorId, body: input.body, mentionIds: [...new Set(input.mentionIds)], attachments: input.attachments, createdAt: now };
    this.data.discussions.push(thread);
    this.data.comments.push(comment);
    this.persist();
    return clone(thread);
  }

  addComment(input: Omit<StoredComment, 'id' | 'createdAt'>): StoredComment {
    const comment: StoredComment = { ...input, id: `cmt-${randomUUID()}`, mentionIds: [...new Set(input.mentionIds)], createdAt: new Date().toISOString() };
    this.data.comments.push(comment);
    const thread = this.data.discussions.find((item) => item.id === input.threadId);
    if (thread) thread.updatedAt = comment.createdAt;
    this.persist();
    return clone(comment);
  }

  editComment(commentId: string, body: string): StoredComment | undefined {
    const comment = this.data.comments.find((item) => item.id === commentId);
    if (!comment || comment.deletedAt) return undefined;
    comment.body = body;
    comment.editedAt = new Date().toISOString();
    this.persist();
    return clone(comment);
  }

  softDeleteComment(commentId: string): StoredComment | undefined {
    const comment = this.data.comments.find((item) => item.id === commentId);
    if (!comment || comment.deletedAt) return undefined;
    comment.deletedAt = new Date().toISOString();
    this.persist();
    return clone(comment);
  }

  setResolved(threadId: string, resolved: boolean, userId: string): StoredDiscussion | undefined {
    const thread = this.data.discussions.find((item) => item.id === threadId);
    if (!thread) return undefined;
    thread.resolved = resolved;
    thread.resolvedBy = resolved ? userId : undefined;
    thread.resolvedAt = resolved ? new Date().toISOString() : undefined;
    thread.updatedAt = new Date().toISOString();
    this.persist();
    return clone(thread);
  }
}

export const discussionStore = new DiscussionStore();
