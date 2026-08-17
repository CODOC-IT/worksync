import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTeamSetup, DraftTeam } from './teamBuilderRules.js';

const team = (overrides: Partial<DraftTeam> = {}): DraftTeam => ({
  id: 'draft-1',
  name: 'Team A',
  description: 'Handles the launch checklist.',
  leadId: 'usr-2',
  memberIds: ['usr-2', 'usr-3'],
  ...overrides
});

test('an empty team list is invalid', () => {
  assert.equal(validateTeamSetup([]), 'Add at least one team.');
});

test('a fully valid single-team setup passes', () => {
  assert.equal(validateTeamSetup([team()]), null);
});

test('a fully valid multi-team setup passes', () => {
  assert.equal(validateTeamSetup([
    team(),
    team({ id: 'draft-2', name: 'Team B', leadId: 'usr-5', memberIds: ['usr-5', 'usr-6'] })
  ]), null);
});

test('a team without a name is rejected', () => {
  assert.equal(validateTeamSetup([team({ name: '  ' })]), 'Every team must have a name.');
});

test('duplicate team names are rejected case-insensitively', () => {
  const message = validateTeamSetup([
    team({ name: 'Team A' }),
    team({ id: 'draft-2', name: 'team a', leadId: 'usr-5', memberIds: ['usr-5', 'usr-6'] })
  ]);
  assert.match(message || '', /Duplicate team name/);
});

test('a team without a description is rejected', () => {
  assert.match(validateTeamSetup([team({ description: '' })]) || '', /needs a description/);
});

test('a team without a Team Lead is rejected', () => {
  assert.match(validateTeamSetup([team({ leadId: '' })]) || '', /needs a Team Lead/);
});

test('a team with fewer than 2 people (lead only) is rejected', () => {
  assert.match(
    validateTeamSetup([team({ memberIds: [] })]) || '',
    /needs at least one member besides its Team Lead/
  );
});

test('a person appearing on more than one team is rejected', () => {
  const message = validateTeamSetup([
    team(),
    team({ id: 'draft-2', name: 'Team B', leadId: 'usr-5', memberIds: ['usr-5', 'usr-3'] })
  ]);
  assert.match(message || '', /cannot be in more than one team/);
});

test('a Team Lead who is not separately listed in memberIds still counts as part of the team', () => {
  // Mirrors TeamBuilder.tsx's setTeamLead, which always folds the lead into memberIds -- this
  // just confirms validateTeamSetup itself doesn't require the caller to have done that.
  assert.equal(validateTeamSetup([team({ leadId: 'usr-2', memberIds: ['usr-3'] })]), null);
});
