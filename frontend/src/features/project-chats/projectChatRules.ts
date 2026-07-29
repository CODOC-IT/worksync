import { DiscussionFilters, DiscussionThread } from './projectChatTypes';

export interface MentionCandidate {
  id: string;
  name: string;
  status: string;
}

export interface MentionTrigger {
  start: number;
  end: number;
  query: string;
}

const isMentionBoundary = (character: string | undefined): boolean =>
  !character || /[\s.,!?;:()[\]{}<>]/.test(character);

export const parseMentionIds = (body: string, users: MentionCandidate[]): string[] => {
  const activeUsers = users
    .filter((user) => user.status !== 'inactive' && user.name.trim())
    .sort((a, b) => b.name.length - a.name.length);
  const lowerBody = body.toLocaleLowerCase();
  const mentionIds = new Set<string>();

  for (let index = lowerBody.indexOf('@'); index >= 0; index = lowerBody.indexOf('@', index + 1)) {
    if (index > 0 && /[\w@]/.test(lowerBody[index - 1])) continue;
    const afterAt = lowerBody.slice(index + 1);
    const match = activeUsers.find((user) => {
      const name = user.name.trim().toLocaleLowerCase();
      return afterAt.startsWith(name) && isMentionBoundary(afterAt[name.length]);
    });
    if (match) mentionIds.add(match.id);
  }

  return Array.from(mentionIds);
};

export const getMentionTrigger = (
  body: string,
  cursor = body.length,
  users: MentionCandidate[] = []
): MentionTrigger | null => {
  const prefix = body.slice(0, cursor);
  const start = prefix.lastIndexOf('@');
  if (start < 0 || (start > 0 && /[\w@]/.test(prefix[start - 1]))) return null;

  const query = prefix.slice(start + 1);
  if (query.length > 80 || /[\n\r,!?;:()[\]{}<>]/.test(query)) return null;
  const lowerQuery = query.toLocaleLowerCase();
  const completedMention = users.some((user) =>
    lowerQuery.startsWith(`${user.name.trim().toLocaleLowerCase()} `)
  );
  if (completedMention) return null;
  return { start, end: cursor, query };
};

export const insertMention = (
  body: string,
  trigger: MentionTrigger,
  name: string
): { body: string; cursor: number } => {
  const inserted = `@${name} `;
  return {
    body: `${body.slice(0, trigger.start)}${inserted}${body.slice(trigger.end)}`,
    cursor: trigger.start + inserted.length
  };
};

export const filterDiscussions = (threads: DiscussionThread[], filters: DiscussionFilters, currentUserId: string, projectNames: Record<string, string>, taskNames: Record<string, string>) => {
  const query = filters.search.trim().toLowerCase();
  return threads.filter((thread) => {
    const comments = thread.comments.map((comment) => comment.body).join(' ').toLowerCase();
    const matchesSearch = !query || [thread.title, comments, projectNames[thread.projectId] || '', taskNames[thread.taskId || ''] || ''].join(' ').toLowerCase().includes(query);
    const matchesDate = (!filters.from || thread.createdAt >= filters.from) && (!filters.to || thread.createdAt <= `${filters.to}T23:59:59.999Z`);
    return matchesSearch && (!filters.projectId || thread.projectId === filters.projectId) && (!filters.taskId || thread.taskId === filters.taskId) && (!filters.type || thread.type === filters.type) && (!filters.authorId || thread.creatorId === filters.authorId) && (!filters.state || (filters.state === 'resolved') === thread.resolved) && (!filters.mineOnly || thread.creatorId === currentUserId) && (!filters.mentionedOnly || thread.comments.some((comment) => comment.mentionIds.includes(currentUserId))) && matchesDate;
  }).sort((a, b) => filters.sort === 'oldest' ? a.createdAt.localeCompare(b.createdAt) : filters.sort === 'replies' ? b.comments.length - a.comments.length : filters.sort === 'newest' ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt));
};
