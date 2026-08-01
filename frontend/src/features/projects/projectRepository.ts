import { Milestone, Project, ProjectApprovalRequest, ProjectFile, User } from '../../types';

// ---------------------------------------------------------------------------------------
// projectApiClient — thin fetch wrapper over /api/projects (backend/src/projects/project.routes.ts).
// Mirrors the exact apiFetch convention already established in features/ai-assistant and
// features/notifications (Bearer token from localStorage, `{ success, data }` envelope).
//
// Unlike notificationApiClient.ts, there is no local-state fallback here on purpose: per this
// module's spec, the Project/Board/Task backend is the single source of truth and a failed API
// call must never be silently treated as success. Callers (AppContext) surface the thrown error
// as a real, retryable failure — they do not update local state on a rejected promise.
// ---------------------------------------------------------------------------------------

const API_BASE = '/api/projects';

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

export const fetchProjects = async (): Promise<Project[]> => {
  const { data } = await apiFetch<{ data: Project[] }>('');
  return data;
};

export const fetchProject = async (id: string): Promise<Project> => {
  const { data } = await apiFetch<{ data: Project }>(`/${encodeURIComponent(id)}`);
  return data;
};

export type ProjectMemberSummary = Pick<
  User,
  'id' | 'name' | 'role' | 'department' | 'title' | 'status'
>;

export interface ProjectMemberDirectory {
  teamLeadId: string;
  memberIds: string[];
  members: ProjectMemberSummary[];
}

export const fetchProjectMemberDirectory = async (id: string): Promise<ProjectMemberDirectory> => {
  const { data } = await apiFetch<{ data: ProjectMemberDirectory }>(
    `/${encodeURIComponent(id)}/members`
  );
  return data;
};

export interface CreateProjectPayload {
  title: string;
  description: string;
  priority: Project['priority'];
  startDate: string;
  targetDate: string;
  teamLeadId?: string;
  memberIds?: string[];
  creationReason?: string;
}

export const createProjectApi = async (payload: CreateProjectPayload): Promise<Project> => {
  const { data } = await apiFetch<{ data: Project }>('', { method: 'POST', body: JSON.stringify(payload) });
  return data;
};

export interface UpdateProjectPayload {
  title?: string;
  description?: string;
  priority?: Project['priority'];
  startDate?: string;
  targetDate?: string;
  status?: Project['status'];
  teamLeadId?: string;
  creationReason?: string;
  // Approval-request reason, only meaningful (and required) when the caller is a Team Lead --
  // see backend/src/projects/project.controller.ts's updateProject. Ignored for Admin's direct
  // edits, which apply immediately as before.
  reason?: string;
}

// Every gated action (Edit/Archive/Restore/Permanent Delete) now returns one of two shapes,
// distinguished by `pendingApproval`: an Admin's call executes immediately and returns the
// resulting `project` (or nothing, for archive/restore/permanent-delete which never returned
// project data even before this change); a Team Lead's call instead creates a request and
// returns it as `approvalRequest`, with the underlying project left untouched. See
// backend/src/projects/projectApproval.service.ts for the workflow this mirrors.
export interface ProjectActionResult {
  pendingApproval: boolean;
  message: string;
  project?: Project;
  approvalRequest?: ProjectApprovalRequest;
}

export const updateProjectApi = async (id: string, payload: UpdateProjectPayload): Promise<ProjectActionResult> => {
  const response = await apiFetch<{
    pendingApproval?: boolean; message: string; data: Project | ProjectApprovalRequest;
  }>(`/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) });
  return response.pendingApproval
    ? { pendingApproval: true, message: response.message, approvalRequest: response.data as ProjectApprovalRequest }
    : { pendingApproval: false, message: response.message, project: response.data as Project };
};

export const archiveProjectApi = async (id: string, reason: string): Promise<ProjectActionResult> => {
  const response = await apiFetch<{
    pendingApproval?: boolean; message: string; data?: ProjectApprovalRequest;
  }>(`/${encodeURIComponent(id)}`, { method: 'DELETE', body: JSON.stringify({ reason }) });
  return response.pendingApproval
    ? { pendingApproval: true, message: response.message, approvalRequest: response.data }
    : { pendingApproval: false, message: response.message };
};

export const permanentlyDeleteProjectApi = async (id: string, reason?: string): Promise<ProjectActionResult> => {
  const response = await apiFetch<{
    pendingApproval?: boolean; message: string; data?: ProjectApprovalRequest;
  }>(`/${encodeURIComponent(id)}/permanent`, { method: 'DELETE', body: JSON.stringify({ reason }) });
  return response.pendingApproval
    ? { pendingApproval: true, message: response.message, approvalRequest: response.data }
    : { pendingApproval: false, message: response.message };
};

export const restoreProjectApi = async (id: string, reason?: string): Promise<ProjectActionResult> => {
  const response = await apiFetch<{
    pendingApproval?: boolean; message: string; data?: ProjectApprovalRequest;
  }>(`/${encodeURIComponent(id)}/restore`, { method: 'POST', body: JSON.stringify({ reason }) });
  return response.pendingApproval
    ? { pendingApproval: true, message: response.message, approvalRequest: response.data }
    : { pendingApproval: false, message: response.message };
};

export const addProjectMemberApi = async (
  id: string,
  userId: string,
  role?: 'Owner' | 'TeamLead' | 'Member' | 'Reviewer' | 'Observer'
): Promise<Project> => {
  const { data } = await apiFetch<{ data: Project }>(`/${encodeURIComponent(id)}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId, role })
  });
  return data;
};

export const removeProjectMemberApi = async (id: string, userId: string, reason?: string): Promise<Project> => {
  const { data } = await apiFetch<{ data: Project }>(
    `/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
    { method: 'DELETE', body: JSON.stringify({ reason }) }
  );
  return data;
};

export interface CreateMilestonePayload {
  title: string;
  dueDate: string;
}

export interface UpdateMilestonePayload {
  title?: string;
  dueDate?: string;
}

export const addMilestoneApi = async (projectId: string, payload: CreateMilestonePayload): Promise<Milestone> => {
  const { data } = await apiFetch<{ data: Milestone }>(`/${encodeURIComponent(projectId)}/milestones`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return data;
};

export const updateMilestoneApi = async (
  projectId: string,
  milestoneId: string,
  payload: UpdateMilestonePayload
): Promise<Milestone> => {
  const { data } = await apiFetch<{ data: Milestone }>(
    `/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestoneId)}`,
    { method: 'PATCH', body: JSON.stringify(payload) }
  );
  return data;
};

export const deleteMilestoneApi = async (projectId: string, milestoneId: string): Promise<void> => {
  await apiFetch(`/${encodeURIComponent(projectId)}/milestones/${encodeURIComponent(milestoneId)}`, {
    method: 'DELETE'
  });
};

export interface CreateProjectFilePayload {
  name: string;
  mimeType?: string;
  url: string;
}

export const addProjectFileApi = async (projectId: string, payload: CreateProjectFilePayload): Promise<ProjectFile> => {
  const { data } = await apiFetch<{ data: ProjectFile }>(`/${encodeURIComponent(projectId)}/files`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  return data;
};

export const removeProjectFileApi = async (projectId: string, fileId: string): Promise<void> => {
  await apiFetch(`/${encodeURIComponent(projectId)}/files/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
};
