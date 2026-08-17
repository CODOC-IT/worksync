import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildIncomingLeadCopy,
  buildLeadTaskReassignmentCopy,
  buildMemberMovedCopy,
  buildMoveReassignmentCopy,
  buildOutgoingLeadCopy,
  buildRemovalReassignmentCopy,
  buildTeamLeadAssignmentCopy,
  buildTeamMemberAddedCopy,
  pluralizeTasks,
  type TeamNotificationCopy
} from './teamNotificationCopy.js';

const team = { name: 'Backend Team', description: 'Backend API development and database integration.' };
const project = 'ERP Management System';

const tasks = [
  { title: 'API Integration', isSubtask: false },
  { title: 'Wire up auth', isSubtask: true },
  { title: 'Schema migration', isSubtask: false }
];

// --- §2/§3 assignment copy ---------------------------------------------------------------------

test('Team Lead assignment names the team and the project, and distinguishes the lead role', () => {
  const copy = buildTeamLeadAssignmentCopy({ actorName: 'Ahmed', projectName: project, team });
  assert.equal(copy.message, 'Ahmed assigned you as Team Lead of the "Backend Team" in project "ERP Management System".');
  assert.equal(copy.metadata.role, 'Team Lead');
  assert.match(copy.detail, /Team Responsibility: Backend API development and database integration\./);
});

test('Team Member added reads as membership, never as a lead assignment', () => {
  const copy = buildTeamMemberAddedCopy({ actorName: 'Ahmed', projectName: project, team });
  assert.equal(copy.message, 'Ahmed added you to the "Backend Team" in project "ERP Management System".');
  assert.equal(copy.metadata.role, 'Team Member');
  assert.doesNotMatch(copy.message, /Team Lead/, 'a plain member must never be told they lead the team');
});

test('a team with no responsibility recorded simply omits it rather than printing an empty label', () => {
  const copy = buildTeamMemberAddedCopy({ actorName: 'Ahmed', projectName: project, team: { name: 'Backend Team' } });
  assert.doesNotMatch(copy.detail, /Team Responsibility/);
  assert.equal(copy.metadata.teamResponsibility, undefined);
});

test('an approval-time assignment credits the approving Admin, not the proposer', () => {
  const copy = buildTeamLeadAssignmentCopy({
    actorName: 'Ahmed', projectName: project, team, approvedFromProposalBy: 'Ahmed'
  });
  assert.equal(copy.metadata.approvedBy, 'Ahmed');
});

// --- §4 removal ---------------------------------------------------------------------------------

test('removal tells the team lead who was removed and how much work needs reassignment', () => {
  const copy = buildRemovalReassignmentCopy({
    actorName: 'Ahmed', memberName: 'Bilal', projectName: project, team, tasks
  });
  assert.equal(
    copy.message,
    'Ahmed removed Bilal from project "ERP Management System". Bilal still has 3 tasks that require reassignment.'
  );
  assert.equal(copy.metadata.tasksNeedingReassignment, '3');
  for (const task of tasks) assert.match(copy.detail, new RegExp(task.title));
});

test('a single stranded task is counted in the singular', () => {
  const copy = buildRemovalReassignmentCopy({
    actorName: 'Ahmed', memberName: 'Bilal', projectName: project, team, tasks: [tasks[0]]
  });
  assert.match(copy.message, /still has 1 task that require/);
  assert.equal(pluralizeTasks(1), '1 task');
  assert.equal(pluralizeTasks(0), '0 tasks');
});

test('a long list of stranded tasks is capped rather than flooding the expanded body', () => {
  const many = Array.from({ length: 9 }, (_, index) => ({ title: `Task ${index + 1}`, isSubtask: false }));
  const copy = buildRemovalReassignmentCopy({
    actorName: 'Ahmed', memberName: 'Bilal', projectName: project, team, tasks: many
  });
  assert.match(copy.detail, /…and 4 more/);
  assert.doesNotMatch(copy.detail, /Task 6/);
  assert.equal(copy.metadata.tasksNeedingReassignment, '9', 'the true count is still reported');
});

test('a subtask is labelled as one in the affected-work list', () => {
  const copy = buildRemovalReassignmentCopy({
    actorName: 'Ahmed', memberName: 'Bilal', projectName: project, team, tasks: [tasks[1]]
  });
  assert.match(copy.detail, /• Wire up auth \(subtask\)/);
});

// --- §6 move ------------------------------------------------------------------------------------

test('the moved member is told both ends of the move, not only the destination', () => {
  const copy = buildMemberMovedCopy({
    actorName: 'Ahmed',
    projectName: project,
    fromTeam: { name: 'Team C' },
    toTeam: { name: 'Team Y', description: 'Frontend delivery.' }
  });
  assert.equal(copy.message, 'Ahmed moved you from the "Team C" to the "Team Y" in project "ERP Management System".');
  assert.equal(copy.metadata.previousTeam, 'Team C');
  assert.equal(copy.metadata.newTeam, 'Team Y');
});

test('the previous team lead hears what the move stranded, phrased from their side', () => {
  const copy = buildMoveReassignmentCopy({
    actorName: 'Ahmed',
    memberName: 'Bilal',
    projectName: project,
    team: { name: 'Team C' },
    fromTeam: { name: 'Team C' },
    toTeam: { name: 'Team Y' },
    tasks: tasks.slice(0, 2)
  });
  assert.equal(copy.message, 'Bilal has been moved from your team. 2 tasks assigned to them require reassignment.');
  assert.equal(copy.metadata.team, 'Team C', 'scoped to the team losing the member, not the receiving one');
  assert.equal(copy.metadata.movedTo, 'Team Y');
});

// --- §5 lead change -----------------------------------------------------------------------------

