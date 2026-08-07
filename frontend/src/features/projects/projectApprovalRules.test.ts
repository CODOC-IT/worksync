import assert from 'node:assert/strict';
import test from 'node:test';
import type { ProjectApprovalRequest } from '../../types';
import { countPendingProjectRequests, newestProjectRequestsFirst } from './projectApprovalRules.js';

const request = (
  id: string,
  createdAt: string,
  status: ProjectApprovalRequest['status'] = 'Pending'
): ProjectApprovalRequest => ({
  id,
  projectId: 'prj-1',
  projectTitle: 'Project',
  requestType: 'PROJECT_EDIT',
  requestedByUserId: 'usr-7',
  requestedByName: 'Lead',
  requestedChanges: { title: 'Proposed title' },
  reason: 'Scope update',
  status,
  createdAt
});

test('newest project approval requests appear first', () => {
  const ordered = newestProjectRequestsFirst([
    request('1', '2026-08-01T00:00:00.000Z'),
    request('2', '2026-08-03T00:00:00.000Z'),
    request('3', '2026-08-02T00:00:00.000Z')
  ]);
  assert.deepEqual(ordered.map((item) => item.id), ['2', '3', '1']);
});

test('sidebar count matches pending persisted project requests', () => {
  assert.equal(countPendingProjectRequests([
    request('1', '2026-08-01T00:00:00.000Z'),
    request('2', '2026-08-02T00:00:00.000Z', 'Approved'),
    request('3', '2026-08-03T00:00:00.000Z')
  ]), 2);
});

