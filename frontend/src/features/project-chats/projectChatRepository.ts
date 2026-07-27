import { DiscussionComment, DiscussionThread } from './projectChatTypes';

const token = () => localStorage.getItem('worksync_auth_token');
const headers = () => ({ 'Content-Type': 'application/json' });

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const accessToken = token();
  if (!accessToken) {
    throw new Error('Your session has expired. Please sign in again before using Project Chats.');
  }
  const requestHeaders = new Headers(init?.headers);
  requestHeaders.set('Authorization', `Bearer ${accessToken}`);
  const response = await fetch(`/api/project-chats${path}`, {
    ...init,
    headers: requestHeaders
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.success) {
    const apiMessage = typeof payload.message === 'string' ? payload.message : '';
    const expiredSession = /invalid|expired|authorization header|required|not authenticated/i.test(apiMessage);
    if (expiredSession) localStorage.removeItem('worksync_auth_token');
    const message = expiredSession
      ? 'Your session has expired. Please sign in again, then return to Project Chats.'
      : response.status === 404
      ? 'Project Chats is not available from the current backend. Restart the backend, then try again.'
      : response.status === 401 || response.status === 403
        ? apiMessage || 'You do not have permission to perform this action in this discussion.'
        : apiMessage || 'We could not save your discussion. Please try again.';
    const error = new Error(message) as Error & { fieldErrors?: Record<string, string> };
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
