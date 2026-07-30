import { ApprovedLeaveEntry, Holiday } from '../../types';

// ---------------------------------------------------------------------------------------
// calendarApiClient — thin fetch wrapper over /api/calendar (backend/src/calendar/calendar.routes.ts).
// Mirrors the exact apiFetch convention already established in features/projects/projectRepository.ts
// (Bearer token from localStorage, `{ success, data }` envelope).
// ---------------------------------------------------------------------------------------

const API_BASE = '/api/calendar';

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

export const fetchApprovedLeave = async (): Promise<ApprovedLeaveEntry[]> => {
  const { data } = await apiFetch<{ data: ApprovedLeaveEntry[] }>('/approved-leave');
  return data;
};

// Holidays -- visible to everyone; create/update/delete are HR-only, enforced server-side (see
// backend/src/calendar/calendar.service.ts's assertIsHR). The UI must still hide these actions
// for non-HR roles (see CalendarView.tsx / ManageHolidaysModal.tsx), but this file never assumes
// that hiding is the real gate.
export const fetchHolidays = async (): Promise<Holiday[]> => {
  const { data } = await apiFetch<{ data: Holiday[] }>('/holidays');
  return data;
};

export interface HolidayInput {
  name: string;
  date: string;
  isRecurringAnnual: boolean;
}

export const createHolidayApi = async (input: HolidayInput): Promise<Holiday> => {
  const { data } = await apiFetch<{ data: Holiday }>('/holidays', {
    method: 'POST',
    body: JSON.stringify(input)
  });
  return data;
};

export const updateHolidayApi = async (id: string, input: Partial<HolidayInput>): Promise<Holiday> => {
  const { data } = await apiFetch<{ data: Holiday }>(`/holidays/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(input)
  });
  return data;
};

export const deleteHolidayApi = async (id: string): Promise<void> => {
  await apiFetch(`/holidays/${encodeURIComponent(id)}`, { method: 'DELETE' });
};
