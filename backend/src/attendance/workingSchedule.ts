// Single source of truth for the Attendance Working Schedule model.
//
// The shift window is fixed at 8 hours, the break allowance at 60 minutes and the
// expected net working time at 7 hours. Only the wall-clock shift start/end times are
// configurable. Every calculation here is overnight-aware (EndTime < StartTime means the
// shift crosses midnight into the next calendar day) and expressed in the business time
// zone (Asia/Karachi) — never UTC. The SQL mirror of these helpers lives in the
// database/migrations/20260809_01_attendance_working_schedule.sql file
// (hr.schedule_window_minutes / hr.schedule_net_minutes).

export const DEFAULT_SHIFT_WINDOW_MINUTES = 480;
export const DEFAULT_SHIFT_BREAK_MINUTES = 60;
export const DEFAULT_SHIFT_NET_MINUTES =
  DEFAULT_SHIFT_WINDOW_MINUTES - DEFAULT_SHIFT_BREAK_MINUTES;

export const SHIFT_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const timeToMinutes = (time: string): number => {
  const [hours, minutes] = time.split(':').map((part) => Number(part));
  return hours * 60 + minutes;
};

export const minutesToTime = (minutes: number): string => {
  const wrapped = ((minutes % 1440) + 1440) % 1440;
  const hours = Math.floor(wrapped / 60);
  const rest = wrapped % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
};

// Overnight-aware window length in minutes. Returns null when either bound is missing.
export const scheduleWindowMinutes = (
  startTime: string | null | undefined,
  endTime: string | null | undefined
): number | null => {
  if (!startTime || !endTime) return null;
  const start = timeToMinutes(startTime);
  const end = timeToMinutes(endTime);
  if (end > start) return end - start;
  if (end < start) return 1440 - start + end;
  return 0;
};

// Expected net working minutes for a schedule day = window - break allowance. Falls back
// to the fixed net expectation when no window is known.
export const scheduleNetMinutes = (
  startTime: string | null | undefined,
  endTime: string | null | undefined,
  breakMinutes: number | null | undefined
): number => {
  const windowMinutes = scheduleWindowMinutes(startTime, endTime);
  if (windowMinutes === null) return DEFAULT_SHIFT_NET_MINUTES;
  return Math.max(0, windowMinutes - (breakMinutes ?? DEFAULT_SHIFT_BREAK_MINUTES));
};
