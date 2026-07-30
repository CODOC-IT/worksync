import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReplyToDiscussion,
  canStartDiscussion,
  hasGlobalDiscussionAccess
} from './discussion.access.js';

test('Admin and HR can access discussions across all projects', () => {
  assert.equal(hasGlobalDiscussionAccess('Admin'), true);
  assert.equal(hasGlobalDiscussionAccess('HR'), true);
  assert.equal(hasGlobalDiscussionAccess('Team_Lead'), false);
  assert.equal(hasGlobalDiscussionAccess('Team_Member'), false);
});

test('HR can reply but cannot start a discussion', () => {
  assert.equal(canReplyToDiscussion('HR'), true);
  assert.equal(canStartDiscussion('HR'), false);
});

test('project participants can start and reply without receiving global access', () => {
  for (const role of ['Team_Lead', 'Team_Member']) {
    assert.equal(canStartDiscussion(role), true);
    assert.equal(canReplyToDiscussion(role), true);
    assert.equal(hasGlobalDiscussionAccess(role), false);
  }
});
