export type ActivityResult = 'Successful' | 'Failed' | 'Blocked';
export type ActivitySource = 'Web' | 'API' | 'System';

export interface ActivityChange {
  field: string;
  previousValue: string | null;
  newValue: string | null;
}

export interface ActivityItem {
  id: string;
  correlationId: string;
  actor: { id: string | null; name: string; email: string; avatar?: string; role: string };
  affectedUser?: { id: string | null; name: string };
  action: string;
  module: string;
  entityType: string;
  entityId: string;
  entityName: string;
  description: string;
  project?: { id: string; name: string };
  task?: { id: string; name: string };
  timestamp: string;
  result: ActivityResult;
  source: ActivitySource;
  important: boolean;
  reason?: string;
  linkRoute?: string;
  ipAddress?: string;
  changes: ActivityChange[];
  metadata: Record<string, unknown>;
  isNew: boolean;
}

export interface ActivityFilters {
  datePreset: 'Today' | 'Yesterday' | 'Last 7 Days' | 'Last 30 Days' | 'Custom' | 'All';
  customFrom: string;
  customTo: string;
  userId: string;
  userRole: string;
  projectId: string;
  taskId: string;
  module: string;
  action: string;
  entityType: string;
  status: string;
  priority: string;
  result: string;
  source: string;
  search: string;
  myActivityOnly: boolean;
  importantOnly: boolean;
  sort: 'newest' | 'oldest';
}

export const EMPTY_ACTIVITY_FILTERS: ActivityFilters = {
  datePreset: 'Last 30 Days', customFrom: '', customTo: '', userId: '', userRole: '',
  projectId: '', taskId: '', module: '', action: '', entityType: '', status: '',
  priority: '', result: '', source: '', search: '', myActivityOnly: false,
  importantOnly: false, sort: 'newest'
};

