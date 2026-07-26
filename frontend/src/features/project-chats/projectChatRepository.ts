import { DiscussionComment, DiscussionThread } from './projectChatTypes';

const token = () => localStorage.getItem('worksync_auth_token');
const headers = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/project-chats${path}`, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    const error = new Error(payload.message || 'The discussion service could not complete this request.') as Error & { fieldErrors?: Record<string, string> };
    error.fieldErrors = payload.fieldErrors;
    throw error;
  }
  return payload.data as T;
};

export const loadDiscussionThreads = () => request<DiscussionThread[]>('/');
export const createDiscussion = (data: object) => request<DiscussionThread>('/', { method: 'POST', headers: headers(), body: JSON.stringify(data) });
export const addDiscussionComment = (threadId: string, data: object) => request<DiscussionComment>(`/${threadId}/comments`, { method: 'POST', headers: headers(), body: JSON.stringify(data) });
export const editDiscussionComment = (commentId: string, body: string) => request<DiscussionComment>(`/comments/${commentId}`, { method: 'PATCH', headers: headers(), body: JSON.stringify({ body }) });
export const deleteDiscussionComment = (commentId: string) => request<DiscussionComment>(`/comments/${commentId}`, { method: 'DELETE', headers: headers() });
export const setDiscussionResolved = (threadId: string, resolved: boolean) => request<DiscussionThread>(`/${threadId}/resolution`, { method: 'POST', headers: headers(), body: JSON.stringify({ resolved }) });
