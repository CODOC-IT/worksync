import assert from 'node:assert/strict';
import test from 'node:test';
import { validateUpdateTaskBody } from './task.validation.js';

test('accepts a valid task-assignee update for service-level Team Lead authorization', () => {
  assert.deepEqual(validateUpdateTaskBody({ assigneeIds: ['usr-12', 'usr-18'] }), { valid: true });
});

test('rejects empty and duplicate task-assignee updates', () => {
  assert.equal(validateUpdateTaskBody({ assigneeIds: [] }).valid, false);
  assert.equal(validateUpdateTaskBody({ assigneeIds: ['usr-12', 'usr-12'] }).valid, false);
});
