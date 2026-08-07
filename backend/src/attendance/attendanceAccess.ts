import type { EffectiveRoles } from '../auth/effectiveRoles.js';

export type AttendanceViewerRole = 'Admin' | 'HR' | 'Member';

export const resolveAttendanceViewerRole = (
  authenticatedRole: string,
  effectiveRoles: EffectiveRoles
): AttendanceViewerRole => {
  if (authenticatedRole === 'Admin' || effectiveRoles.isAdmin) return 'Admin';
  if (authenticatedRole === 'HR' || effectiveRoles.isActiveHR) return 'HR';
  return 'Member';
};

export const visibleAttendanceUserIds = (
  viewerId: number,
  role: AttendanceViewerRole,
  activeNonAdminUserIds: number[]
): number[] => {
  if (role === 'Member') return [viewerId];
  const visible = activeNonAdminUserIds.filter((id) => id !== viewerId);
  return role === 'HR' ? [...visible, viewerId] : visible;
};

