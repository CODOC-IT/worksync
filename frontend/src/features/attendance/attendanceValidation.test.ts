import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canShowAttendanceCorrection,
  isPastDate,
  validateAttendanceCorrection,
  validateLeaveRequestOverlap
} from './attendanceValidation.js';

test('frontend blocks past leave dates and allows today/future', () => {
  assert.equal(isPastDate('2026-08-01', '2026-08-02'), true);
  assert.equal(isPastDate('2026-08-02', '2026-08-02'), false);
  assert.equal(isPastDate('2026-08-03', '2026-08-02'), false);
});

test('frontend correction validation accepts an overnight PKT shift', () => {
  const shift = { startTime: '16:00', endTime: '00:00' };
  assert.equal(validateAttendanceCorrection('16:10', '00:00', [], shift), null);
  assert.equal(validateAttendanceCorrection('22:10', '00:00', [
    { id: '1', type: 'Other', startTime: '23:20', endTime: '23:50', durationMinutes: 30 }
  ], shift), null);
  assert.equal(validateAttendanceCorrection('15:00', '23:00', [], shift),
    'Check-in must be within the selected shift window.');
  assert.equal(validateAttendanceCorrection('16:00', '01:00', [], shift),
    'Check-out must be within the selected shift window.');
  assert.equal(validateAttendanceCorrection('16:00', '17:30', [
    { id: '1', type: 'Other', startTime: '09:00', endTime: '09:15', durationMinutes: 15 }
  ], shift), 'Break end must be at or before check-out.');
});

test('frontend caps total break duration at 60 minutes like the backend', () => {
  const overnight = { startTime: '16:00', endTime: '00:00' };
  assert.equal(validateAttendanceCorrection('16:10', '23:50', [
    { id: '1', type: 'Other', startTime: '18:00', endTime: '18:20', durationMinutes: 20 },
    { id: '2', type: 'Other', startTime: '20:00', endTime: '20:45', durationMinutes: 45 }
  ], overnight), 'Total break duration cannot exceed 60 minutes per shift.');
  assert.equal(validateAttendanceCorrection('16:10', '23:50', [
    { id: '1', type: 'Other', startTime: '18:00', endTime: '18:20', durationMinutes: 20 },
    { id: '2', type: 'Other', startTime: '20:00', endTime: '20:40', durationMinutes: 40 }
  ], overnight), null);
});

test('frontend against a 18:00 -> 02:00 overnight shift accepts next-day checkout', () => {
  const evening = { startTime: '18:00', endTime: '02:00' };
  assert.equal(validateAttendanceCorrection('22:00', '02:00', [
    { id: '1', type: 'Other', startTime: '23:00', endTime: '23:20', durationMinutes: 20 },
    { id: '2', type: 'Other', startTime: '00:30', endTime: '01:10', durationMinutes: 40 }
  ], evening), null);
  assert.equal(validateAttendanceCorrection('14:00', '23:00', [], evening),
    'Check-in must be within the selected shift window.');
});

test('overnight 18:10 -> 01:55 correction is accepted on an 18:00 -> 02:00 shift', () => {
  const evening = { startTime: '18:00', endTime: '02:00' };
  assert.equal(validateAttendanceCorrection('18:10', '01:55', [
    { id: '1', type: 'Other', startTime: '23:00', endTime: '23:20', durationMinutes: 20 }
  ], evening), null);
  assert.equal(validateAttendanceCorrection('18:10', '01:55', [], evening), null);
});

test('frontend accepts breaks totalling exactly 60 minutes and rejects 61', () => {
  const overnight = { startTime: '16:00', endTime: '00:00' };
  assert.equal(validateAttendanceCorrection('16:10', '23:50', [
    { id: '1', type: 'Other', startTime: '18:00', endTime: '18:20', durationMinutes: 20 },
    { id: '2', type: 'Other', startTime: '19:30', endTime: '20:10', durationMinutes: 40 }
  ], overnight), null);
  assert.equal(validateAttendanceCorrection('16:10', '23:55', [
    { id: '1', type: 'Other', startTime: '18:00', endTime: '18:20', durationMinutes: 20 },
    { id: '2', type: 'Other', startTime: '20:00', endTime: '20:41', durationMinutes: 41 }
  ], overnight), 'Total break duration cannot exceed 60 minutes per shift.');
});

test('correction controls are hidden in-session and retained for completed or absent records', () => {
  assert.equal(canShowAttendanceCorrection('05:00', undefined, 'In Session'), false);
  assert.equal(canShowAttendanceCorrection('05:00', '13:00', 'Present'), true);
  assert.equal(canShowAttendanceCorrection('', undefined, 'Absent'), true);
});

test('frontend rejects duplicate and conflicting Half Day leave before submission', () => {
  const requests = [{
    id: 'leave-1',
    userId: 'usr-7',
    type: 'Leave',
    date: '2026-08-10',
    reason: 'Appointment',
    status: 'Approved',
    approvalStage: 'Admin',
    details: { leaveType: 'Half Day Leave', leavePeriod: 'First Half' },
    submittedAt: '2026-08-07 10:00'
  }] as any;
  assert.match(
    validateLeaveRequestOverlap('2026-08-10', 'Half Day Leave', 'First Half', requests) || '',
    /already exists/
  );
  assert.match(
    validateLeaveRequestOverlap('2026-08-10', 'Half Day Leave', 'Second Half', requests) || '',
    /Full Day leave/
  );
});
