import {
  ProposedTaskUpdate,
  SubtaskReviewDecision,
  SystemApproval,
  Task,
  TaskStatus,
  TaskStatusHistoryEntry
} from '../../types';
import {
  TaskMutationData,
  TaskMutationResult,
  TaskModuleTask
} from './taskRules';

interface TaskApiResponse {
  success: boolean;
  message?: string;
  data?: TaskModuleTask | TaskModuleTask[];
  fieldErrors?: Record<string, string>;
}

const getAuthToken = () => localStorage.getItem('worksync_auth_token');

const parseResponse = async (response: Response): Promise<TaskApiResponse> => {
  try {
    return await response.json() as TaskApiResponse;
  } catch {
    return {
      success: false,
      message: 'The task service returned an invalid response.'
    };
  }
};

export const loadTasksFromApi = async (): Promise<Task[] | null> => {
  const token = getAuthToken();
  if (!token) return null;

  const response = await fetch('/api/tasks', {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const payload = await parseResponse(response);

  if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
    throw new Error(payload.message || 'Unable to load tasks.');
  }

  return payload.data as Task[];
};

export const loadArchivedTasksFromApi = async (): Promise<Task[]> => {
  const token = getAuthToken();
  if (!token) return [];

  const response = await fetch('/api/tasks?archived=true', {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const payload = await parseResponse(response);

  if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
    throw new Error(payload.message || 'Unable to load archived tasks.');
  }

  return payload.data as Task[];
};

export const loadTaskDetailFromApi = async (taskId: string): Promise<Task> => {
  const token = getAuthToken();
  if (!token) throw new Error('Sign in before viewing task details.');
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await parseResponse(response);
  if (!response.ok || !payload.success || Array.isArray(payload.data) || !payload.data) throw new Error(payload.message || 'Unable to load task details.');
  return { ...(payload.data as Task), subtasks: Array.isArray(payload.data.subtasks) ? payload.data.subtasks : [] };
};

export const createTaskViaApi = async (
  data: TaskMutationData
): Promise<TaskMutationResult> => {
  const token = getAuthToken();
  if (!token) {
    return {
      success: false,
      message: 'Sign in before creating a task.'
    };
  }

  const requestController = new AbortController();
  const requestTimeout = window.setTimeout(() => requestController.abort(), 20_000);
  try {
    const body: Record<string, unknown> = {
      projectId: data.projectId,
      title: data.title,
      description: data.description,
      priority: data.priority,
      startDate: data.startDate,
      dueDate: data.dueDate,
      teamId: data.teamId,
      assigneeIds: data.assigneeIds?.length
        ? data.assigneeIds
        : data.assigneeId
          ? [data.assigneeId]
          : [],
      status: data.status || 'Todo'
    };

    if (data.parentTaskId) {
      body.parentTaskId = data.parentTaskId;
    }
    if (data.subtasks && data.subtasks.length > 0) {
      body.subtasks = data.subtasks;
    }

    const response = await fetch('/api/tasks', {
      method: 'POST',
      signal: requestController.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const payload = await parseResponse(response);
    if (response.ok && payload.success && (payload as TaskApiResponse & { pendingApproval?: boolean }).pendingApproval) {
      return { success: true, message: payload.message || 'Task submitted for Admin approval.' };
    }
    const task = !Array.isArray(payload.data) ? payload.data : undefined;

    if (!response.ok || !payload.success || !task) {
      return {
        success: false,
        message: payload.message || 'Unable to create the task.',
        fieldErrors: payload.fieldErrors
      };
    }

    return {
      success: true,
      message: payload.message || 'Task created successfully.',
      task
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof DOMException && error.name === 'AbortError'
        ? 'Task creation timed out. Please check the server connection and try again.'
        : 'Unable to reach the task service. Please try again.'
    };
  } finally {
    window.clearTimeout(requestTimeout);
  }
};

const authHeaders = (): Record<string, string> => {
  const token = getAuthToken();
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
};

// The Project Board / Task Module's remaining mutations. Same "no local fallback, no fake
// success" contract as createTaskViaApi/loadTasksFromApi above -- every one of these either
// resolves with the server's authoritative task, or throws, and the caller (AppContext) never
// updates local state on a rejected promise.
export const updateTaskViaApi = async (taskId: string, data: TaskMutationData): Promise<Task> => {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PUT',
    headers: authHeaders(),
    body: JSON.stringify({
      title: data.title,
      description: data.description,
      priority: data.priority,
      startDate: data.startDate,
      dueDate: data.dueDate,
      assigneeIds: data.assigneeIds
    })
  });
  const payload = await parseResponse(response);
  if (!response.ok || !payload.success || Array.isArray(payload.data)) {
    throw new Error(payload.message || 'Unable to update the task.');
  }
  return payload.data as Task;
};

export const createTaskEditApprovalViaApi = async (
  taskId: string,
  proposedTaskUpdate: ProposedTaskUpdate
): Promise<SystemApproval> => {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/edit-approvals`, {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify(proposedTaskUpdate)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !payload.data) {
    throw new Error(payload?.message || 'Unable to submit the task update request.');
  }
  return payload.data as SystemApproval;
};

export const loadTaskEditApprovalsViaApi = async (): Promise<SystemApproval[]> => {
  const token = getAuthToken();
  if (!token) return [];
  const response = await fetch('/api/tasks/edit-approvals', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !Array.isArray(payload.data)) {
    throw new Error(payload?.message || 'Unable to load task update requests.');
  }
  return payload.data as SystemApproval[];
};

export const decideTaskEditApprovalViaApi = async (
  approvalId: string,
  decision: 'Approved' | 'Rejected',
  reason?: string
): Promise<Task | null> => {
  const response = await fetch(`/api/tasks/edit-approvals/${encodeURIComponent(approvalId)}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ decision, reason })
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    throw new Error(payload?.message || 'Unable to decide the task update request.');
  }
  return (payload.data || null) as Task | null;
};

