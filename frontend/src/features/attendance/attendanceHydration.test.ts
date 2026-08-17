import assert from 'node:assert/strict';
import test from 'node:test';
import { mapAttendanceApiRecords, restoreActiveBreak } from './attendanceHydration.js';

const activeRow = {
  userId: 'usr-7',
  date: '2026-08-07',
  checkIn: '2026-08-07T09:00:00.000Z',
  checkOut: null,
  status: 'In Session',
  totalHours: 0,
  breaks: []
};

test('active attendance session survives refresh without fabricating checkout', () => {
  const [record] = mapAttendanceApiRecords([activeRow]);
  assert.equal(record.status, 'In Session');
  assert.equal(record.checkOut, undefined);
});

test('active attendance session survives login and session hydration', () => {
  const afterLogin = mapAttendanceApiRecords([activeRow]);
  const afterHydration = mapAttendanceApiRecords([activeRow]);
  assert.deepEqual(afterLogin, afterHydration);
  assert.equal(afterLogin[0].checkOut, undefined);
});

test('active break restores elapsed state and remains manageable', () => {
  const restored = restoreActiveBreak({
    userId: 'usr-7',
    breakType: 'Other',
    startedAtUtc: '2026-08-07T09:00:00.000Z'
  }, 'usr-7', Date.parse('2026-08-07T09:05:00.000Z'));
  assert.equal(restored?.isBreaking, true);
  assert.equal(restored?.elapsedSeconds, 300);
});

