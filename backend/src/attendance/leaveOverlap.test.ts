import assert from 'node:assert/strict';
import test from 'node:test';
import { validateLeaveOverlap } from './leaveOverlap.js';

test('duplicate First Half and duplicate Second Half leave are rejected', () => {
  assert.match(validateLeaveOverlap(
    { date: '2026-08-10', leaveType: 'Half Day Leave', leavePeriod: 'First Half' },
    [{ date: '2026-08-10', leaveType: 'Half Day Leave', leavePeriod: 'First Half' }]
  ) || '', /already exists/);
  assert.match(validateLeaveOverlap(
    { date: '2026-08-10', leaveType: 'Half Day Leave', leavePeriod: 'Second Half' },
    [{ date: '2026-08-10', leaveType: 'Half Day Leave', leavePeriod: 'Second Half' }]
  ) || '', /already exists/);
});

test('two complementary Half Days are rejected consistently', () => {
  assert.match(validateLeaveOverlap(
    { date: '2026-08-10', leaveType: 'Half Day Leave', leavePeriod: 'Second Half' },
    [{ date: '2026-08-10', leaveType: 'Half Day Leave', leavePeriod: 'First Half' }]
  ) || '', /request Full Day leave/);
});

test('Full Day conflicts with Half Day and overlapping leave ranges', () => {
  assert.match(validateLeaveOverlap(
    { date: '2026-08-10', leaveType: 'Half Day Leave', leavePeriod: 'First Half' },
    [{ date: '2026-08-10', leaveType: 'Full Day Leave' }]
  ) || '', /Full Day/);
  assert.match(validateLeaveOverlap(
    { date: '2026-08-11', leaveType: 'Full Day Leave' },
    [{ date: '2026-08-10', leaveType: 'Full Day Leave', leaveDays: 2 }]
  ) || '', /overlaps/);
});

