export const DEFAULT_BUSINESS_TIME_ZONE = 'Asia/Karachi';

// Canonical attendance constants (single source of truth on the frontend). Mirrors the backend
// workingSchedule.ts (DEFAULT_SHIFT_WINDOW_MINUTES / DEFAULT_SHIFT_BREAK_MINUTES /
// DEFAULT_SHIFT_NET_MINUTES) and the database/migrations/20260809_01_attendance_working_schedule.sql
// seed, so the 8h window / 60m break / 7h net figures never diverge between validation, the
// default schedule and the schedule-config UI.
export const DEFAULT_SHIFT_START_TIME = '16:00';
export const DEFAULT_SHIFT_END_TIME = '00:00';
export const DEFAULT_SHIFT_WINDOW_MINUTES = 480;
export const DEFAULT_SHIFT_BREAK_MINUTES = 60;
export const DEFAULT_SHIFT_NET_MINUTES = 420;

export const formatAttendanceTime = (
  instant: string,
  timeZone = DEFAULT_BUSINESS_TIME_ZONE
): string => {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
};

export const businessDateKey = (
  instant: Date = new Date(),
  timeZone = DEFAULT_BUSINESS_TIME_ZONE
): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

