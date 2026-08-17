import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ProposedTaskSummary,
  buildTaskAssigneeApprovedCopy,
  buildTaskCreateApprovedCopy,
  buildTaskCreateRejectedCopy,
  buildTaskCreateRequestCopy
} from './taskCreateApprovalCopy.js';

const proposal: ProposedTaskSummary = {
  title: 'API Integration',
  projectName: 'ERP Management System',
  teamName: 'Backend Team',
  description: 'Integrate the third-party billing API and cover it with contract tests.',
  priority: 'High',
  dueDate: '2026-09-30',
  assigneeNames: ['Bilal Ahmed'],
  requesterName: 'Maryam Ahmed'
};

test('the Admin request notification names the task, not the project it lives in', () => {
  const copy = buildTaskCreateRequestCopy(proposal);
  assert.equal(copy.message, 'Maryam Ahmed submitted task "API Integration" for approval.');
});

test('the Admin request notification carries everything §7 requires to decide', () => {
  const copy = buildTaskCreateRequestCopy(proposal);
  assert.equal(copy.metadata.project, 'ERP Management System');
  assert.equal(copy.metadata.team, 'Backend Team');
  assert.equal(copy.metadata.task, 'API Integration');
  assert.equal(copy.metadata.assignee, 'Bilal Ahmed');
  assert.equal(copy.metadata.priority, 'High');
  assert.equal(copy.metadata.deadline, '2026-09-30');
  assert.equal(copy.metadata.requestingTeamLead, 'Maryam Ahmed');
  assert.match(copy.detail, /Integrate the third-party billing API/);
});

test('approval tells the requesting Team Lead their task is live', () => {
  const copy = buildTaskCreateApprovedCopy(proposal, 'Admin Ahmed');
  assert.equal(copy.message, 'Admin Ahmed approved task "API Integration".');
  assert.equal(copy.metadata.status, 'Approved');
  assert.equal(copy.metadata.approvedBy, 'Admin Ahmed (Admin)');
});

test('rejection names the task and keeps the persisted reason out of the preview', () => {
  const reason = 'The task deadline conflicts with the project milestone.';
  const copy = buildTaskCreateRejectedCopy(proposal, 'Admin Ahmed', reason);
  assert.equal(copy.message, 'Admin Ahmed rejected task "API Integration".');
  assert.doesNotMatch(copy.message, /deadline conflicts/, 'the reason belongs in the expanded body (§13)');
  assert.match(copy.detail, new RegExp(`Reason: ${reason.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  assert.equal(copy.metadata.rejectionReason, reason);
  assert.equal(copy.metadata.status, 'Rejected');
});

test('a rejection recorded with no reason still reads as a complete sentence', () => {
  const copy = buildTaskCreateRejectedCopy(proposal, 'Admin Ahmed', '   ');
  assert.match(copy.detail, /Reason: No reason was recorded\./);
  assert.equal(copy.metadata.rejectionReason, '');
});

test('the assignee hears the task is now theirs, and who approved it', () => {
  const copy = buildTaskAssigneeApprovedCopy(proposal, 'Admin Ahmed');
  assert.equal(copy.message, 'Task "API Integration" is now approved and assigned to you.');
  assert.match(copy.detail, /proposed by Maryam Ahmed/);
});

test('a proposal with no assignee yet reads as awaiting the Team Lead, never as blank', () => {
  const copy = buildTaskCreateRequestCopy({ ...proposal, assigneeNames: [] });
  assert.equal(copy.metadata.assignee, 'Unassigned — awaiting the Team Lead');
  assert.doesNotMatch(copy.detail, /Assignee:\s*$/m);
});

test('optional fields are omitted rather than rendered empty', () => {
  const copy = buildTaskCreateRequestCopy({
    title: 'API Integration',
    projectName: 'ERP Management System',
    assigneeNames: ['Bilal Ahmed'],
    requesterName: 'Maryam Ahmed'
  });
  assert.equal(copy.metadata.priority, undefined);
  assert.equal(copy.metadata.deadline, undefined);
  assert.equal(copy.metadata.team, undefined);
  assert.doesNotMatch(copy.detail, /Priority:|Deadline:|Description:/);
});

test('no task approval template leaks an internal id or a vague actor (§12)', () => {
  const copies = [
    buildTaskCreateRequestCopy(proposal),
    buildTaskCreateApprovedCopy(proposal, 'Admin Ahmed'),
    buildTaskCreateRejectedCopy(proposal, 'Admin Ahmed', 'Not this sprint.'),
    buildTaskAssigneeApprovedCopy(proposal, 'Admin Ahmed')
  ];
  for (const copy of copies) {
    const text = [copy.title, copy.message, copy.detail, JSON.stringify(copy.metadata)].join(' ');
    assert.doesNotMatch(text, /\busr-\d+\b/, `internal id leaked into: ${copy.message}`);
    assert.doesNotMatch(text, /\bSomeone\b|\bUnknown user\b/, `vague actor in: ${copy.message}`);
    // Every one of these is about a specific task; naming only the project was the original defect.
    assert.match(copy.message, /API Integration/, `task not named in preview: ${copy.message}`);
    assert.ok(copy.message.length <= 160, `preview too long: ${copy.message}`);
  }
});
