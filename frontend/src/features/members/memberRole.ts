import { UserRole } from '../../types';

export const getMemberDirectoryRole = (
  baseRole: UserRole,
  memberId: string,
  activeProjectLeadIds: ReadonlySet<string>,
): UserRole => activeProjectLeadIds.has(memberId) && (baseRole === 'Team_Member' || baseRole === 'Team_Lead')
  ? 'Team_Lead'
  : baseRole;
