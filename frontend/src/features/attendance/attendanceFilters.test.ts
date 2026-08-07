import assert from 'node:assert/strict';
import test from 'node:test';
import type { AttendanceRecord, User } from '../../types';
import { matchesAttendanceRoleFilter } from './attendanceFilters.js';

const record = (userId: string): AttendanceRecord => ({
  id: userId,
  userId,
  date: '2026-08-07',
  checkIn: '09:00',
  checkOut: '17:00',
  totalHours: 8,
  status: 'Present',
  breaks: []
});
const users = [
  { id: 'hr', role: 'HR', activePermissions: { hr: true, teamLead: false } },
  { id: 'lead', role: 'Team_Member', activePermissions: { hr: false, teamLead: true } },
  { id: 'member', role: 'Team_Member', activePermissions: { hr: false, teamLead: false } }
] as User[];

test('attendance role filters distinguish HR, Team Lead, and Member records', () => {
  assert.equal(matchesAttendanceRoleFilter(record('hr'), users, 'HR'), true);
  assert.equal(matchesAttendanceRoleFilter(record('lead'), users, 'Team_Lead'), true);
  assert.equal(matchesAttendanceRoleFilter(record('member'), users, 'Team_Member'), true);
  assert.equal(matchesAttendanceRoleFilter(record('lead'), users, 'Team_Member'), false);
  assert.equal(matchesAttendanceRoleFilter(record('member'), users, 'all'), true);
});

