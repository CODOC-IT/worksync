import { ActivityFilters, ActivityItem } from './activityTypes';

const token = () => localStorage.getItem('worksync_auth_token');

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
    const end = new Date(start); end.setHours(23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  if (filters.datePreset === 'Last 7 Days') start.setDate(start.getDate() - 6);
  if (filters.datePreset === 'Last 30 Days') start.setDate(start.getDate() - 29);
  return { from: start.toISOString(), to: now.toISOString() };
};

export const toActivityQuery = (filters: ActivityFilters, page: number, pageSize: number): URLSearchParams => {
  const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort: filters.sort });
  const values: Record<string, string | boolean | undefined> = {
    ...dateBounds(filters), userId: filters.userId, userRole: filters.userRole,
    projectId: filters.projectId, taskId: filters.taskId, module: filters.module,
    action: filters.action, entityType: filters.entityType, status: filters.status,
    priority: filters.priority, result: filters.result, source: filters.source,
    search: filters.search.trim(), myActivityOnly: filters.myActivityOnly || undefined,
    importantOnly: filters.importantOnly || undefined
  };
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return params;
};

export const fetchActivities = async (filters: ActivityFilters, page: number, pageSize = 20): Promise<{
  items: ActivityItem[]; total: number; totalPages: number; page: number;
}> => {
  const response = await fetch(`/api/activity?${toActivityQuery(filters, page, pageSize)}`, {
    headers: { Authorization: `Bearer ${token() || ''}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Could not load the activity log.');
  return data;
};

export const downloadActivityCsv = async (filters: ActivityFilters): Promise<void> => {
  const response = await fetch(`/api/activity/export?${toActivityQuery(filters, 1, 100)}`, {
    headers: { Authorization: `Bearer ${token() || ''}` }
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'Could not export activity.');
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `worksync-activity-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
};

