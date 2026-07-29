import {
  NotificationAnalyticsRow,
  NotificationItem,
  NotificationPreferences,
  NotificationPriority,
  NotificationType,
  UserNotificationAnalyticsRow,
  UserNotificationCategoryBreakdown
} from '../../types';

// ---------------------------------------------------------------------------------------
// notificationApiClient — thin fetch wrapper over the backend's /api/notifications REST
// surface (backend/src/notifications/notification.routes.ts). Mirrors the exact apiFetch
// convention already established in features/ai-assistant/AIAssistantView.tsx (Bearer token
// from localStorage, JSON body, `{ success, data }` envelope) so this module doesn't invent a
// second HTTP calling style.
//
// This is the only file in the frontend that knows the notification REST API's URL shapes.
// AppContext.tsx calls these functions and falls back to the pre-existing local, in-memory
// notificationService.ts logic whenever a call fails (no backend running, no DATABASE_URL
// configured, network error) — see AppContext's dispatchNotifications for that fallback. That
// keeps the app fully usable without a live Postgres instance, exactly as it was before this
// module gained a backend, while preferring real persistence whenever it's reachable.
// ---------------------------------------------------------------------------------------

const API_BASE = '/api/notifications';

async function apiFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('worksync_auth_token');
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers
    }
  });

  let json: any;
  try {
    json = await res.json();
  } catch {
    const text = await res.text().catch(() => '');
    throw new Error(
      text
        ? `Server error (${res.status}): ${text.slice(0, 200)}`
        : `Server returned ${res.status} with empty body. Is the backend running?`
    );
  }
  if (!json.success) {
    if (res.status === 401) {
      throw new Error('Session expired. Please log out and log in again.');
    }
    throw new Error(json.message || `Request failed (${res.status})`);
  }
  return json;
}

export interface PublishNotificationEventInput {
  type: NotificationType;
  title: string;
  message: string;
  recipientMessages?: Record<string, string>;
  recipientIds: string[];
  actorId?: string;
  projectId?: string;
  taskId?: string;
  priority?: NotificationPriority;
}

// The API's DbPriority vocabulary spells the middle tier "Normal"; the frontend has always
// called it "Medium" (see frontend/src/types/index.ts's NotificationPriority) — converted here
// so nothing else in the app has to know the backend uses different wording.
const API_PRIORITY_TO_DB: Record<NotificationPriority, string> = {
  Critical: 'Critical',
  High: 'High',
  Medium: 'Normal',
  Low: 'Low'
};

export const publishNotificationEvent = async (
  input: PublishNotificationEventInput
): Promise<NotificationItem[]> => {
  const { data } = await apiFetch<{ data: NotificationItem[] }>('', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      priority: input.priority ? API_PRIORITY_TO_DB[input.priority] : undefined
    })
  });
  return data;
};

export interface FetchNotificationsFilters {
  unreadOnly?: boolean;
  type?: NotificationType;
  priority?: NotificationPriority;
  search?: string;
  page?: number;
  pageSize?: number;
}

export const fetchNotifications = async (
  filters: FetchNotificationsFilters = {}
): Promise<{ items: NotificationItem[]; total: number }> => {
  const params = new URLSearchParams();
  if (filters.unreadOnly) params.set('unreadOnly', 'true');
  if (filters.type) params.set('type', filters.type);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.search) params.set('search', filters.search);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  const qs = params.toString();

  const result = await apiFetch<{ data: NotificationItem[]; total: number }>(qs ? `?${qs}` : '');
  return { items: result.data, total: result.total };
};

export const fetchUnreadNotifications = async (): Promise<NotificationItem[]> => {
  const { data } = await apiFetch<{ data: NotificationItem[] }>('/unread');
  return data;
};

export const fetchNotificationPreferences = async (): Promise<NotificationPreferences> => {
  const { data } = await apiFetch<{ data: NotificationPreferences }>('/preferences');
  return data;
};

export const updateNotificationPreferencesApi = async (
  patch: Partial<NotificationPreferences>
): Promise<NotificationPreferences> => {
  const { data } = await apiFetch<{ data: NotificationPreferences }>('/preferences', {
    method: 'PUT',
    body: JSON.stringify(patch)
  });
  return data;
};

export const markNotificationReadApi = async (id: string): Promise<void> => {
  await apiFetch(`/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
};

export const markAllNotificationsReadApi = async (): Promise<number> => {
  const result = await apiFetch<{ message: string }>('/read-all', { method: 'PATCH' });
  const match = /^(\d+)/.exec(result.message || '');
  return match ? Number(match[1]) : 0;
};

export const clearNotificationApi = async (id: string): Promise<void> => {
  await apiFetch(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
};

export const clearAllNotificationsApi = async (): Promise<number> => {
  const result = await apiFetch<{ message: string }>('/clear', { method: 'DELETE' });
  const match = /^(\d+)/.exec(result.message || '');
  return match ? Number(match[1]) : 0;
};

// "Remind me later" — hides the notification until `untilIso` passes (see
// backend/src/notifications/notification.repository.ts's SnoozedUntilUtc column).
export const snoozeNotificationApi = async (id: string, untilIso: string): Promise<void> => {
  await apiFetch(`/${encodeURIComponent(id)}/snooze`, {
    method: 'PATCH',
    body: JSON.stringify({ until: untilIso })
  });
};

// Admin-only delivery analytics (read rates / suppressed counts per notification type).
export const fetchNotificationAnalytics = async (): Promise<NotificationAnalyticsRow[]> => {
  const { data } = await apiFetch<{ data: NotificationAnalyticsRow[] }>('/analytics');
  return data;
};

export interface FetchUserAnalyticsFilters {
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'total' | 'readRate' | 'name';
}

// Admin-only per-user analytics — who received/read what, and their read rate. Search/sort/
// pagination are all server-side (see notification.repository.ts's getUserAnalyticsList) since
// this is meant to scale to the whole org roster, not just whatever's already loaded client-side.
export const fetchUserNotificationAnalytics = async (
  filters: FetchUserAnalyticsFilters = {}
): Promise<{ items: UserNotificationAnalyticsRow[]; total: number }> => {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
  if (filters.sortBy) params.set('sortBy', filters.sortBy);
  const qs = params.toString();

  const result = await apiFetch<{ data: UserNotificationAnalyticsRow[]; total: number }>(
    `/analytics/users${qs ? `?${qs}` : ''}`
  );
  return { items: result.data, total: result.total };
};

// Admin-only drill-down: one user's full category/type read breakdown (their "interest").
export const fetchUserNotificationAnalyticsDetail = async (
  userId: string
): Promise<UserNotificationCategoryBreakdown[]> => {
  const { data } = await apiFetch<{ data: UserNotificationCategoryBreakdown[] }>(
    `/analytics/users/${encodeURIComponent(userId)}`
  );
  return data;
};
