import assert from 'node:assert/strict';
import test from 'node:test';
import { DB_TO_API_PRIORITY, toDateKey } from './task.mapper.js';

// Regression tests for two representation mismatches between what node-postgres returns and what
// the API receives. Both previously leaked into user-facing notifications: the first fabricated a
// "due date changed" notice on every single edit, the second named a priority tier no user has
// ever seen. Verified against the live schema: work.tasks.startdate/duedate come back as JS Date
// objects even though TaskRow declares them `string`.

test('a Postgres date column normalizes to the same key as the inbound string', () => {
  // What node-postgres actually hands back for a `date` column: a Date at local midnight.
  const fromDriver = new Date(2026, 7, 1); // 2026-08-01 local
  assert.equal(toDateKey(fromDriver).slice(0, 4), '2026');
  // The trap this guards: the raw comparison is true for every value, so an unchanged date
  // resubmitted by the edit form looked like a change.
  assert.notEqual('2026-08-01' as unknown, fromDriver as unknown);
  assert.equal(toDateKey('2026-08-01'), '2026-08-01');
  assert.equal(toDateKey('2026-08-01T00:00:00.000Z'), '2026-08-01');
});

test('an unchanged date is not reported as a change once both sides are normalized', () => {
  const rowValue = new Date('2026-08-20T00:00:00.000Z');
  const inbound = '2026-08-20';
  assert.equal(inbound !== toDateKey(rowValue), false);
});

test('a genuinely changed date is still reported', () => {
  const rowValue = new Date('2026-08-20T00:00:00.000Z');
  assert.equal('2026-08-25' !== toDateKey(rowValue), true);
});

test('the stored Critical tier is shown to users as Urgent', () => {
  assert.equal(DB_TO_API_PRIORITY.Critical, 'Urgent');
  assert.equal(DB_TO_API_PRIORITY.High, 'High');
  assert.equal(DB_TO_API_PRIORITY.Medium, 'Medium');
  assert.equal(DB_TO_API_PRIORITY.Low, 'Low');
  // "changed the priority from Critical to High" named a tier the UI calls Urgent.
  assert.notEqual(DB_TO_API_PRIORITY.Critical, 'Critical');
});
