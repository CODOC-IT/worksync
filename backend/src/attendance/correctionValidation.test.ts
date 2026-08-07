import test from 'node:test';
import assert from 'node:assert/strict';
import { totalCorrectionBreakMinutes, validateCorrectionValues } from './correctionValidation.js';

const validate = (checkIn: string, checkOut: string, breaks: unknown[] = []) =>
  validateCorrectionValues({ checkIn, checkOut, breaks, completed: true });

test('rejects check-out before or equal to check-in', () => {
  assert.equal(validate('09:00', '08:59'), 'Check-out must be later than check-in.');
  assert.equal(validate('09:00', '09:00'), 'Check-out must be later than check-in.');
});

test('rejects breaks outside the session', () => {
  assert.equal(validate('09:00', '17:00', [{ startTime: '08:50', endTime: '09:10' }]),
    'Break start must be at or after check-in.');
  assert.equal(validate('09:00', '17:00', [{ startTime: '16:50', endTime: '17:10' }]),
    'Break end must be at or before check-out.');
});

test('rejects overlapping and duplicate breaks', () => {
  assert.equal(validate('09:00', '17:00', [
    { startTime: '10:00', endTime: '10:30' },
    { startTime: '10:20', endTime: '10:40' }
  ]), 'Break intervals must not overlap.');
  assert.equal(validate('09:00', '17:00', [
    { startTime: '10:00', endTime: '10:30' },
    { startTime: '10:00', endTime: '10:30' }
  ]), 'Duplicate break intervals are not allowed.');
});

test('rejects total breaks longer than the session', () => {
  assert.equal(validate('09:00', '10:00', [
    { startTime: '09:00', endTime: '09:40' },
    { startTime: '09:40', endTime: '10:00' },
    { startTime: '09:50', endTime: '10:00' }
  ]), 'Break intervals must not overlap.');
  assert.equal(validate('09:00', '10:00', [
    { startTime: '09:00', endTime: '10:00' }
  ]), null);
});

test('accepts and correctly totals multiple valid breaks', () => {
  const breaks = [
    { startTime: '10:00', endTime: '10:15' },
    { startTime: '12:00', endTime: '12:30' },
    { startTime: '15:00', endTime: '15:10' }
  ];
  assert.equal(validate('09:00', '17:00', breaks), null);
  assert.equal(totalCorrectionBreakMinutes(breaks), 55);
});
