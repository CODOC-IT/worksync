import test from 'node:test';
import assert from 'node:assert/strict';
import { validateHolidayDate } from './calendar.service.js';

test('past public holiday is blocked while today and future are allowed', () => {
  assert.equal(validateHolidayDate('2026-08-01', '2026-08-02'), 'Holiday date cannot be in the past.');
  assert.equal(validateHolidayDate('2026-08-02', '2026-08-02'), null);
  assert.equal(validateHolidayDate('2026-08-03', '2026-08-02'), null);
});

test('historical holiday may remain unchanged but cannot move to another past date', () => {
  assert.equal(validateHolidayDate('2026-07-01', '2026-08-02', '2026-07-01'), null);
  assert.equal(validateHolidayDate('2026-07-02', '2026-08-02', '2026-07-01'),
    'Holiday date cannot be in the past.');
});
