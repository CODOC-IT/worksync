import { ActivityFilters, ActivityItem } from './activityTypes';

const token = () => localStorage.getItem('worksync_auth_token');
const authHeaders = (): HeadersInit => ({ Authorization: `Bearer ${token() || ''}` });

const responseError = async (response: Response, fallback: string): Promise<Error> => {
  const data = await response.json().catch(() => ({}));
  return new Error(typeof data.message === 'string' ? data.message : fallback);
};

const dateBounds = (filters: ActivityFilters): { from?: string; to?: string } => {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (filters.datePreset === 'All') return {};
  if (filters.datePreset === 'Custom') return {
    from: filters.customFrom ? new Date(`${filters.customFrom}T00:00:00`).toISOString() : undefined,
    to: filters.customTo ? new Date(`${filters.customTo}T23:59:59.999`).toISOString() : undefined
  };
  if (filters.datePreset === 'Yesterday') {
    start.setDate(start.getDate() - 1);
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  if (filters.datePreset === 'Last 7 Days') start.setDate(start.getDate() - 6);
  if (filters.datePreset === 'Last 30 Days') start.setDate(start.getDate() - 29);
  return { from: start.toISOString(), to: now.toISOString() };
};

export const toActivityQuery = (filters: ActivityFilters, page: number, pageSize: number): URLSearchParams => {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort: filters.sort });
  const values: Record<string, string | boolean | undefined> = {
    ...dateBounds(filters),
    userId: filters.userId,
    userRole: filters.userRole,
    projectId: filters.projectId,
    taskId: filters.taskId,
    module: filters.module,
    action: filters.action,
    entityType: filters.entityType,
    status: filters.status,
    priority: filters.priority,
    result: filters.result,
    source: filters.source,
    search: filters.search.trim(),
    changedField: filters.changedField.trim(),
    myActivityOnly: filters.myActivityOnly || undefined,
    importantOnly: filters.importantOnly || undefined,
    hasAttachments: filters.hasAttachments || undefined,
    hasMentions: filters.hasMentions || undefined,
    deletedOnly: filters.deletedOnly || undefined,
    failedOrBlockedOnly: filters.failedOrBlockedOnly || undefined,
    hrActivityOnly: filters.hrActivityOnly || undefined,
  };
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return params;
};

export const fetchActivities = async (
  filters: ActivityFilters,
  page: number,
  pageSize = 20,
  signal?: AbortSignal
): Promise<{ items: ActivityItem[]; total: number; totalPages: number; page: number }> => {
  const response = await fetch(`/api/activity?${toActivityQuery(filters, page, pageSize)}`, {
    headers: authHeaders(),
    signal,
  });
  if (!response.ok) throw await responseError(response, 'Could not load activity.');
  const data = await response.json();
  return {
    items: Array.isArray(data.items) ? data.items : [],
    total: Number(data.total) || 0,
    totalPages: Number(data.totalPages) || 1,
    page: Number(data.page) || page,
  };
};

export const fetchActivity = async (id: string, signal?: AbortSignal): Promise<ActivityItem> => {
  const response = await fetch(`/api/activity/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
    signal,
  });
  if (!response.ok) throw await responseError(response, 'Could not load activity details.');
  const data = await response.json();
  if (!data.item) throw new Error('Activity details were not returned by the server.');
  return data.item as ActivityItem;
};

const downloadBlob = async (url: string, filename: string): Promise<void> => {
  const response = await fetch(url, { headers: authHeaders() });
  if (!response.ok) throw await responseError(response, 'Could not export activity.');

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
};

export const downloadActivityCsv = async (filters: ActivityFilters): Promise<void> => {
  return downloadBlob(
    `/api/activity/export?${toActivityQuery(filters, 1, 5000)}`,
    `worksync-activity-${new Date().toISOString().slice(0, 10)}.csv`
  );
};

export const downloadActivityPdf = async (filters: ActivityFilters): Promise<void> => {
  return downloadBlob(
    `/api/activity/export/pdf?${toActivityQuery(filters, 1, 5000)}`,
    `worksync-activity-${new Date().toISOString().slice(0, 10)}.pdf`
  );
};
