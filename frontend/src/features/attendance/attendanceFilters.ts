import type { AttendanceRecord, User } from '../../types';

export type AttendanceRoleFilter = 'all' | 'HR' | 'Team_Member' | 'Team_Lead';

export const matchesAttendanceRoleFilter = (
  record: AttendanceRecord,
  users: User[],
  filter: AttendanceRoleFilter
): boolean => {
  if (filter === 'all') return true;
  const user = users.find((candidate) => candidate.id === record.userId);
  if (!user) return false;
  if (filter === 'Team_Lead') return user.activePermissions?.teamLead === true;
  if (filter === 'HR') return user.activePermissions?.hr === true || user.role === 'HR';
  return user.role === filter && user.activePermissions?.teamLead !== true;
};

