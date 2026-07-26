import { Task } from '../../types';
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

  try {
    const response = await fetch('/api/tasks', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        projectId: data.projectId,
        title: data.title,
        description: data.description,
        priority: data.priority,
        startDate: data.startDate,
        dueDate: data.dueDate,
        assigneeIds: data.assigneeIds?.length
          ? data.assigneeIds
          : data.assigneeId
            ? [data.assigneeId]
            : [],
        status: data.status || 'Todo'
      })
    });
    const payload = await parseResponse(response);
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
  } catch {
    return {
      success: false,
      message: 'Unable to reach the task service. Please try again.'
    };
  }
};

export const updateTaskViaApi = async (
  taskId: string,
  data: TaskMutationData
): Promise<TaskMutationResult> => {
  const token = getAuthToken();
  if (!token) {
    return {
      success: false,
      message: 'Sign in before editing a task.'
    };
  }

  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: data.title,
        description: data.description,
        priority: data.priority,
        startDate: data.startDate,
        dueDate: data.dueDate,
        assigneeIds: data.assigneeIds?.length
          ? data.assigneeIds
          : data.assigneeId
            ? [data.assigneeId]
            : undefined,
        status: data.status
      })
    });
    const payload = await parseResponse(response);
    const task = !Array.isArray(payload.data) ? payload.data : undefined;

    if (!response.ok || !payload.success || !task) {
      return {
        success: false,
        message: payload.message || 'Unable to update the task.',
        fieldErrors: payload.fieldErrors
      };
    }

    return {
      success: true,
      message: payload.message || 'Task updated successfully.',
      task
    };
  } catch {
    return {
      success: false,
      message: 'Unable to reach the task service. Please try again.'
    };
  }
};

export const deleteTaskViaApi = async (
  taskId: string
): Promise<TaskMutationResult> => {
  const token = getAuthToken();
  if (!token) {
    return {
      success: false,
      message: 'Sign in before deleting a task.'
    };
  }

  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const payload = await parseResponse(response);
    const task = !Array.isArray(payload.data) ? payload.data : undefined;

    if (!response.ok || !payload.success) {
      return {
        success: false,
        message: payload.message || 'Unable to delete the task.',
        fieldErrors: payload.fieldErrors
      };
    }

    return {
      success: true,
      message: payload.message || 'Task deleted.',
      task
    };
  } catch {
    return {
      success: false,
      message: 'Unable to reach the task service. Please try again.'
    };
  }
};
