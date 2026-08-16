import test from 'node:test';
import assert from 'node:assert/strict';
import type { Project } from '../../types';
import { canCreateProject, canManageProjectTeams, isCurrentProjectLead, projectCardActions } from './projectActionRules.js';

const project = (overrides: Partial<Project> = {}): Project => ({
  id: 'prj-1', code: 'PRJ-1', title: 'ERP', description: 'ERP project', status: 'Active',
  approvalStatus: 'Approved', createdBy: 'usr-1', teamLeadId: 'usr-2',
  memberIds: ['usr-2', 'usr-3'], pendingRemovalMemberIds: [], teams: [], startDate: '2026-08-01',
  targetDate: '2026-08-31', priority: 'Medium', progress: 0, tags: [], createdAt: '2026-08-01',
  milestones: [], files: [], ...overrides
});

test('Admin keeps the full status-appropriate project actions', () => {
  assert.deepEqual(projectCardActions('Admin', 'usr-1', project()), ['edit', 'archive']);
  assert.deepEqual(projectCardActions('Admin', 'usr-1', project({ status: 'Archived' })), [
    'edit', 'restore', 'permanent-delete'
  ]);
});

test('project-scoped Team Lead receives the existing limited actions including Edit', () => {
  assert.equal(isCurrentProjectLead(project(), 'usr-2'), true);
  assert.deepEqual(projectCardActions('Team_Lead', 'usr-2', project()), ['edit', 'archive']);
  assert.deepEqual(projectCardActions('Team_Member', 'usr-2', project()), ['edit', 'archive']);
});

test('non-lead members and HR receive no project actions', () => {
  assert.deepEqual(projectCardActions('Team_Member', 'usr-3', project()), []);
  assert.deepEqual(projectCardActions('Team_Lead', 'usr-3', project()), []);
  assert.deepEqual(projectCardActions('HR', 'usr-2', project()), []);
});

// ProjectDetailsDrawer.tsx's Admin-only move-member / replace-Team-Lead controls both gate on
// this single helper.
test('only Admin can manage project teams (move member / replace Team Lead)', () => {
  assert.equal(canManageProjectTeams('Admin'), true);
  assert.equal(canManageProjectTeams('Team_Lead'), false);
  assert.equal(canManageProjectTeams('Team_Member'), false);
  assert.equal(canManageProjectTeams('HR'), false);
});

// ProjectsView.tsx's multi-team builder (create mode) is gated on this same helper, so a
// Team_Lead/Team_Member -- not just Admin -- can propose a complete multi-team project.
test('every project-creating role (not just Admin) can access the multi-team builder', () => {
  assert.equal(canCreateProject('Admin'), true);
  assert.equal(canCreateProject('Team_Lead'), true);
  assert.equal(canCreateProject('Team_Member'), true);
  assert.equal(canCreateProject('HR'), false);
});
