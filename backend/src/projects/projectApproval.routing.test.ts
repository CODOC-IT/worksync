import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getProjectUpdateApprovalType,
  PROJECT_ARCHIVE_APPROVAL_TYPE
} from './projectApproval.routing.js';

test('routes a Team Lead project edit to Project Edit approval', () => {
  assert.equal(getProjectUpdateApprovalType(undefined), 'PROJECT_EDIT');
  assert.equal(getProjectUpdateApprovalType('Completed'), 'PROJECT_EDIT');
});

test('routes a Team Lead status archive to Project Archive approval', () => {
  assert.equal(getProjectUpdateApprovalType('Archived'), 'PROJECT_ARCHIVE');
});

test('routes a Team Lead archive action to Project Archive approval', () => {
  assert.equal(PROJECT_ARCHIVE_APPROVAL_TYPE, 'PROJECT_ARCHIVE');
});
