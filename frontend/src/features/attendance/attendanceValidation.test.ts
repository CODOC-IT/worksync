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

test('frontend correction validation exposes clear interval errors', () => {
  assert.equal(validateAttendanceCorrection('09:00', '09:00', []),
    'Check-out must be later than check-in.');
  assert.equal(validateAttendanceCorrection('09:00', '17:00', [{
    id: '1', type: 'Other', startTime: '08:30', endTime: '09:15', durationMinutes: 45
  }]), 'Break start must be at or after check-in.');
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
