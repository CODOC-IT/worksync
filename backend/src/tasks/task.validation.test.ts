import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCreateTaskBody, validateUpdateTaskBody } from './task.validation.js';

test('accepts a valid task-assignee update for service-level Team Lead authorization', () => {
  assert.deepEqual(validateUpdateTaskBody({ assigneeIds: ['usr-12', 'usr-18'] }), { valid: true });
});

test('rejects empty and duplicate task-assignee updates', () => {
  assert.equal(validateUpdateTaskBody({ assigneeIds: [] }).valid, false);
  assert.equal(validateUpdateTaskBody({ assigneeIds: ['usr-12', 'usr-12'] }).valid, false);
});

test('accepts an unassigned Admin team handoff shape and rejects malformed team ids', () => {
  const handoff = {
    projectId: 'prj-12', title: 'Team handoff', description: 'Assign this task to the team.',
    priority: 'Medium', startDate: '2026-08-17', dueDate: '2026-08-20', assigneeIds: [], teamId: 'tm-3'
  };
  assert.equal(validateCreateTaskBody(handoff).valid, true);
  assert.equal(validateCreateTaskBody({ ...handoff, teamId: 'not-a-team' }).valid, false);
});
