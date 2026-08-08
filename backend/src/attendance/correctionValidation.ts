import { scheduleWindowMinutes } from './workingSchedule.js';

export interface CorrectionShiftContext {
  startTime?: unknown;
  endTime?: unknown;
}

export interface CorrectionBreak {
  startTime?: unknown;
  endTime?: unknown;
}

export interface CorrectionValues {
  checkIn?: unknown;
  checkOut?: unknown;
  breaks?: unknown;
  completed?: boolean;
  shift?: CorrectionShiftContext;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (value: unknown): number | null => {
  if (typeof value !== 'string' || !TIME_PATTERN.test(value)) return null;
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
};

const DEFAULT_SHIFT_BREAK_MINUTES = 60;

// Minutes elapsed from the shift start on its original work date, interpreting the shift in
// its own overnight sense. EndTime <= StartTime means the shift crosses midnight, so any
// wall-clock value earlier than the start belongs to the following calendar day. The shift
// window must always be derived from the schedule by the caller.
const shiftOf = (shift: CorrectionShiftContext | undefined): {
  start: number | null;
  end: number | null;
  window: number | null;
} => {
  const startTime = typeof shift?.startTime === 'string' ? shift.startTime : null;
  const endTime = typeof shift?.endTime === 'string' ? shift.endTime : null;
  const start = startTime !== null ? minutes(startTime) : null;
  const end = endTime !== null ? minutes(endTime) : null;
  const window = startTime !== null && endTime !== null
    ? scheduleWindowMinutes(startTime, endTime)
    : null;
  return { start, end, window };
};

// Offsets the wall-clock value relative to the shift start (in minutes). Overnight shifts
// push values that are earlier than the start into the following calendar day.
const shiftRelative = (value: number, start: number, end: number): number => {
  const isOvernight = end <= start;
  if (!isOvernight) return value - start;
  return value >= start ? value - start : value + 1440 - start;
};

export const validateCorrectionValues = (values: CorrectionValues): string | null => {
  const shift = shiftOf(values.shift);
  const hasShift = shift.start !== null && shift.end !== null && shift.window !== null;

  const checkIn = minutes(values.checkIn);
  const checkOut = minutes(values.checkOut);
  if (checkIn === null) return 'Check-in is required and must use HH:mm format.';
  if (values.completed !== false && checkOut === null) {
    return 'Check-out is required for a completed attendance record.';
  }

  let checkInOffset = checkIn;
  let checkOutOffset = checkOut;
  if (hasShift) {
    checkInOffset = shiftRelative(checkIn, shift.start!, shift.end!);
    if (checkOut !== null) checkOutOffset = shiftRelative(checkOut, shift.start!, shift.end!);
    if (checkInOffset < 0 || checkInOffset >= shift.window!) {
      return 'Check-in must be within the selected shift window.';
    }
  }

  if (checkOutOffset !== null) {
    if (hasShift) {
      if (checkOutOffset < 0 || checkOutOffset > shift.window!) {
        return 'Check-out must be within the selected shift window.';
      }
    }
    if (checkOutOffset <= checkInOffset) {
      return 'Check-out must be later than check-in.';
    }
  }

  if (!Array.isArray(values.breaks)) return 'Breaks must be supplied as a list.';
  const intervals: Array<{ start: number; end: number }> = [];
  let totalBreakMinutes = 0;
  for (const item of values.breaks as CorrectionBreak[]) {
    const start = minutes(item?.startTime);
    const end = minutes(item?.endTime);
    if (start === null || end === null) return 'Every break must have valid start and end times.';

    let startOffset = start;
    let endOffset = end;
    if (hasShift) {
      startOffset = shiftRelative(start, shift.start!, shift.end!);
      endOffset = shiftRelative(end, shift.start!, shift.end!);
    }
    if (endOffset <= startOffset) return 'Break end must be later than break start.';
    if (startOffset < checkInOffset) return 'Break start must be at or after check-in.';
    if (checkOutOffset !== null && endOffset > checkOutOffset) {
      return 'Break end must be at or before check-out.';
    }
    intervals.push({ start: startOffset, end: endOffset });
    totalBreakMinutes += endOffset - startOffset;
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
  if (totalBreakMinutes > DEFAULT_SHIFT_BREAK_MINUTES) {
    return `Total break duration cannot exceed ${DEFAULT_SHIFT_BREAK_MINUTES} minutes per shift.`;
  }
  return null;
};

export const totalCorrectionBreakMinutes = (
  breaks: CorrectionBreak[],
  shift?: CorrectionShiftContext
): number => {
  const { start: shiftStart, end: shiftEnd } = shiftOf(shift);
  const hasShift = shiftStart !== null && shiftEnd !== null;
  return breaks.reduce((total, item) => {
    const start = minutes(item.startTime);
    const end = minutes(item.endTime);
    if (start === null || end === null) return total;
    const startOffset = hasShift
      ? shiftRelative(start, shiftStart!, shiftEnd!)
      : start;
    const endOffset = hasShift ? shiftRelative(end, shiftStart!, shiftEnd!) : end;
    return total + Math.max(0, endOffset - startOffset);
  }, 0);
};