import { HRRequest, WorkBreak } from '../../types';

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

const SHIFT_BREAK_MINUTES = 60;

export interface CorrectionShift {
  startTime?: string;
  endTime?: string;
}

// Duplicates backend correctionValidation.ts so an overnight PKT shift (e.g. 16:00 -> 00:00)
// validates identically on both sides: the shift window may cross midnight, and values before
// the shift start belong to the following calendar day.
const shiftWindowMinutes = (startTime: string, endTime: string): number => {
  const start = minutes(startTime);
  const end = minutes(endTime);
  if (start === null || end === null) return 0;
  const window = end - start;
  return window > 0 ? window : window + 1440;
};

const shiftRelative = (value: number, startTime: number, endTime: number): number => {
  const overnight = endTime <= startTime;
  if (!overnight) return value - startTime;
  return value >= startTime ? value - startTime : value + 1440 - startTime;
};

export const validateAttendanceCorrection = (
  checkIn: string,
  checkOut: string,
  breaks: WorkBreak[],
  shift?: CorrectionShift
): string | null => {
  const start = minutes(checkIn);
  const end = minutes(checkOut);
  if (start === null) return 'Check-in is required and must use HH:mm format.';
  if (end === null) return 'Check-out is required for a completed attendance record.';

  const hasShift = Boolean(shift?.startTime && shift?.endTime);
  const shiftStart = hasShift ? minutes(shift.startTime as string) : null;
  const shiftEnd = hasShift ? minutes(shift.endTime as string) : null;
  if (hasShift && (shiftStart === null || shiftEnd === null)) {
    return 'Shift start and end time must be valid HH:mm values.';
  }
  const window = hasShift ? shiftWindowMinutes(shift.startTime as string, shift.endTime as string) : 0;

  const checkInOffset = hasShift ? shiftRelative(start, shiftStart as number, shiftEnd as number) : start;
  const checkOutOffset = hasShift ? shiftRelative(end, shiftStart as number, shiftEnd as number) : end;

  if (hasShift) {
    if (checkInOffset < 0 || checkInOffset >= window) {
      return 'Check-in must be within the selected shift window.';
    }
    if (checkOutOffset < 0 || checkOutOffset > window) {
      return 'Check-out must be within the selected shift window.';
    }
  }
  if (checkOutOffset <= checkInOffset) return 'Check-out must be later than check-in.';

  const intervals: Array<{ start: number; end: number }> = [];
  for (const workBreak of breaks) {
    const breakStart = minutes(workBreak.startTime);
    const breakEnd = minutes(workBreak.endTime);
    if (breakStart === null || breakEnd === null) return 'Every break must have valid start and end times.';
    const breakStartOffset = hasShift
      ? shiftRelative(breakStart, shiftStart as number, shiftEnd as number)
      : breakStart;
    const breakEndOffset = hasShift
      ? shiftRelative(breakEnd, shiftStart as number, shiftEnd as number)
      : breakEnd;
    if (breakEndOffset <= breakStartOffset) return 'Break end must be later than break start.';
    if (breakStartOffset < checkInOffset) return 'Break start must be at or after check-in.';
    if (breakEndOffset > checkOutOffset) return 'Break end must be at or before check-out.';
    intervals.push({ start: breakStartOffset, end: breakEndOffset });
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
  if (totalBreak > SHIFT_BREAK_MINUTES) {
    return `Total break duration cannot exceed ${SHIFT_BREAK_MINUTES} minutes per shift.`;
  }
  return null;
};

export const isPastDate = (date: string, today: string): boolean => date < today;

export const validateLeaveRequestOverlap = (
  date: string,
  leaveType: 'Full Day Leave' | 'Half Day Leave',
  leavePeriod: 'First Half' | 'Second Half' | undefined,
  requests: HRRequest[]
): string | null => {
  const existing = requests.filter(
    (request) =>
      request.type === 'Leave' &&
      request.date === date &&
      request.status !== 'Rejected'
  );
  for (const request of existing) {
    if (leaveType === 'Full Day Leave' || request.details.leaveType === 'Full Day Leave') {
      return 'Leave conflicts with an existing Full Day leave request.';
    }
    if (request.details.leavePeriod === leavePeriod) {
      return `A ${leavePeriod} Half Day leave already exists for this date.`;
    }
    return 'First Half and Second Half cannot be combined on the same date; request Full Day leave instead.';
  }
  return null;
};