import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAttendanceViewerRole, visibleAttendanceUserIds } from './attendanceAccess.js';
import type { EffectiveRoles } from '../auth/effectiveRoles.js';

const roles = (overrides: Partial<EffectiveRoles> = {}): EffectiveRoles => ({
  permanentRole: 'Team_Member',
  activeTemporaryRoles: [],
  isAdmin: false,
  isActiveTeamLead: false,
  isActiveHR: false,
  isHRandTeamLead: false,
  leadProjectPks: [],
  hrDepartmentIds: [],
  ...overrides
});

test('HR attendance visibility includes personal and all non-Admin employees', () => {
  const role = resolveAttendanceViewerRole('HR', roles());
  assert.equal(role, 'HR');
  assert.deepEqual(visibleAttendanceUserIds(3, role, [2, 3, 4]), [2, 4, 3]);
});

test('Admin attendance visibility excludes personal attendance but includes employees', () => {
  const role = resolveAttendanceViewerRole('Admin', roles());
  assert.equal(role, 'Admin');
  assert.deepEqual(visibleAttendanceUserIds(1, role, [2, 3, 4]), [2, 3, 4]);
});

test('Member and Team Lead attendance visibility remains personal only', () => {
  assert.deepEqual(visibleAttendanceUserIds(7, resolveAttendanceViewerRole('Team_Member', roles()), [2, 7]), [7]);
  assert.deepEqual(visibleAttendanceUserIds(8, resolveAttendanceViewerRole('Team_Lead', roles({
    isActiveTeamLead: true
  })), [2, 8]), [8]);
});

