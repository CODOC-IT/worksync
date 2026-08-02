import { ProjectApprovalRequestType } from './projectApproval.types.js';

export const getProjectUpdateApprovalType = (
  status: string | undefined
): ProjectApprovalRequestType => status === 'Archived' ? 'PROJECT_ARCHIVE' : 'PROJECT_EDIT';

// The Team Lead "Archive" action (DELETE /api/projects/:id -- soft-delete/archive of an Active
// project, see project.controller.ts's archiveProject) creates a PROJECT_ARCHIVE request.
// Permanent deletion of an already-Archived project uses its own distinct
// 'PROJECT_PERMANENT_DELETE' type (there is no separate "delete" approval type -- ProjectApprovalRequestType
// only has PROJECT_EDIT/PROJECT_ARCHIVE/PROJECT_RESTORE/PROJECT_PERMANENT_DELETE).
export const PROJECT_ARCHIVE_APPROVAL_TYPE: ProjectApprovalRequestType = 'PROJECT_ARCHIVE';
