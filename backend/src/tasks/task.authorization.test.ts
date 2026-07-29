import assert from 'node:assert/strict';
import test from 'node:test';
import { getTaskEditDenialReason } from './task.authorization.js';

test('allows an assignee to edit a leaf parent task', () => {
  assert.equal(getTaskEditDenialReason({
    actorId: 'usr-2',
    assigneeIds: ['usr-2'],
    subtaskCount: 0
  }), null);
});

test('prevents editing a parent task that has subtasks', () => {
  assert.match(getTaskEditDenialReason({
    actorId: 'usr-2',
    assigneeIds: ['usr-2'],
    subtaskCount: 2
  }) || '', /read-only/i);
});

test('allows only a subtask assignee to edit that subtask', () => {
  assert.equal(getTaskEditDenialReason({
    actorId: 'usr-3',
    assigneeIds: ['usr-2', 'usr-3'],
    parentTaskId: 10
  }), null);

  assert.match(getTaskEditDenialReason({
    actorId: 'usr-4',
    assigneeIds: ['usr-2', 'usr-3'],
    parentTaskId: 10
  }) || '', /assigned to this subtask/i);
});
