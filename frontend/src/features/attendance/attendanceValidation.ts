import { WorkBreak } from '../../types';

export const canShowAttendanceCorrection = (
  checkIn: string | undefined,
  checkOut: string | undefined,
  status: string
): boolean => !(Boolean(checkIn) && !checkOut) && (Boolean(checkOut) || status === 'Absent');

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (value?: string): number | null => {
  if (!value || !TIME_PATTERN.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};

export const validateAttendanceCorrection = (
  checkIn: string,
  checkOut: string,
  breaks: WorkBreak[]
): string | null => {
  const start = minutes(checkIn);
  const end = minutes(checkOut);
  if (start === null) return 'Check-in is required and must use HH:mm format.';
  if (end === null) return 'Check-out is required for a completed attendance record.';
  if (end <= start) return 'Check-out must be later than check-in.';

  const intervals: Array<{ start: number; end: number }> = [];
  for (const workBreak of breaks) {
    const breakStart = minutes(workBreak.startTime);
    const breakEnd = minutes(workBreak.endTime);
    if (breakStart === null || breakEnd === null) return 'Every break must have valid start and end times.';
    if (breakEnd <= breakStart) return 'Break end must be later than break start.';
    if (breakStart < start) return 'Break start must be at or after check-in.';
    if (breakEnd > end) return 'Break end must be at or before check-out.';
    intervals.push({ start: breakStart, end: breakEnd });
  }
  intervals.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < intervals.length; index += 1) {
    if (intervals[index].start === intervals[index - 1].start &&
        intervals[index].end === intervals[index - 1].end) {
      return 'Duplicate break intervals are not allowed.';
    }
    if (intervals[index].start < intervals[index - 1].end) {
      return 'Break intervals must not overlap.';
    }
  }
  const totalBreak = intervals.reduce((total, item) => total + item.end - item.start, 0);
  if (totalBreak > end - start) return 'Total break duration cannot exceed the attendance session.';
  return null;
};

export const isPastDate = (date: string, today: string): boolean => date < today;
