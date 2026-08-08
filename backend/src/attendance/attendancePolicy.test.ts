import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAttendanceOutcome } from './attendancePolicy.js';

const at = (value: string) => new Date(`2026-08-01T${value}:00.000Z`);
const atNextDay = (value: string) => new Date(`2026-08-02T${value}:00.000Z`);
const base = {
  scheduledStartUtc: at('16:00'),
  scheduledMinutes: 420,
  graceMinutes: 0,
  breakSeconds: 0
};
const halfDay = (period: 'First Half' | 'Second Half') => ({
  type: 'Half Day Leave' as const,
  period,
  halfDayBoundaryUtc: at('20:00')
});

test('420 net working minutes qualifies as Present', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('16:00'), checkOutUtc: at('23:00')
  }).status, 'Present');
});

test('419 net working minutes is Short Hours, not Present or Half Day', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('16:00'), checkOutUtc: at('22:59')
  }).status, 'Short Hours');
});

test('a one-minute session is Short Hours, not Present', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('16:00'), checkOutUtc: at('16:01')
  }).status, 'Short Hours');
});

test('420 minutes accumulated across break intervals qualifies as Present', () => {
  const result = calculateAttendanceOutcome({
    ...base, checkInUtc: at('16:00'), checkOutUtc: atNextDay('00:00'), breakSeconds: 60 * 60
  });
  assert.equal(result.workingMinutes, 420);
  assert.equal(result.status, 'Present');
});

test('the 480-minute schedule window is NOT the actual working requirement', () => {
  const result = calculateAttendanceOutcome({
    ...base, checkInUtc: at('16:00'), checkOutUtc: atNextDay('00:30'), breakSeconds: 90 * 60
  });
  assert.equal(result.workingMinutes, 420);
  assert.equal(result.status, 'Present');
  assert.notEqual(result.workingMinutes, 480);
});

test('break seconds are summed before working minutes are rounded', () => {
  const result = calculateAttendanceOutcome({
    ...base, checkInUtc: at('16:00'), checkOutUtc: atNextDay('00:00'),
    scheduledMinutes: 479, breakSeconds: 10
  });
  assert.equal(result.workingSeconds, 28790);
  assert.equal(result.workingMinutes, 479);
  assert.equal(result.status, 'Present');
});

test('late respects the configured grace period', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('16:10'), checkOutUtc: atNextDay('00:10'), graceMinutes: 10
  }).status, 'Present');
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('16:11'), checkOutUtc: atNextDay('00:11'), graceMinutes: 10
  }).status, 'Late');
});

test('lateness is measured from the configured PKT shift start', () => {
  const result = calculateAttendanceOutcome({
    ...base, checkInUtc: at('17:00'), checkOutUtc: atNextDay('00:00')
  });
  assert.equal(result.status, 'Late');
  assert.equal(result.lateMinutes, 60);
});

test('second-half leave: checkout exactly at the half-day boundary is Half Day', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('16:00'), checkOutUtc: at('20:00'),
    approvedLeave: halfDay('Second Half')
  }).status, 'Half Day');
});

test('second-half leave: checkout before the half-day boundary is non-compliant', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('16:00'), checkOutUtc: at('19:00'),
    approvedLeave: halfDay('Second Half')
  }).status, 'Absent');
});

test('second-half leave: sufficient first-half duration is Half Day', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('15:30'), checkOutUtc: at('20:00'),
    approvedLeave: halfDay('Second Half')
  }).status, 'Half Day');
});

test('first-half leave: check-in at the approved second-half start is not Late', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('20:00'), checkOutUtc: atNextDay('00:00'),
    approvedLeave: halfDay('First Half')
  }).status, 'Half Day');
});

test('first-half leave: arrival after the approved second-half start is Late', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('20:01'), checkOutUtc: atNextDay('00:01'),
    approvedLeave: halfDay('First Half')
  }).status, 'Late');
});

test('full-day leave remains On Leave with no attendance requirement', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('16:00'), checkOutUtc: at('16:00'),
    approvedLeave: { type: 'Full Day Leave' }
  }).status, 'On Leave');
});
