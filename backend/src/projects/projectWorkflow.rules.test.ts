import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProjectDecisionMessage,
  projectDecisionEffect,
  resolveCreateParticipants,
  resolveTeamSetup,
  resolveUpdatedParticipants,
  validateProjectDecision
} from './projectWorkflow.rules.js';

test('Team Lead creator becomes project lead and member', () => {
  const result = resolveCreateParticipants('usr-7', 'Team_Lead', undefined, ['usr-8']);
  assert.equal(result.teamLeadId, 'usr-7');
  assert.deepEqual(result.memberIds, ['usr-8', 'usr-7']);
});

test('Team Lead creator cannot assign another lead', () => {
  const result = resolveCreateParticipants('usr-7', 'Team_Lead', 'usr-8', []);
  assert.match(result.error || '', /creator must be the Team Lead/i);
});

test('Admin may choose lead and the new lead automatically becomes a member', () => {
  const result = resolveCreateParticipants('usr-1', 'Admin', 'usr-8', ['usr-9']);
  assert.equal(result.error, undefined);
  assert.equal(result.teamLeadId, 'usr-8');
  assert.deepEqual(result.memberIds, ['usr-9', 'usr-8']);
});

test('a project cannot be created with the Team Lead as its only member', () => {
  const result = resolveCreateParticipants('usr-1', 'Admin', 'usr-8', []);
  assert.match(result.error || '', /at least one member besides the Team Lead/i);
});

test('current lead cannot be removed without replacement', () => {
  const result = resolveUpdatedParticipants('usr-7', undefined, ['usr-8']);
  assert.match(result.error || '', /cannot be removed/i);
});

test('replacement lead is automatically included in members', () => {
  const result = resolveUpdatedParticipants('usr-7', 'usr-8', ['usr-9']);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.memberIds, ['usr-9', 'usr-8']);
});

test('a project cannot be edited down to the Team Lead as its only member', () => {
  const result = resolveUpdatedParticipants('usr-7', undefined, ['usr-7']);
  assert.match(result.error || '', /at least one member besides the Team Lead/i);
});

test('editing an unrelated field without proposing memberIds does not require a non-lead member', () => {
  const result = resolveUpdatedParticipants('usr-7', undefined, undefined);
  assert.equal(result.error, undefined);
  assert.equal(result.memberIds, undefined);
});

test('project approval works without an approval reason', () => {
  assert.equal(validateProjectDecision('Approved', null), null);
});

test('project rejection requires a reason', () => {
  assert.equal(validateProjectDecision('Rejected', '  '), 'A rejection reason is required.');
  assert.equal(validateProjectDecision('Rejected', 'Scope is incomplete.'), null);
});

test('requester receives the persisted rejection reason in the result notification', () => {
  assert.equal(
    buildProjectDecisionMessage('Admin User', 'Rejected', 'edit', 'Apollo', 'Keep the approved scope.'),
    'Admin User rejected your request to edit "Apollo". Reason: Keep the approved scope.'
  );
});

test('rejected project creation is removed instead of archived', () => {
  assert.equal(projectDecisionEffect('PROJECT_CREATE', 'Rejected'), 'remove-rejected-creation');
});

test('Project Edit approval applies proposed values', () => {
  assert.equal(projectDecisionEffect('PROJECT_EDIT', 'Approved'), 'apply-proposed-edit');
});

test('Project Edit rejection preserves original values', () => {
  assert.equal(projectDecisionEffect('PROJECT_EDIT', 'Rejected'), 'discard-proposed-edit');
});

// --- Multi-team setup (resolveTeamSetup) ---------------------------------------------------

test('empty team input signals the legacy single-lead path', () => {
  const result = resolveTeamSetup(undefined);
  assert.deepEqual(result, { teams: [], teamLeadUserIds: [], memberUserIds: [] });
  assert.equal(result.error, undefined);
});

test('a valid multi-team setup flattens leads and members across teams', () => {
  const result = resolveTeamSetup([
    { name: 'Core', description: 'Platform work', leadId: 'usr-1', memberIds: ['usr-2'] },
    { name: 'UI', description: 'Interface work', leadId: 'usr-3', memberIds: ['usr-4', 'usr-5'] }
  ]);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.teamLeadUserIds, ['usr-1', 'usr-3']);
  assert.deepEqual(result.memberUserIds, ['usr-2', 'usr-1', 'usr-4', 'usr-5', 'usr-3']);
  assert.equal(result.teams.length, 2);
  assert.deepEqual(result.teams[0], { name: 'Core', description: 'Platform work', leadId: 'usr-1', memberIds: ['usr-2', 'usr-1'] });
});

test('a team without at least one member besides its lead is rejected', () => {
  const result = resolveTeamSetup([
    { name: 'Core', description: 'Platform work', leadId: 'usr-1', memberIds: [] }
  ]);
  assert.match(result.error || '', /at least one member besides its Team Lead/i);
  assert.deepEqual(result.teams, []);
});

test('a person cannot belong to more than one team in the same project', () => {
  const result = resolveTeamSetup([
    { name: 'Core', description: 'Platform work', leadId: 'usr-1', memberIds: ['usr-2'] },
    { name: 'Ops', description: 'Ops work', leadId: 'usr-3', memberIds: ['usr-2'] }
  ]);
  assert.match(result.error || '', /more than one team/i);
});

test('duplicate team names are rejected case-insensitively', () => {
  const result = resolveTeamSetup([
    { name: 'Core', description: 'Platform work', leadId: 'usr-1', memberIds: ['usr-2'] },
    { name: 'core', description: 'Duplicate', leadId: 'usr-3', memberIds: ['usr-4'] }
  ]);
  assert.match(result.error || '', /duplicate team name/i);
});

test('a team with a missing lead is rejected', () => {
  const result = resolveTeamSetup([
    { name: 'Core', description: 'Platform work', leadId: '', memberIds: ['usr-2'] }
  ]);
  assert.match(result.error || '', /must have a Team Lead/i);
});
