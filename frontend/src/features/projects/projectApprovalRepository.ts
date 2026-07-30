import { ProjectApprovalRequest } from '../../types';

// ---------------------------------------------------------------------------------------
// projectApprovalApiClient — thin fetch wrapper over /api/projects/approval-requests
// (backend/src/projects/projectApproval.routes.ts). Mirrors the exact apiFetch convention
// already established in projectRepository.ts.
// ---------------------------------------------------------------------------------------

const API_BASE = '/api/projects/approval-requests';

async function apiFetch<T = any>(path: string, options?: RequestInit): Promise<T> {
  const token = localStorage.getItem('worksync_auth_token');
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers
    }
  });

  let json: any;
  try {
    json = await res.json();
  } catch {
    const text = await res.text().catch(() => '');
    throw new Error(
      text
        ? `Server error (${res.status}): ${text.slice(0, 200)}`
        : `Server returned ${res.status} with empty body. Is the backend running?`
    );
  }
  if (!json.success) {
    if (res.status === 401) throw new Error('Session expired. Please log out and log in again.');
    throw new Error(json.message || `Request failed (${res.status})`);
  }
  return json;
}

// Admin's Approval Inbox — every Pending project approval request.
export const fetchPendingProjectApprovals = async (): Promise<ProjectApprovalRequest[]> => {
  const { data } = await apiFetch<{ data: ProjectApprovalRequest[] }>('');
  return data;
};

// The calling Team Lead's own submitted requests (any status).
export const fetchMyProjectApprovalRequests = async (): Promise<ProjectApprovalRequest[]> => {
  const { data } = await apiFetch<{ data: ProjectApprovalRequest[] }>('/mine');
  return data;
};

export const approveProjectApprovalRequestApi = async (
  id: string,
  reason?: string
): Promise<ProjectApprovalRequest> => {
  const { data } = await apiFetch<{ data: ProjectApprovalRequest }>(`/${encodeURIComponent(id)}/approve`, {
    method: 'PATCH',
    body: JSON.stringify({ reason })
  });
  return data;
};

export const rejectProjectApprovalRequestApi = async (
  id: string,
  reason?: string
): Promise<ProjectApprovalRequest> => {
  const { data } = await apiFetch<{ data: ProjectApprovalRequest }>(`/${encodeURIComponent(id)}/reject`, {
    method: 'PATCH',
    body: JSON.stringify({ reason })
  });
  return data;
};
