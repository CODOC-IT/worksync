import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProjectDecisionMessage,
  projectDecisionEffect,
  resolveCreateParticipants,
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

test('current lead cannot be removed without replacement', () => {
  const result = resolveUpdatedParticipants('usr-7', undefined, ['usr-8']);
  assert.match(result.error || '', /cannot be removed/i);
});

test('replacement lead is automatically included in members', () => {
  const result = resolveUpdatedParticipants('usr-7', 'usr-8', ['usr-9']);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.memberIds, ['usr-9', 'usr-8']);
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
