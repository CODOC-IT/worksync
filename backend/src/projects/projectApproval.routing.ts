import { ProjectApprovalRequestType } from './projectApproval.types.js';

export const getProjectUpdateApprovalType = (
  status: string | undefined
): ProjectApprovalRequestType => status === 'Archived' ? 'PROJECT_ARCHIVE' : 'PROJECT_EDIT';

export const PROJECT_DELETE_APPROVAL_TYPE: ProjectApprovalRequestType = 'PROJECT_DELETE';
