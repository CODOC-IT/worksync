import { DepartmentOption } from '../../types';

// ---------------------------------------------------------------------------------------
// departmentsRepository — thin fetch wrapper over GET /api/calendar/departments
// (backend/src/calendar/calendar.routes.ts), added specifically for the holiday audience picker
// (ManageHolidaysModal.tsx). Deliberately NOT /api/accounts/departments
// (backend/src/accounts/accounts.routes.ts) -- that endpoint scopes its result to the calling HR
// user's own permitted-department hierarchy (accounts.service.ts's listPermittedDepartments,
// built for member-provisioning authorization), while holiday management has never been
// department-scoped (calendar.service.ts's assertIsHR has no department dimension) -- HR must be
// able to target any active department when creating a holiday, not just the ones they're scoped
// to manage members within.
// ---------------------------------------------------------------------------------------

export const fetchDepartments = async (): Promise<DepartmentOption[]> => {
  const token = localStorage.getItem('worksync_auth_token');
  const res = await fetch('/api/calendar/departments', {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.success) {
    throw new Error(json?.message || 'Could not load departments.');
  }
  return Array.isArray(json.data) ? (json.data as DepartmentOption[]) : [];
};
