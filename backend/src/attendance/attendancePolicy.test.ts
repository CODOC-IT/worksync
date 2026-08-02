import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAttendanceOutcome } from './attendancePolicy.js';

const at = (value: string) => new Date(`2026-08-01T${value}:00.000Z`);
const base = {
  scheduledStartUtc: at('08:00'),
  scheduledMinutes: 480,
  graceMinutes: 0,
  breakSeconds: 0
};
const halfDay = (period: 'First Half' | 'Second Half') => ({
  type: 'Half Day Leave' as const,
  period,
  halfDayBoundaryUtc: at('12:00')
});

test('a one-minute session is not Present', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('08:00'), checkOutUtc: at('08:01')
  }).status, 'Half Day');
});

test('late respects the configured grace period', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('08:10'), checkOutUtc: at('16:10'), graceMinutes: 10
  }).status, 'Present');
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('08:11'), checkOutUtc: at('16:11'), graceMinutes: 10
  }).status, 'Late');
});

test('break seconds are summed before working minutes are rounded', () => {
  const result = calculateAttendanceOutcome({
    ...base, checkInUtc: at('08:00'), checkOutUtc: at('16:00'),
    scheduledMinutes: 479, breakSeconds: 10
  });
  assert.equal(result.workingSeconds, 28790);
  assert.equal(result.workingMinutes, 479);
  assert.equal(result.status, 'Present');
});

test('second-half leave: checkout exactly at 12:00 PM is Half Day', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('08:00'), checkOutUtc: at('12:00'),
    approvedLeave: halfDay('Second Half')
  }).status, 'Half Day');
});

test('second-half leave: checkout before 12:00 PM is non-compliant', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('08:00'), checkOutUtc: at('11:00'),
    approvedLeave: halfDay('Second Half')
  }).status, 'Absent');
});

test('second-half leave: sufficient first-half duration is Half Day', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('07:00'), checkOutUtc: at('11:00'),
    approvedLeave: halfDay('Second Half')
  }).status, 'Half Day');
});

test('first-half leave: check-in at approved second-half start is not Late', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('12:00'), checkOutUtc: at('16:00'),
    approvedLeave: halfDay('First Half')
  }).status, 'Half Day');
});

test('first-half leave: arrival after approved second-half start is Late', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('12:01'), checkOutUtc: at('16:01'),
    approvedLeave: halfDay('First Half')
  }).status, 'Late');
});

test('full-day leave remains On Leave with no attendance requirement', () => {
  assert.equal(calculateAttendanceOutcome({
    ...base, checkInUtc: at('08:00'), checkOutUtc: at('08:00'),
    approvedLeave: { type: 'Full Day Leave' }
  }).status, 'On Leave');
});
