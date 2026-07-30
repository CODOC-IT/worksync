import { ApprovedLeaveEntry } from '../../types';

// ---------------------------------------------------------------------------------------
// calendarApiClient — thin fetch wrapper over /api/calendar (backend/src/calendar/calendar.routes.ts).
// Mirrors the exact apiFetch convention already established in features/projects/projectRepository.ts
// (Bearer token from localStorage, `{ success, data }` envelope).
// ---------------------------------------------------------------------------------------

const API_BASE = '/api/calendar';

async function apiFetch<T = any>(path: string): Promise<T> {
  const token = localStorage.getItem('worksync_auth_token');
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {})
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

export const fetchApprovedLeave = async (): Promise<ApprovedLeaveEntry[]> => {
  const { data } = await apiFetch<{ data: ApprovedLeaveEntry[] }>('/approved-leave');
  return data;
};
