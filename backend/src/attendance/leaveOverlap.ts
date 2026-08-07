export type LeaveType = 'Full Day Leave' | 'Half Day Leave';
export type LeavePeriod = 'First Half' | 'Second Half';

export interface LeaveWindow {
  date: string;
  leaveType: LeaveType;
  leavePeriod?: LeavePeriod;
  leaveDays?: number;
}

const addDays = (date: string, days: number): string => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};

export const validateLeaveOverlap = (
  proposed: LeaveWindow,
  existing: LeaveWindow[]
): string | null => {
  const proposedEnd = addDays(proposed.date, Math.max(1, proposed.leaveDays || 1) - 1);
  for (const item of existing) {
    const existingEnd = addDays(item.date, Math.max(1, item.leaveDays || 1) - 1);
    if (proposedEnd < item.date || existingEnd < proposed.date) continue;

    if (proposed.leaveType === 'Full Day Leave' || item.leaveType === 'Full Day Leave') {
      return 'Leave overlaps an existing Full Day leave request.';
    }
    if (proposed.date !== item.date || proposedEnd !== proposed.date || existingEnd !== item.date) {
      return 'Overlapping multi-day leave requests are not allowed.';
    }
    if (proposed.leavePeriod === item.leavePeriod) {
      return `A ${proposed.leavePeriod} Half Day leave already exists for this date.`;
    }
    return 'First Half and Second Half leave requests cannot be combined on the same date; request Full Day leave instead.';
  }
  return null;
};

