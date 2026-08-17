import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectApprovalRequest } from '../../types';
import { formatProjectChangeValue, projectEditChanges } from './projectApprovalDisplay.js';

const request = (changes: unknown[]): ProjectApprovalRequest => ({
  id: 'approval-1', projectId: 'prj-1', projectTitle: 'ERP', requestType: 'PROJECT_EDIT',
  requestedByUserId: 'usr-2', requestedByName: 'Abiha', requestedByRole: 'Team_Lead',
  requestedChanges: { version: 1, proposal: {}, changes }, reason: 'Update schedule',
  status: 'Pending', createdAt: '2026-08-07T12:00:00.000Z'
});

test('Approval Inbox helper retains readable before and after details', () => {
  const changes = projectEditChanges(request([{
    fieldKey: 'description', fieldLabel: 'Description', oldDisplayValue: 'Before', newDisplayValue: 'After'
  }]));
  assert.equal(changes[0].fieldLabel, 'Description');
  assert.equal(formatProjectChangeValue('description', changes[0].oldDisplayValue), 'Before');
  assert.equal(formatProjectChangeValue('description', changes[0].newDisplayValue), 'After');
});

test('dates and arrays render readably without raw objects', () => {
  assert.match(formatProjectChangeValue('targetDate', '2026-08-25'), /2026/);
  assert.equal(formatProjectChangeValue('memberIds', ['Abiha', 'John Doe']), 'Abiha, John Doe');
  assert.equal(formatProjectChangeValue('description', { raw: true }), 'Not provided');
});