export const deleteTaskViaApi = async (taskId: string): Promise<void> => {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    headers: authHeaders()
  });
  const payload = await parseResponse(response);
  if (!response.ok || !payload.success) {
    throw new Error(payload.message || 'Unable to delete the task.');
  }
};

const patchTaskStatus = async (taskId: string, path: string, body: object): Promise<Task> => {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}${path}`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  const payload = await parseResponse(response);
  if (!response.ok || !payload.success || Array.isArray(payload.data)) {
    throw new Error(payload.message || 'Unable to update the task status.');
  }
  return payload.data as Task;
};

export const changeTaskStatusViaApi = (taskId: string, status: TaskStatus, note: string): Promise<Task> =>
  patchTaskStatus(taskId, '/status', { status, note });

export const approveTaskViaApi = (taskId: string, note: string): Promise<Task> =>
  patchTaskStatus(taskId, '/approve', { note });

export const rejectTaskViaApi = (
  taskId: string,
  note: string,
  subtaskDecisions?: SubtaskReviewDecision[]
): Promise<Task> =>
  patchTaskStatus(taskId, '/reject', subtaskDecisions ? { note, subtaskDecisions } : { note });

// Team-Lead-only route out of Done. Sends `reason` (not `note`) to match the endpoint's own
// contract — see backend/src/tasks/task.validation.ts's validateReopenBody for why they differ.
export const reopenTaskViaApi = (taskId: string, status: TaskStatus, reason: string): Promise<Task> =>
  patchTaskStatus(taskId, '/reopen', { status, reason });

export const fetchTaskHistoryViaApi = async (taskId: string): Promise<TaskStatusHistoryEntry[]> => {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/history`, {
    headers: authHeaders()
  });
  const payload = await parseResponse(response);
  if (!response.ok || !payload.success || !Array.isArray(payload.data)) {
    throw new Error(payload.message || 'Unable to load task history.');
  }
  return payload.data as unknown as TaskStatusHistoryEntry[];
};
