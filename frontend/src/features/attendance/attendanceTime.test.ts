import test from 'node:test';
import assert from 'node:assert/strict';
import { businessDateKey, formatAttendanceTime } from './attendanceTime.js';

test('formats UTC instants once in the configured business timezone', () => {
  assert.equal(formatAttendanceTime('2026-08-05T00:00:00.000Z', 'Asia/Karachi'), '05:00');
  assert.equal(formatAttendanceTime('2026-08-05T05:00:00+05:00', 'Asia/Karachi'), '05:00');
});

test('near-midnight instants map to the business-local work date', () => {
  assert.equal(
    businessDateKey(new Date('2026-08-04T20:30:00.000Z'), 'Asia/Karachi'),
    '2026-08-05'
  );
});

