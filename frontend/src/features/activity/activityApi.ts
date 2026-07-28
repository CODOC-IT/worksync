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

const MOCK_ACTORS = [
  { id: 'user-1', name: 'Alice Chen', email: 'alice@worksync.dev', role: 'Admin' },
  { id: 'user-2', name: 'Bob Martinez', email: 'bob@worksync.dev', role: 'Team_Member' },
  { id: 'user-3', name: 'Carol Smith', email: 'carol@worksync.dev', role: 'Team_Lead' },
  { id: 'user-4', name: 'Dave Johnson', email: 'dave@worksync.dev', role: 'HR' },
  { id: 'user-5', name: 'Eve Williams', email: 'eve@worksync.dev', role: 'Team_Member' },
];
const MOCK_MODULES = ['Projects', 'Tasks', 'Attendance', 'Permissions', 'Authentication', 'Project Chats', 'Kanban', 'Calendar', 'Approvals', 'HR', 'AI Assistant', 'Activity Log'];
const MOCK_ACTIONS = ['Created', 'Updated', 'Deleted', 'Assigned', 'Status Changed', 'Approved', 'Rejected', 'Checked In', 'Checked Out', 'Permission Granted', 'Login', 'Logout', 'Exported'];
const MOCK_ENTITIES = ['Project', 'Task', 'Attendance Record', 'Permission', 'User'];

const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const makeMockItem = (id: number): ActivityItem => {
  const actor = pick(MOCK_ACTORS);
  const module = pick(MOCK_MODULES);
  const action = pick(MOCK_ACTIONS);
  const entityType = pick(MOCK_ENTITIES);
  const timestamp = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString();
  return {
    id: String(id), correlationId: `corr-${id}-${Date.now()}`,
    actor: { id: actor.id, name: actor.name, email: actor.email, role: actor.role },
    action, module, entityType,
    entityId: `entity-${id}`, entityName: `${entityType} #${id}`,
    description: `${actor.name} ${action.toLowerCase()} ${entityType.toLowerCase()} #${id}`,
    timestamp, result: pick(['Successful', 'Successful', 'Successful', 'Failed']),
    source: pick(['Web', 'API', 'System']), important: Math.random() < 0.1,
    isNew: Date.now() - new Date(timestamp).getTime() < 5 * 60 * 1000,
    changes: Math.random() < 0.6
      ? [{ field: pick(['status', 'priority', 'assignee', 'title']), previousValue: 'Old value', newValue: 'New value' }]
      : [],
    metadata: {},
    project: module === 'Projects' ? { id: `proj-${id}`, name: `Project ${id}` } : undefined,
    task: module === 'Tasks' ? { id: `task-${id}`, name: `Task ${id}` } : undefined,
  };
};

const TOTAL_MOCK = 45;
const ALL_MOCK_ITEMS: ActivityItem[] = Array.from({ length: TOTAL_MOCK }, (_, i) => makeMockItem(i + 1));

const filterMock = (items: ActivityItem[], filters: ActivityFilters, page: number, pageSize: number) => {
  let filtered = [...items];
  if (filters.module) filtered = filtered.filter((i) => i.module === filters.module);
  if (filters.action) filtered = filtered.filter((i) => i.action === filters.action);
  if (filters.result) filtered = filtered.filter((i) => i.result === filters.result);
  if (filters.source) filtered = filtered.filter((i) => i.source === filters.source);
  if (filters.entityType) filtered = filtered.filter((i) => i.entityType === filters.entityType);
  if (filters.userId) filtered = filtered.filter((i) => i.actor.id === filters.userId);
  if (filters.myActivityOnly) filtered = filtered.filter((i) => i.actor.id === '__current__');
  if (filters.importantOnly) filtered = filtered.filter((i) => i.important);
  if (filters.search) {
    const q = filters.search.toLowerCase();
    filtered = filtered.filter((i) =>
      i.actor.name.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.entityName.toLowerCase().includes(q) ||
      i.module.toLowerCase().includes(q)
    );
  }
  filtered.sort((a, b) => filters.sort === 'oldest'
    ? new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    : new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return { items: filtered.slice(start, start + pageSize), total, totalPages, page };
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
  if (response.ok) {
    const data = await response.json().catch(() => ({}));
    if (data.items) return data;
  }
  return filterMock(ALL_MOCK_ITEMS, filters, page, pageSize);
};

const downloadBlob = async (url: string, filename: string): Promise<void> => {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token() || ''}` } });
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
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(objectUrl);
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

