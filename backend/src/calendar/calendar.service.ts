import * as repo from './calendar.repository.js';
import { userStore } from '../store/userStore.js';

// Service Layer, matching the layering convention already used by backend/src/projects and
// backend/src/notifications: no SQL here (that's calendar.repository.ts), no Express req/res
// here (that's calendar.controller.ts).

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
