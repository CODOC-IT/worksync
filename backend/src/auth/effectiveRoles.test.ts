import test from 'node:test';
import assert from 'node:assert/strict';
import {
  attendanceRole,
  canAccessAttendanceReports,
  canUsePersonalAttendance,
  type EffectiveRoles,
} from './effectiveRoles.js';

const roles = (patch: Partial<EffectiveRoles>): EffectiveRoles => ({
  permanentRole: 'Team_Member',
  activeTemporaryRoles: [],
  isAdmin: false,
  isActiveTeamLead: false,
  isActiveHR: false,
  isHRandTeamLead: false,
  leadProjectPks: [],
  hrDepartmentIds: [],
  ...patch,
});

test('Admin cannot use personal attendance or receive personal attendance role', () => {
  const admin = roles({ permanentRole: 'Admin', isAdmin: true });
  assert.equal(canUsePersonalAttendance(admin), false);
  assert.equal(attendanceRole(admin), 'Admin');
});

test('HR has HR attendance access without inheriting it from Team Lead', () => {
  const hr = roles({ isActiveHR: true });
  const lead = roles({ isActiveTeamLead: true, leadProjectPks: [1] });
  assert.equal(attendanceRole(hr), 'HR');
  assert.equal(canAccessAttendanceReports(hr), true);
  assert.equal(attendanceRole(lead), 'Member');
  assert.equal(canAccessAttendanceReports(lead), false);
});

test('Team Member and Team Lead retain personal attendance only', () => {
  assert.equal(canUsePersonalAttendance(roles({})), true);
  assert.equal(canUsePersonalAttendance(roles({ isActiveTeamLead: true })), true);
  assert.equal(attendanceRole(roles({})), 'Member');
  assert.equal(attendanceRole(roles({ isActiveTeamLead: true })), 'Member');
});