const leadChange = {
  actorName: 'Ahmed',
  projectName: project,
  team,
  outgoingLeadName: 'Bilal',
  newLeadName: 'Maryam Ahmed',
  reassignedTasks: tasks.slice(0, 2)
};

test('the outgoing lead is told who replaced them', () => {
  const copy = buildOutgoingLeadCopy(leadChange);
  assert.equal(
    copy.message,
    'Ahmed changed the Team Lead of the "Backend Team" in "ERP Management System" to Maryam Ahmed.'
  );
  assert.equal(copy.metadata.newTeamLead, 'Maryam Ahmed');
  assert.match(copy.detail, /2 tasks assigned to you as Team Lead have been reassigned to Maryam Ahmed/);
});

test('the incoming lead is told whom they replaced and what came with the role', () => {
  const copy = buildIncomingLeadCopy(leadChange);
  assert.equal(
    copy.message,
    'Ahmed assigned you as the Team Lead of the "Backend Team" in "ERP Management System".'
  );
  assert.match(copy.detail, /replacing Bilal/);
  assert.equal(copy.metadata.tasksReassigned, '2');
});

test('a lead change with no open work says nothing about reassignment', () => {
  const copy = buildOutgoingLeadCopy({ ...leadChange, reassignedTasks: [] });
  assert.doesNotMatch(copy.detail, /reassigned/);
  assert.equal(copy.metadata.tasksReassigned, '0');
});

test('each automatically reassigned task explains why it arrived', () => {
  const copy = buildLeadTaskReassignmentCopy({
    taskTitle: 'API Integration',
    isSubtask: false,
    teamName: 'Backend Team',
    projectName: project,
    previousAssigneeName: 'Bilal',
    actorName: 'Ahmed'
  });
  assert.equal(
    copy.message,
    'Task "API Integration" was reassigned to you because you are now the Team Lead of the "Backend Team".'
  );
  assert.equal(copy.metadata.reason, 'Team Lead change');
  assert.equal(copy.metadata.previousAssignee, 'Bilal');
});

test('a reassigned subtask is named as a subtask throughout', () => {
  const copy = buildLeadTaskReassignmentCopy({
    taskTitle: 'Wire up auth',
    isSubtask: true,
    teamName: 'Backend Team',
    projectName: project,
    previousAssigneeName: 'Bilal',
    actorName: 'Ahmed'
  });
  assert.equal(copy.title, 'Subtask Reassigned');
  assert.match(copy.message, /^Subtask "Wire up auth"/);
  assert.equal(copy.metadata.subtask, 'Wire up auth');
  assert.equal(copy.metadata.task, undefined, 'a subtask must not also be reported under a `task` key');
});

// --- §12/§13 cross-cutting guarantees -----------------------------------------------------------

const everyCopy = (): TeamNotificationCopy[] => [
  buildTeamLeadAssignmentCopy({ actorName: 'Ahmed', projectName: project, team }),
  buildTeamMemberAddedCopy({ actorName: 'Ahmed', projectName: project, team }),
  buildRemovalReassignmentCopy({ actorName: 'Ahmed', memberName: 'Bilal', projectName: project, team, tasks }),
  buildMoveReassignmentCopy({
    actorName: 'Ahmed', memberName: 'Bilal', projectName: project, team,
    fromTeam: { name: 'Team C' }, toTeam: { name: 'Team Y' }, tasks
  }),
  buildMemberMovedCopy({
    actorName: 'Ahmed', projectName: project, fromTeam: { name: 'Team C' }, toTeam: { name: 'Team Y' }
  }),
  buildOutgoingLeadCopy(leadChange),
  buildIncomingLeadCopy(leadChange),
  buildLeadTaskReassignmentCopy({
    taskTitle: 'API Integration', isSubtask: false, teamName: 'Backend Team',
    projectName: project, previousAssigneeName: 'Bilal', actorName: 'Ahmed'
  })
];

test('no template can emit an internal id or a vague actor (§12)', () => {
  for (const copy of everyCopy()) {
    const text = [copy.title, copy.message, copy.detail, JSON.stringify(copy.metadata)].join(' ');
    assert.doesNotMatch(text, /\busr-\d+\b/, `internal user id leaked into: ${copy.message}`);
    assert.doesNotMatch(text, /\b(prj|tm|tsk)-\d+\b/, `internal id leaked into: ${copy.message}`);
    assert.doesNotMatch(text, /\bSomeone\b/, `vague actor in: ${copy.message}`);
    assert.doesNotMatch(text, /\bUnknown user\b/, `unresolved actor in: ${copy.message}`);
  }
});

test('the compact preview stays short and never carries the reason or the task list (§13)', () => {
  for (const copy of everyCopy()) {
    assert.ok(copy.message.length <= 160, `preview too long (${copy.message.length}): ${copy.message}`);
    assert.doesNotMatch(copy.message, /^Reason:|\bReason: /, `reason belongs in detail: ${copy.message}`);
    assert.doesNotMatch(copy.message, /•/, `the task list belongs in detail: ${copy.message}`);
    assert.ok(copy.message.trim().endsWith('.'), `preview should read as a sentence: ${copy.message}`);
  }
});

test('every template supplies a title, a preview and an expanded body', () => {
  for (const copy of everyCopy()) {
    assert.ok(copy.title.trim().length > 0);
    assert.ok(copy.message.trim().length > 0);
    assert.ok(copy.detail.trim().length > 0);
    assert.ok(Object.keys(copy.metadata).length > 0);
  }
});

test('every template names the project it concerns', () => {
  for (const copy of everyCopy()) {
    const text = `${copy.message} ${copy.detail} ${JSON.stringify(copy.metadata)}`;
    assert.match(text, /ERP Management System/, `project not identified in: ${copy.message}`);
  }
});
