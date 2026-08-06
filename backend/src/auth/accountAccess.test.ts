import assert from 'node:assert/strict';
import test from 'node:test';
import { canAuthenticateAccount } from './accountAccess.js';
import { calculateAttendanceOutcome } from '../attendance/attendancePolicy.js';
import {
  canAccessAttendanceReports,
  canUsePersonalAttendance,
  type EffectiveRoles
} from './effectiveRoles.js';

const activeAccount = {
  accountStatus: 'Active' as const,
  // Presence may be projected as away while the user is on approved leave.
  status: 'away' as const
};

const memberRoles: EffectiveRoles = {
  permanentRole: 'Team_Member',
  activeTemporaryRoles: [],
  isAdmin: false,
  isActiveTeamLead: false,
  isActiveHR: false,
  isHRandTeamLead: false,
  leadProjectPks: [],
  hrDepartmentIds: []
};

test('active user on approved Full Day Leave can authenticate and remains On Leave', () => {
  assert.equal(canAuthenticateAccount(activeAccount), true);
  assert.equal(calculateAttendanceOutcome({
    checkInUtc: null,
    checkOutUtc: null,
    scheduledStartUtc: null,
    scheduledMinutes: 480,
    graceMinutes: 0,
    breakSeconds: 0,
    approvedLeave: { type: 'Full Day Leave' }
  }).status, 'On Leave');
});

test('active user on approved Half Day Leave can authenticate and remains Half Day', () => {
  assert.equal(canAuthenticateAccount(activeAccount), true);
  assert.equal(calculateAttendanceOutcome({
    checkInUtc: new Date('2026-08-06T08:00:00Z'),
    checkOutUtc: new Date('2026-08-06T12:00:00Z'),
    scheduledStartUtc: new Date('2026-08-06T08:00:00Z'),
    scheduledMinutes: 480,
    graceMinutes: 0,
    breakSeconds: 0,
    approvedLeave: {
      type: 'Half Day Leave',
      period: 'Second Half',
      halfDayBoundaryUtc: new Date('2026-08-06T12:00:00Z')
    }
  }).status, 'Half Day');
});

test('leave presence does not alter permissions granted by the user role', () => {
  assert.equal(canAuthenticateAccount(activeAccount), true);
  assert.equal(canUsePersonalAttendance(memberRoles), true);
  assert.equal(canAccessAttendanceReports(memberRoles), false);
});

test('inactive accounts remain blocked independently of attendance or leave', () => {
  assert.equal(canAuthenticateAccount({
    accountStatus: 'Deactivated',
    status: 'away'
  }), false);
});

test('RBAC continues to block unauthorized roles only', () => {
  assert.equal(canAccessAttendanceReports(memberRoles), false);
  assert.equal(canAccessAttendanceReports({
    ...memberRoles,
    permanentRole: 'HR',
    isActiveHR: true
  }), true);
});
