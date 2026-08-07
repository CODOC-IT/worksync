// Types for the Project Management Approval Workflow (Team Lead -> Admin). Mirrors the layering
// convention of project.types.ts: DB row shapes (lowercase columns, matching Postgres's unquoted
// identifier folding -- see database/25_project_approvals.sql) plus the DTO shape returned to
// the frontend.

export type ProjectApprovalRequestType =
  | 'PROJECT_CREATE'
  | 'PROJECT_EDIT'
  | 'PROJECT_ARCHIVE'
  | 'PROJECT_RESTORE'
  | 'PROJECT_DELETE'
  | 'PROJECT_PERMANENT_DELETE';

export type ProjectApprovalRequestStatus = 'Pending' | 'Approved' | 'Rejected';

export interface ProjectApprovalRequestRow {
  approvalrequestid: string;
  // A rejected creation removes its project, while the decision record is retained so its
  // rejection reason remains available to notification/history consumers.
  projectid: number | null;
  projecttitle: string;
  requesttype: ProjectApprovalRequestType;
  requestedbyuserid: number;
  requestedchangesjson: string | null;
  reason: string;
  requeststatus: ProjectApprovalRequestStatus;
  reviewedbyuserid: number | null;
  decisionreason: string | null;
  createdatutc: Date;
  decidedatutc: Date | null;
}

export interface ProjectApprovalRequestDTO {
  id: string;
  projectId: string;
  projectTitle: string;
  requestType: ProjectApprovalRequestType;
  requestedByUserId: string;
  requestedByName: string;
  requestedByRole?: string;
  requestedByEmail?: string;
  requestedChanges: Record<string, unknown> | null;
  reason: string;
  status: ProjectApprovalRequestStatus;
  reviewedByUserId?: string;
  reviewedByName?: string;
  decisionReason?: string;
  createdAt: string;
  decidedAt?: string;
}
