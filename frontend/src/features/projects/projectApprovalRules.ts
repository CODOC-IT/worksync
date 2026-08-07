import type { ProjectApprovalRequest } from '../../types';

export const newestProjectRequestsFirst = (
  requests: ProjectApprovalRequest[]
): ProjectApprovalRequest[] =>
  [...requests].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
  );

export const countPendingProjectRequests = (
  requests: ProjectApprovalRequest[]
): number => requests.filter((request) => request.status === 'Pending').length;

