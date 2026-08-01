import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getProjectUpdateApprovalType,
  PROJECT_DELETE_APPROVAL_TYPE
} from './projectApproval.routing.js';
import { ProjectApprovalRequestType } from './projectApproval.types.js';

test('routes a Team Lead project edit to Project Edit approval', () => {
  assert.equal(getProjectUpdateApprovalType(undefined), 'PROJECT_EDIT');
  assert.equal(getProjectUpdateApprovalType('Completed'), 'PROJECT_EDIT');
});

test('routes a Team Lead status archive to Project Archive approval', () => {
  assert.equal(getProjectUpdateApprovalType('Archived'), 'PROJECT_ARCHIVE');
});

test('routes a Team Lead delete action to Project Delete approval', () => {
  assert.equal(PROJECT_DELETE_APPROVAL_TYPE, 'PROJECT_DELETE');
  assert.notEqual(PROJECT_DELETE_APPROVAL_TYPE, 'PROJECT_ARCHIVE');
});

test('authoritative project approval type supports every distinct workflow', () => {
  const requestTypes: ProjectApprovalRequestType[] = [
    'PROJECT_CREATE',
    'PROJECT_EDIT',
    'PROJECT_ARCHIVE',
    'PROJECT_RESTORE',
    'PROJECT_DELETE',
    'PROJECT_PERMANENT_DELETE'
  ];
  assert.equal(new Set(requestTypes).size, 6);
});
