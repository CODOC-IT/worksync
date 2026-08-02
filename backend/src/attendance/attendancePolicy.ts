export type HalfDayLeavePeriod = 'First Half' | 'Second Half';

export interface AttendancePolicyInput {
  checkInUtc: Date;
  checkOutUtc: Date;
  scheduledStartUtc?: Date | null;
  scheduledMinutes: number;
  graceMinutes: number;
  breakSeconds: number;
  approvedLeave?: {
    type: 'Full Day Leave' | 'Half Day Leave';
    period?: HalfDayLeavePeriod;
    halfDayBoundaryUtc?: Date | null;
  } | null;
}

export interface AttendancePolicyResult {
  status: 'Present' | 'Late' | 'Half Day' | 'Absent' | 'On Leave';
  workingSeconds: number;
  workingMinutes: number;
  lateMinutes: number;
}

export const calculateAttendanceOutcome = (input: AttendancePolicyInput): AttendancePolicyResult => {
  if (input.approvedLeave?.type === 'Full Day Leave') {
    return { status: 'On Leave', workingSeconds: 0, workingMinutes: 0, lateMinutes: 0 };
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((input.checkOutUtc.getTime() - input.checkInUtc.getTime()) / 1000)
  );
  const workingSeconds = Math.max(0, elapsedSeconds - Math.max(0, input.breakSeconds));
  const workingMinutes = Math.floor(workingSeconds / 60);
  const minimumFullDayMinutes = Math.max(1, input.scheduledMinutes);
  const minimumHalfDayMinutes = Math.ceil(minimumFullDayMinutes / 2);
  const halfDayLeave = input.approvedLeave?.type === 'Half Day Leave'
    ? input.approvedLeave
    : null;
  const halfDayPeriod = halfDayLeave?.period || 'Second Half';
  const boundary = halfDayLeave?.halfDayBoundaryUtc || null;
  const expectedStart = halfDayLeave && halfDayPeriod === 'First Half' && boundary
    ? boundary
    : input.scheduledStartUtc || null;
  const lateMinutes = expectedStart
    ? Math.max(
        0,
        Math.floor((input.checkInUtc.getTime() - expectedStart.getTime()) / 60000) -
          Math.max(0, input.graceMinutes)
      )
    : 0;

  if (halfDayLeave) {
    const sufficientDuration = workingMinutes >= minimumHalfDayMinutes;
    if (halfDayPeriod === 'Second Half') {
      const workedUntilBoundary = Boolean(boundary && input.checkOutUtc >= boundary);
      return {
        status: sufficientDuration || workedUntilBoundary ? 'Half Day' : 'Absent',
        workingSeconds,
        workingMinutes,
        lateMinutes
      };
    }

    if (!sufficientDuration) {
      return { status: 'Absent', workingSeconds, workingMinutes, lateMinutes };
    }
    return {
      status: lateMinutes > 0 ? 'Late' : 'Half Day',
      workingSeconds,
      workingMinutes,
      lateMinutes
    };
  }

  if (workingMinutes < minimumFullDayMinutes) {
    return { status: 'Half Day', workingSeconds, workingMinutes, lateMinutes };
  }
  return {
    status: lateMinutes > 0 ? 'Late' : 'Present',
    workingSeconds,
    workingMinutes,
    lateMinutes
  };
};
