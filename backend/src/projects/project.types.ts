// Domain types + DTOs for the Project Module backend. Duplicated from the frontend on purpose —
// separate TypeScript projects with no shared package, same convention as
// backend/src/notifications/notification.types.ts.

export type ProjectStatusCode = 'Draft' | 'PendingActivation' | 'Active' | 'OnHold' | 'Completed' | 'Archived';
export type ProjectPriorityCode = 'Low' | 'Medium' | 'High' | 'Critical';
export type ProjectMemberRoleCode = 'Owner' | 'TeamLead' | 'Member' | 'Reviewer' | 'Observer';

// Frontend vocabulary (frontend/src/types/index.ts) — differs from the DB's in two spots:
// PendingActivation -> 'Pending Approval', and priority 'Critical' -> 'Urgent' (matching the
// exact precedent already established by frontend/src/features/tasks/taskRepository.ts and
// database/18_notify_seed.sql for the same two conversions elsewhere in this app).
export type ApiProjectStatus = 'Draft' | 'Active' | 'On Hold' | 'Archived' | 'Pending Approval' | 'Completed';
export type ApiProjectPriority = 'Low' | 'Medium' | 'High' | 'Urgent';

export const DB_TO_API_PROJECT_STATUS: Record<ProjectStatusCode, ApiProjectStatus> = {
  Draft: 'Draft',
  PendingActivation: 'Pending Approval',
  Active: 'Active',
  OnHold: 'On Hold',
  Completed: 'Completed',
  Archived: 'Archived'
};

export const API_TO_DB_PROJECT_STATUS: Record<ApiProjectStatus, ProjectStatusCode> = {
  Draft: 'Draft',
  'Pending Approval': 'PendingActivation',
  Active: 'Active',
  'On Hold': 'OnHold',
  Completed: 'Completed',
  Archived: 'Archived'
};

export const DB_TO_API_PRIORITY: Record<ProjectPriorityCode, ApiProjectPriority> = {
  Low: 'Low',
  Medium: 'Medium',
  High: 'High',
  Critical: 'Urgent'
};

export const API_TO_DB_PRIORITY: Record<ApiProjectPriority, ProjectPriorityCode> = {
  Low: 'Low',
  Medium: 'Medium',
  High: 'High',
  Urgent: 'Critical'
};

// Row shapes returned by the repository's raw SQL (lowercase columns — Postgres folds unquoted
// identifiers, matching every other table in database/*.sql).
export interface ProjectRow {
  projectid: number;
  projectcode: string;
  projectname: string;
  description: string;
  owneruserid: number;
  statuscode: ProjectStatusCode;
  prioritycode: ProjectPriorityCode;
  startdate: string;
  enddate: string;
  createdbyuserid: number;
  creationreason: string | null;
  archivedatutc: Date | null;
  archivedbyuserid: number | null;
  archivereason: string | null;
  createdatutc: Date;
  updatedatutc: Date;
  rowversion: string;
}

export interface ProjectMemberRow {
  projectid: number;
  userid: number;
  memberrolecode: ProjectMemberRoleCode;
}

// Shape returned to the frontend — matches frontend/src/types/index.ts's Project (minus
// milestones/files/pinnedMessagesCount, which stay frontend-only/mock for now; not part of
// this branch's scope).
export interface ProjectDTO {
  id: string;
  code: string;
  title: string;
  description: string;
  status: ApiProjectStatus;
  approvalStatus: 'Approved' | 'Pending Approval' | 'Rejected';
  createdBy: string;
  teamLeadId: string;
  memberIds: string[];
  startDate: string;
  targetDate: string;
  priority: ApiProjectPriority;
  progress: number;
  tags: string[];
  creationReason?: string;
}

export interface CreateProjectInput {
  title: string;
  description: string;
  priority: ApiProjectPriority;
  startDate: string;
  targetDate: string;
  teamLeadId?: string;
  memberIds?: string[];
  creationReason?: string;
}

export interface UpdateProjectInput {
  title?: string;
  description?: string;
  priority?: ApiProjectPriority;
  startDate?: string;
  targetDate?: string;
  status?: ApiProjectStatus;
}
