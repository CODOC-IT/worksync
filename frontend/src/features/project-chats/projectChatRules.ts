import { DiscussionFilters, DiscussionThread } from './projectChatTypes';

export const parseMentionIds = (body: string, users: { id: string; name: string; status: string }[]) => {
  const names = new Set(Array.from(body.matchAll(/@([\w .'-]+)/g)).map((match) => match[1].trim().toLowerCase()));
  return users.filter((user) => user.status !== 'inactive' && names.has(user.name.toLowerCase())).map((user) => user.id);
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
