import * as repo from './calendar.repository.js';
import { userStore } from '../store/userStore.js';
import { getEffectiveRoles } from '../auth/effectiveRoles.js';
import { fromUserPk, toUserPk } from '../utils/idMapping.js';

// Service Layer, matching the layering convention already used by backend/src/projects and
// backend/src/notifications: no SQL here (that's calendar.repository.ts), no Express req/res
// here (that's calendar.controller.ts).

export class CalendarAuthorizationError extends Error {}
export class CalendarNotFoundError extends Error {}
export class CalendarValidationError extends Error {}

export interface ApprovedLeaveEntry {
  id: string;
  userId: string;
  userName: string;
  date: string;
  leaveType: 'Full Day Leave' | 'Half Day Leave';
}

const parseDetails = (details: repo.ApprovedLeaveRow['details']): { leaveType?: string } =>
  (typeof details === 'string' ? JSON.parse(details) : details || {}) as { leaveType?: string };

// Unfiltered by role, matching the Calendar module's existing convention (see
// frontend/src/features/calendar/calendarRules.ts: "Visibility is intentionally unfiltered") --
// every authenticated caller (Employee/Team Lead/HR/Admin) sees the same approved leave, same as
// Deadlines/Milestones/Task Due today. This is deliberately different from GET /api/hr-requests,
// which scopes by role for the Approvals Inbox -- that endpoint and its logic are untouched.
export const listApprovedLeave = async (): Promise<ApprovedLeaveEntry[]> => {
  const rows = await repo.findApprovedLeave();
  return rows.map((row) => {
    const details = parseDetails(row.details);
    return {
      id: row.id,
      userId: row.user_id,
      userName: row.user_name || userStore.findById(row.user_id)?.name || 'Unknown',
      date: row.request_date,
      leaveType: details.leaveType === 'Half Day Leave' ? 'Half Day Leave' : 'Full Day Leave'
    };
  });
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export interface HolidayDTO {
  id: string;
  name: string;
  date: string;
  isRecurringAnnual: boolean;
  createdByUserId: string;
  createdAt: string;
}

const toHolidayDTO = (row: repo.HolidayRow): HolidayDTO => ({
  id: String(row.holidayid),
  name: row.holidayname,
  date: row.holidaydate,
  isRecurringAnnual: row.isrecurringannual,
  createdByUserId: fromUserPk(row.createdbyuserid),
  createdAt: row.createdatutc.toISOString()
});

// Uses effectiveRoles.ts (backend/src/auth/effectiveRoles.ts) rather than a direct
// `role === 'HR'` string comparison, per the same rule Attendance/Activity already follow:
// isActiveHR is computed as `!isAdmin && ...` there, so an Admin can never satisfy this check --
// including an Admin who also happens to hold an HR grant -- Admin access is excluded by
// construction, not by an extra check layered on here.
const assertIsHR = async (actorId: string): Promise<void> => {
  const roles = await getEffectiveRoles(actorId);
  if (!roles.isActiveHR) {
    throw new CalendarAuthorizationError('Only HR can manage holidays.');
  }
};

const parseHolidayId = (holidayId: string): number => {
  const id = Number(holidayId);
  if (!Number.isInteger(id)) throw new CalendarValidationError('Invalid holiday id.');
  return id;
};

// Visible to every role, unfiltered -- same convention as listApprovedLeave above and every
// other Calendar entry kind. Only create/update/delete are HR-gated.
export const listHolidays = async (): Promise<HolidayDTO[]> => {
  const rows = await repo.findHolidays();
  return rows.map(toHolidayDTO);
};

export const createHoliday = async (
  name: string,
  date: string,
  isRecurringAnnual: boolean,
  actorId: string
): Promise<HolidayDTO> => {
  await assertIsHR(actorId);
  if (!name?.trim()) throw new CalendarValidationError('Holiday name is required.');
  if (!ISO_DATE_PATTERN.test(date || '')) throw new CalendarValidationError('A valid holiday date is required.');

  const id = await repo.insertHoliday({
    name: name.trim(),
    date,
    isRecurringAnnual: Boolean(isRecurringAnnual),
    createdByUserId: toUserPk(actorId)
  });
  const row = await repo.findHolidayById(id);
  return toHolidayDTO(row!);
};

export const updateHoliday = async (
  holidayId: string,
  updates: { name?: string; date?: string; isRecurringAnnual?: boolean },
  actorId: string
): Promise<HolidayDTO> => {
  await assertIsHR(actorId);
  const id = parseHolidayId(holidayId);
  const existing = await repo.findHolidayById(id);
  if (!existing) throw new CalendarNotFoundError('Holiday not found.');

  if (updates.name !== undefined && !updates.name.trim()) {
    throw new CalendarValidationError('Holiday name cannot be empty.');
  }
  if (updates.date !== undefined && !ISO_DATE_PATTERN.test(updates.date)) {
    throw new CalendarValidationError('A valid holiday date is required.');
  }

  await repo.updateHoliday(id, {
    name: updates.name?.trim(),
    date: updates.date,
    isRecurringAnnual: updates.isRecurringAnnual
  });
  const updated = await repo.findHolidayById(id);
  return toHolidayDTO(updated!);
};

export const deleteHoliday = async (holidayId: string, actorId: string): Promise<void> => {
  await assertIsHR(actorId);
  const id = parseHolidayId(holidayId);
  const deleted = await repo.deleteHoliday(id);
  if (!deleted) throw new CalendarNotFoundError('Holiday not found.');
};
