import assert from 'node:assert/strict';
import test from 'node:test';
import { shouldAnnounceProjectCompletion } from './task.projectCompletion.js';

const EARLIER = new Date('2026-08-01T10:00:00Z');
const LATER = new Date('2026-08-01T12:00:00Z');

test('announces when the final outstanding task is completed', () => {
  assert.equal(shouldAnnounceProjectCompletion({
    total: 3, completed: 3, lastAnnouncedAt: null, lastReopenedAt: null
  }), true);
});

test('stays silent while any task is still outstanding', () => {
  assert.equal(shouldAnnounceProjectCompletion({
    total: 3, completed: 2, lastAnnouncedAt: null, lastReopenedAt: null
  }), false);
});

test('never announces a project that has no tasks at all', () => {
  assert.equal(shouldAnnounceProjectCompletion({
    total: 0, completed: 0, lastAnnouncedAt: null, lastReopenedAt: null
  }), false);
});

// The core "only once" guarantee: re-running the check after an announcement — which happens on
// every subsequent approval, edit, or retry while the project stays complete — must not re-fire.
test('does not announce the same completion twice', () => {
  assert.equal(shouldAnnounceProjectCompletion({
    total: 3, completed: 3, lastAnnouncedAt: EARLIER, lastReopenedAt: null
  }), false);
});

test('does not re-announce when the last reopen predates the announcement', () => {
  assert.equal(shouldAnnounceProjectCompletion({
    total: 2, completed: 2, lastAnnouncedAt: LATER, lastReopenedAt: EARLIER
  }), false);
});

// A reopened-then-refinished project is a genuinely new completion, so it announces again.
test('announces again after the project was reopened and completed once more', () => {
  assert.equal(shouldAnnounceProjectCompletion({
    total: 2, completed: 2, lastAnnouncedAt: EARLIER, lastReopenedAt: LATER
  }), true);
});
