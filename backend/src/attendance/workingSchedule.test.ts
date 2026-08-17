import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SHIFT_BREAK_MINUTES,
  DEFAULT_SHIFT_NET_MINUTES,
  DEFAULT_SHIFT_WINDOW_MINUTES,
  SHIFT_TIME_PATTERN,
  halfDayBoundaryTime,
  minutesToTime,
  scheduleNetMinutes,
  scheduleWindowMinutes,
  timeToMinutes
} from './workingSchedule.js';

test('the fixed schedule constants match 8h / 60m / 7h', () => {
  assert.equal(DEFAULT_SHIFT_WINDOW_MINUTES, 480);
  assert.equal(DEFAULT_SHIFT_BREAK_MINUTES, 60);
  assert.equal(DEFAULT_SHIFT_NET_MINUTES, 420);
});

test('halfDayBoundaryTime is derived from the configured shift, not a fixed noon', () => {
  assert.equal(halfDayBoundaryTime('16:00', '00:00'), '20:00');
  assert.equal(halfDayBoundaryTime('18:00', '02:00'), '22:00');
  assert.equal(halfDayBoundaryTime('09:00', '17:00'), '13:00');
  assert.equal(halfDayBoundaryTime('09:00', '00:00'), '16:30');
  assert.equal(halfDayBoundaryTime(null, '17:00'), null);
});

test('scheduleWindowMinutes handles a same-day window', () => {
  assert.equal(scheduleWindowMinutes('09:00', '17:00'), 480);
  assert.equal(scheduleWindowMinutes('08:00', '16:00'), 480);
  assert.equal(scheduleWindowMinutes('00:00', '12:00'), 720);
  assert.equal(scheduleWindowMinutes('12:00', '12:30'), 30);
});

test('scheduleWindowMinutes handles an overnight window (end < start)', () => {
  assert.equal(scheduleWindowMinutes('16:00', '00:00'), 480);
  assert.equal(scheduleWindowMinutes('22:00', '06:00'), 480);
  assert.equal(scheduleWindowMinutes('23:00', '01:00'), 120);
  assert.equal(scheduleWindowMinutes('23:59', '00:01'), 2);
});

test('scheduleWindowMinutes misuses', () => {
  assert.equal(scheduleWindowMinutes(null, null), null);
  assert.equal(scheduleWindowMinutes('09:00', null), null);
  assert.equal(scheduleWindowMinutes('09:00', '09:00'), 0);
});

test('scheduleNetMinutes derives the expected net from the window', () => {
  assert.equal(scheduleNetMinutes('16:00', '00:00', 60), 420);
  assert.equal(scheduleNetMinutes('09:00', '17:00', 60), 420);
  assert.equal(scheduleNetMinutes('09:00', '17:00', 0), 480);
});

test('scheduleNetMinutes never goes below zero and falls back to 7h without times', () => {
  assert.equal(scheduleNetMinutes('09:00', '10:00', 60), 0);
  assert.equal(scheduleNetMinutes(null, null, 60), DEFAULT_SHIFT_NET_MINUTES);
  assert.equal(scheduleNetMinutes(undefined, undefined, undefined), DEFAULT_SHIFT_NET_MINUTES);
});

test('timeToMinutes and minutesToTime round-trip over midnight', () => {
  assert.equal(timeToMinutes('00:00'), 0);
  assert.equal(timeToMinutes('16:00'), 960);
  assert.equal(timeToMinutes('23:59'), 1439);
  assert.equal(minutesToTime(960), '16:00');
  assert.equal(minutesToTime(1439), '23:59');
  assert.equal(minutesToTime(0), '00:00');
});

test('SHIFT_TIME_PATTERN only allows HH:mm 24-hour times', () => {
  assert.ok(SHIFT_TIME_PATTERN.test('00:00'));
  assert.ok(SHIFT_TIME_PATTERN.test('16:00'));
  assert.ok(SHIFT_TIME_PATTERN.test('23:59'));
  assert.ok(!SHIFT_TIME_PATTERN.test('4:00'));
  assert.ok(!SHIFT_TIME_PATTERN.test('24:00'));
  assert.ok(!SHIFT_TIME_PATTERN.test('12:60'));
  assert.ok(!SHIFT_TIME_PATTERN.test('12'));
  assert.ok(!SHIFT_TIME_PATTERN.test('12:00 PM'));
});