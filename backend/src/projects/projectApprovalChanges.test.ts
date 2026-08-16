import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProjectDTO } from './project.types.js';
import {
  buildProjectEditPayload,
  conflictingProjectFields,
  enrichProjectEditPayload,
  parseProjectEditPayload,
  resolveProjectUserIdentity
} from './projectApprovalChanges.js';

const project = (overrides: Partial<ProjectDTO> = {}): ProjectDTO => ({
  id: 'prj-1', code: 'PRJ-1', title: 'Old Name', description: 'Old description',
  status: 'Active', approvalStatus: 'Approved', createdBy: 'usr-1', teamLeadId: 'usr-2',
  memberIds: ['usr-2', 'usr-3'], pendingRemovalMemberIds: [], teams: [], startDate: '2026-08-01',
  targetDate: '2026-08-20', priority: 'Medium', progress: 0, tags: [], createdAt: '2026-08-01',
  milestones: [], files: [], ...overrides
});

test('project edit persists only changed old and proposed values', () => {
  const payload = buildProjectEditPayload(project(), {
    title: 'New Name', description: 'Old description', targetDate: '2026-08-25', priority: 'Medium'
  });
  assert.deepEqual(payload.changes.map((change) => change.fieldKey), ['title', 'targetDate']);
  assert.deepEqual(payload.changes[0], {
    fieldKey: 'title', fieldLabel: 'Project Name', oldValue: 'Old Name', newValue: 'New Name'
  });
  assert.deepEqual(payload.proposal, { title: 'New Name', targetDate: '2026-08-25' });
  assert.deepEqual(parseProjectEditPayload(JSON.stringify(payload)), payload);
});

test('empty edit has no changes and can be blocked by the service', () => {
  const payload = buildProjectEditPayload(project(), { title: ' Old Name ', memberIds: ['usr-3', 'usr-2'] });
  assert.equal(payload.changes.length, 0);
  assert.deepEqual(payload.proposal, {});
});

test('lead and member IDs resolve to names with added, removed, and missing-user fallback', () => {
  const payload = buildProjectEditPayload(project(), {
    teamLeadId: 'usr-4', memberIds: ['usr-3', 'usr-4', 'usr-99']
  });
  const names: Record<string, string> = { 'usr-2': 'Tester', 'usr-3': 'John Doe', 'usr-4': 'Abiha' };
  const display = enrichProjectEditPayload(payload, (id) => names[id] || `Unknown user (ID: ${id})`) as any;
  const lead = display.changes.find((change: any) => change.fieldKey === 'teamLeadId');
  const members = display.changes.find((change: any) => change.fieldKey === 'memberIds');
  assert.equal(lead.oldDisplayValue, 'Tester');
  assert.equal(lead.newDisplayValue, 'Abiha');
  assert.deepEqual(members.removed, ['Tester']);
  assert.deepEqual(members.added, ['Abiha', 'Unknown user (ID: usr-99)']);
});

test('requester ID resolves to authoritative requester identity', () => {
  assert.deepEqual(resolveProjectUserIdentity('usr-7', [{
    id: 'usr-7', name: 'Abiha', role: 'Team_Lead', email: 'abiha@example.com'
  }]), {
    id: 'usr-7', name: 'Abiha', role: 'Team_Lead', email: 'abiha@example.com'
  });
  assert.equal(resolveProjectUserIdentity('usr-404', []).name, 'Unknown user (ID: usr-404)');
});

test('approval conflict detection protects changed fields but permits unrelated changes', () => {
  const payload = buildProjectEditPayload(project(), { description: 'Proposed description' });
  assert.deepEqual(conflictingProjectFields(project({ title: 'Unrelated newer title' }), payload), []);
  assert.deepEqual(conflictingProjectFields(project({ description: 'Newer description' }), payload), ['Description']);
});
