import test from 'node:test';
import assert from 'node:assert/strict';
import { businessDateSql, localTimestampSql } from './businessTime.js';

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

