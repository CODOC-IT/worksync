import test from 'node:test';
import assert from 'node:assert/strict';
import { totalCorrectionBreakMinutes, validateCorrectionValues } from './correctionValidation.js';

const overnightShift = { startTime: '16:00', endTime: '00:00' };
const validate = (checkIn: string, checkOut: string, breaks: unknown[] = [], shift = overnightShift) =>
  validateCorrectionValues({ checkIn, checkOut, breaks, completed: true, shift });

test('rejects check-out before or equal to check-in', () => {
  assert.equal(validate('16:00', '16:00'), 'Check-out must be later than check-in.');
  assert.equal(validate('16:00', '17:00'), null);
  assert.notEqual(validate('16:00', '15:59'), null);
});

test('valid overnight 16:00 -> 00:00 session: late check-in plus overnight checkout', () => {
  assert.equal(validate('16:10', '00:00', []), null);
});

test('check-in before the shift start is rejected even in an overnight shift', () => {
  assert.equal(validate('15:00', '23:00', []), 'Check-in must be within the selected shift window.');
  assert.equal(validate('01:00', '02:00', []), 'Check-in must be within the selected shift window.');
});

test('check-out after the shift end is rejected', () => {
  assert.equal(validate('16:00', '00:30', []), 'Check-out must be within the selected shift window.');
});

test('breaks with a single 60-minute gap are valid', () => {
  assert.equal(validate('16:10', '23:50', [
    { startTime: '18:00', endTime: '19:00' }
  ]), null);
});

test('multiple breaks totalling exactly 60 minutes are valid', () => {
  assert.equal(validate('16:10', '23:50', [
    { startTime: '18:00', endTime: '18:30' },
    { startTime: '21:30', endTime: '22:00' }
  ]), null);
  assert.equal(validate('16:10', '23:50', [
    { startTime: '18:00', endTime: '18:20' },
    { startTime: '20:00', endTime: '20:15' },
    { startTime: '22:00', endTime: '22:25' }
  ]), null);
});

test('cumulative breaks over 60 minutes are rejected', () => {
  assert.equal(validate('16:10', '23:50', [
    { startTime: '18:00', endTime: '18:20' },
    { startTime: '20:00', endTime: '20:40' },
    { startTime: '22:00', endTime: '22:10' }
  ]), 'Total break duration cannot exceed 60 minutes per shift.');
});

test('breaks before the session start are rejected', () => {
  assert.equal(validate('10:00', '17:00', [
    { startTime: '09:30', endTime: '10:15' }
  ], { startTime: '09:00', endTime: '17:00' }), 'Break start must be at or after check-in.');
});

test('a morning break on an overnight shift is rejected', () => {
  assert.notEqual(validate('16:10', '23:50', [
    { startTime: '15:00', endTime: '15:30' }
  ]), null);
});

test('break after check-out is rejected', () => {
  assert.equal(validate('16:10', '23:50', [
    { startTime: '23:50', endTime: '00:20' }
  ]), 'Break end must be at or before check-out.');
});

test('break extending beyond the shift window is rejected', () => {
  assert.equal(validate('16:10', '23:50', [
    { startTime: '23:30', endTime: '00:10' }
  ]), 'Break end must be at or before check-out.');
});

test('overlapping breaks are rejected', () => {
  assert.equal(validate('16:10', '23:50', [
    { startTime: '18:00', endTime: '18:30' },
    { startTime: '18:20', endTime: '18:40' }
  ]), 'Break intervals must not overlap.');
});

test('18:00 -> 02:00 overnight shift is interpreted with next-day checkout', () => {
  const eveningShift = { startTime: '18:00', endTime: '02:00' };
  assert.equal(validate('22:00', '02:00', [
    { startTime: '23:00', endTime: '23:20' },
    { startTime: '00:30', endTime: '01:10' }
  ], eveningShift), null);
  assert.equal(validate('01:15', '01:45', [], eveningShift), null);
  assert.equal(validate('17:00', '02:00', [], eveningShift), 'Check-in must be within the selected shift window.');
  assert.equal(validate('18:00', '20:00', [], eveningShift), null);
});

test('day shift without overnight does not treat 09:00 checkout as previous day', () => {
  const dayShift = { startTime: '09:00', endTime: '17:00' };
  assert.equal(validate('09:30', '17:00', [], dayShift), null);
  assert.equal(validate('08:30', '17:00', [], dayShift), 'Check-in must be within the selected shift window.');
  assert.equal(validate('09:00', '17:30', [], dayShift), 'Check-out must be within the selected shift window.');
});

test('totalCorrectionBreakMinutes is overnight-aware', () => {
  assert.equal(totalCorrectionBreakMinutes(
    [{ startTime: '23:30', endTime: '00:10' }],
    overnightShift
  ), 40);
  assert.equal(totalCorrectionBreakMinutes(
    [
      { startTime: '18:00', endTime: '18:20' },
      { startTime: '21:00', endTime: '21:40' }
    ],
    overnightShift
  ), 60);
});