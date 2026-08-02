export type ActivityResult = 'Successful' | 'Failed' | 'Blocked';
export type ActivitySource = 'Web' | 'API' | 'System';

export interface ActivityChange {
  field: string;
  previousValue: string | null;
  newValue: string | null;
}

export interface ActivityRecordInput {
  actorId?: string | null;
  actorName?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  affectedUserId?: string | null;
  affectedUserName?: string | null;
  action: string;
  module: string;
  entityType: string;
  entityId: string;
  entityName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  taskId?: string | null;
  taskName?: string | null;
  description: string;
  reason?: string | null;
  result?: ActivityResult;
  source?: ActivitySource;
  important?: boolean;
  linkRoute?: string | null;
  ipAddress?: string | null;
  correlationId?: string;
  changes?: ActivityChange[];
  metadata?: Record<string, unknown>;
}

export interface ActivityFilters {
  from?: string;
  to?: string;
  userId?: string;
  userRole?: string;
  projectId?: string;
  taskId?: string;
  module?: string;
  action?: string;
  entityType?: string;
  status?: string;
  priority?: string;
  result?: ActivityResult;
  source?: ActivitySource;
  search?: string;
  myActivityOnly?: boolean;
  importantOnly?: boolean;
  changedField?: string;
  hasAttachments?: boolean;
  hasMentions?: boolean;
  deletedOnly?: boolean;
  failedOrBlockedOnly?: boolean;
  hrActivityOnly?: boolean;
  // Led Project Activity tab: restrict the feed to the viewer's led projects and
  // events performed by current members of those projects only.
  ledActivityOnly?: boolean;
  sort?: 'newest' | 'oldest';
  page: number;
  pageSize: number;
}

export interface ActivityDTO {
  id: string;
  correlationId: string;
  actor: { id: string | null; name: string; email: string; role: string };
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
