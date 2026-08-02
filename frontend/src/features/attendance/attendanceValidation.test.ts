import test from 'node:test';
import assert from 'node:assert/strict';
import { isPastDate, validateAttendanceCorrection } from './attendanceValidation.js';

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
