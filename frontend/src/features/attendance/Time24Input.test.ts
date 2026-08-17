import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adjust24hDraft,
  format24hTime,
  isComplete24hTime,
  isValid24hTime,
  normalize24hDraft,
  parse24hTime
} from './Time24Input.tsx';

test('24-hour time input only accepts HH:mm values', () => {
  const valid = ['00:00', '02:30', '04:12', '12:00', '16:00', '18:45', '23:59'];
  valid.forEach((value) => assert.equal(isValid24hTime(value), true, value));
  const invalid = ['24:00', '12:60', '4:00', '4:05', '12:00 PM', '4:12 AM', '16:0', '16', '', '12:00:00'];
  invalid.forEach((value) => assert.equal(isValid24hTime(value), false, value));
});

test('normalize24hDraft masks typed input into HH:mm with no AM/PM fragment', () => {
  assert.equal(normalize24hDraft('1'), '1');
  assert.equal(normalize24hDraft('16'), '16');
  assert.equal(normalize24hDraft('1605'), '16:05');
  assert.equal(normalize24hDraft('164500'), '16:45');
  assert.equal(normalize24hDraft('1200 PM'), '12:00');
  assert.equal(normalize24hDraft('04:12 AM'), '04:12');
  assert.equal(normalize24hDraft(''), '');
});

test('isComplete24hTime reports a full HH:mm draft only', () => {
  assert.equal(isComplete24hTime('16:45'), true);
  assert.equal(isComplete24hTime('23:59'), true);
  assert.equal(isComplete24hTime('00:00'), true);
  assert.equal(isComplete24hTime('16'), false);
  assert.equal(isComplete24hTime('16:'), false);
  assert.equal(isComplete24hTime('16:4'), false);
});

test('parse24hTime and format24hTime round-trip', () => {
  assert.deepEqual(parse24hTime('04:12'), { hour: 4, minute: 12 });
  assert.deepEqual(parse24hTime('16:00'), { hour: 16, minute: 0 });
  assert.deepEqual(parse24hTime('23:59'), { hour: 23, minute: 59 });
  assert.equal(parse24hTime('25:00'), null);
  assert.equal(format24hTime(4, 12), '04:12');
  assert.equal(format24hTime(23, 59), '23:59');
  assert.equal(format24hTime(0, 0), '00:00');
});

test('arrow adjustment steps hour/minutes with 24-hour wrapping', () => {
  assert.equal(adjust24hDraft('16:45', 0, 1), '17:45');
  assert.equal(adjust24hDraft('23:45', 0, 1), '00:45');
  assert.equal(adjust24hDraft('00:45', 0, -1), '23:45');
  assert.equal(adjust24hDraft('16:45', 4, 1), '16:46');
  assert.equal(adjust24hDraft('16:59', 4, 1), '16:00');
  assert.equal(adjust24hDraft('16:00', 4, -1), '16:59');
  assert.equal(adjust24hDraft('', 0, 1), '01:00');
  assert.equal(adjust24hDraft('16', 0, 1), '17:00');
});