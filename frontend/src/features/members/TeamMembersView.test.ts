import assert from 'node:assert/strict';
import test from 'node:test';
import { getMemberDirectoryRole } from './memberRole.js';

const activeLeadIds = new Set(['usr-2']);

test('directory derives Team Lead from active project leadership', () => {
  assert.equal(getMemberDirectoryRole('Team_Member', 'usr-2', activeLeadIds), 'Team_Lead');
  assert.equal(getMemberDirectoryRole('Team_Member', 'usr-3', activeLeadIds), 'Team_Member');
});

test('project leadership does not replace privileged account roles', () => {
  assert.equal(getMemberDirectoryRole('Admin', 'usr-2', activeLeadIds), 'Admin');
  assert.equal(getMemberDirectoryRole('HR', 'usr-2', activeLeadIds), 'HR');
});
