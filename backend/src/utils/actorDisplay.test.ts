import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActorMessage } from './actorDisplay.js';

test('normalizes a historical leading Someone placeholder to the known actor', () => {
  assert.equal(
    normalizeActorMessage('Someone archived "Requirements Gathering".', 'Maryam Yousaf'),
    'Maryam Yousaf archived "Requirements Gathering".'
  );
});

test('removes a duplicate Someone suffix after a known actor name', () => {
  assert.equal(
    normalizeActorMessage('Maryam Yousaf Someone archived "Requirements Gathering".', 'Maryam Yousaf'),
    'Maryam Yousaf archived "Requirements Gathering".'
  );
});

test('does not alter unrelated uses of the word someone', () => {
  const message = 'Maryam Yousaf asked someone to review the requirements.';
  assert.equal(normalizeActorMessage(message, 'Maryam Yousaf'), message);
});

test('removes an unresolvable leading placeholder without displaying Someone', () => {
  assert.equal(normalizeActorMessage('Someone archived the project.', null), 'archived the project.');
});

// The same repair, generalized to a raw internal id — the bug this fix actually targets:
// actorDisplayName's old `|| userId` fallback let a userStore cache miss leak "usr-45" straight
// into persisted notification text. Re-running that stored text through this function (see
// notification.mapper.ts's rowToNotificationDTO) self-heals it on every subsequent read, using
// the DB-joined actor name that's always available at read time even if it wasn't at write time.
test('normalizes a leading raw "usr-<n>" id to the known actor', () => {
  assert.equal(
    normalizeActorMessage('usr-45 assigned you "Notifications 2".', 'Bilal Ahmed'),
    'Bilal Ahmed assigned you "Notifications 2".'
  );
});

test('normalizes a leading raw id with a legacy timestamp-style suffix', () => {
  assert.equal(
    normalizeActorMessage('usr-1785174364751 archived "Approval Testing".', 'Bilal Ahmed'),
    'Bilal Ahmed archived "Approval Testing".'
  );
});

test('removes an unresolvable leading raw id without displaying it', () => {
  assert.equal(normalizeActorMessage('usr-40 archived the project.', null), 'archived the project.');
});

test('does not alter a legitimate mid-sentence mention of a task/project id', () => {
  const message = 'Bilal Ahmed linked this notification to tsk-101 for reference.';
  assert.equal(normalizeActorMessage(message, 'Bilal Ahmed'), message);
});
