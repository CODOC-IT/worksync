import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeTaskEditTarget,
  diffTaskEdit,
  formatTaskEditChange,
  summarizeTaskEditFields
} from './taskEditCopy.js';

const snapshot = {
  title: 'Testing',
  description: 'Cover the notification paths.',
  priority: 'Medium' as const,
  startDate: '2026-08-01',
  dueDate: '2026-08-10'
};

test('a top-level task is named on its own, with no subtask wording', () => {
  const target = describeTaskEditTarget('Implement Email Notifications');
  assert.equal(target.isSubtask, false);
  assert.equal(target.noun, 'task');
  assert.equal(target.label, '"Implement Email Notifications"');
  assert.deepEqual(target.metadata, { task: 'Implement Email Notifications' });
});

test('a subtask is always named together with its parent task', () => {
  const target = describeTaskEditTarget('Testing', 'Notification Module');
  assert.equal(target.isSubtask, true);
  assert.equal(target.noun, 'subtask');
  assert.equal(target.label, 'subtask "Testing" under task "Notification Module"');
  assert.deepEqual(target.metadata, { task: 'Notification Module', subtask: 'Testing' });
});

test('two subtasks sharing a title stay distinguishable by their parent', () => {
  const a = describeTaskEditTarget('Testing', 'Notification Module');
  const b = describeTaskEditTarget('Testing', 'Attendance Vault');
  assert.notEqual(a.label, b.label);
  assert.notDeepEqual(a.metadata, b.metadata);
});

test('an unreadable parent degrades to the bare subtask, never an empty "under task"', () => {
  const target = describeTaskEditTarget('Testing', '');
  assert.equal(target.isSubtask, true);
  assert.equal(target.label, 'subtask "Testing"');
  assert.ok(!target.label.includes('under task'));
  assert.deepEqual(target.metadata, { subtask: 'Testing' });
});

test('diff reports only the fields that actually changed', () => {
  assert.deepEqual(diffTaskEdit(snapshot, snapshot), []);

  const changes = diffTaskEdit(snapshot, { ...snapshot, priority: 'High', dueDate: '2026-08-20' });
  assert.deepEqual(changes.map((c) => c.label), ['Priority', 'Due date']);
  assert.equal(changes[0].previousValue, 'Medium');
  assert.equal(changes[0].newValue, 'High');
});

test('a changed field renders as old -> new, and description is summarized not reproduced', () => {
  assert.equal(
    formatTaskEditChange({ label: 'Due date', previousValue: '2026-08-10', newValue: '2026-08-20' }),
    'Due date: "2026-08-10" → "2026-08-20"'
  );
  // A description can be arbitrarily long; the expanded body is a summary of the request, not a
  // replacement for opening it.
  assert.equal(
    formatTaskEditChange({ label: 'Description', previousValue: 'x'.repeat(500), newValue: 'y'.repeat(500) }),
    'Description updated'
  );
});

test('long values are truncated so one field cannot flood the notification body', () => {
  const rendered = formatTaskEditChange({
    label: 'Title',
    previousValue: 'a'.repeat(200),
    newValue: 'b'.repeat(200)
  });
  assert.ok(rendered.includes('...'));
  assert.ok(rendered.length < 200);
});

test('the preview field summary lists the changed fields, with a fallback when empty', () => {
  assert.equal(
    summarizeTaskEditFields(diffTaskEdit(snapshot, { ...snapshot, priority: 'High', title: 'Testing v2' })),
    'Title, Priority'
  );
  assert.equal(summarizeTaskEditFields([]), 'task details');
});
