export interface CorrectionBreak {
  startTime?: unknown;
  endTime?: unknown;
}

export interface CorrectionValues {
  checkIn?: unknown;
  checkOut?: unknown;
  breaks?: unknown;
  completed?: boolean;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (value: unknown): number | null => {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};

export const validateCorrectionValues = (values: CorrectionValues): string | null => {
  const checkIn = minutes(values.checkIn);
  const checkOut = minutes(values.checkOut);
  if (checkIn === null) return 'Check-in is required and must use HH:mm format.';
  if (values.completed !== false && checkOut === null) {
    return 'Check-out is required for a completed attendance record.';
  }
  if (checkOut !== null && checkOut <= checkIn) return 'Check-out must be later than check-in.';

  if (!Array.isArray(values.breaks)) return 'Breaks must be supplied as a list.';
  const intervals: Array<{ start: number; end: number }> = [];
  for (const item of values.breaks as CorrectionBreak[]) {
    const start = minutes(item?.startTime);
    const end = minutes(item?.endTime);
    if (start === null || end === null) return 'Every break must have valid start and end times.';
    if (end <= start) return 'Break end must be later than break start.';
    if (start < checkIn) return 'Break start must be at or after check-in.';
    if (checkOut !== null && end > checkOut) return 'Break end must be at or before check-out.';
    intervals.push({ start, end });
  }

  intervals.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < intervals.length; index += 1) {
    const previous = intervals[index - 1];
    const current = intervals[index];
    if (current.start === previous.start && current.end === previous.end) {
      return 'Duplicate break intervals are not allowed.';
    }
    if (current.start < previous.end) return 'Break intervals must not overlap.';
  }
  if (checkOut !== null) {
    const totalBreakMinutes = intervals.reduce((total, item) => total + item.end - item.start, 0);
    if (totalBreakMinutes > checkOut - checkIn) {
      return 'Total break duration cannot exceed the attendance session.';
    }
  }
  return null;
};

export const totalCorrectionBreakMinutes = (breaks: CorrectionBreak[]): number =>
  breaks.reduce((total, item) => {
    const start = minutes(item.startTime);
    const end = minutes(item.endTime);
    return total + (start !== null && end !== null ? end - start : 0);
  }, 0);
