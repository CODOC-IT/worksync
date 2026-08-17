import test from 'node:test';
import assert from 'node:assert/strict';
import { businessDateSql, formatBusinessTime, localTimestampSql } from './businessTime.js';

test('business date is derived by applying the configured zone to a UTC instant', () => {
  assert.equal(
    businessDateSql('$1::timestamptz', '$2'),
    '($1::timestamptz AT TIME ZONE $2)::date'
  );
});

test('correction wall-clock values are interpreted in the configured zone, not UTC', () => {
  assert.equal(
    localTimestampSql('$1', '$2', '$3'),
    '(($1)::date + ($2)::time) AT TIME ZONE $3'
  );
});

test('formatBusinessTime renders a PKT wall-clock HH:mm from a UTC instant', () => {
  assert.equal(formatBusinessTime('2026-08-01T20:00:00.000Z'), '01:00');
  assert.equal(formatBusinessTime('2026-08-01T11:00:00.000Z'), '16:00');
  assert.equal(formatBusinessTime('2026-07-31T19:00:00.000Z'), '00:00');
  assert.equal(formatBusinessTime(new Date('2026-08-01T14:10:00.000Z')), '19:10');
  assert.equal(formatBusinessTime('not-a-date'), '');
});

