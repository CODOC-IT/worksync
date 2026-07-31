import { isDatabaseConfigured, query } from '../db/pool.js';
import { toUserPk } from '../utils/idMapping.js';
import { userStore } from '../store/userStore.js';

export interface ActiveTemporaryRole {
  userRoleId: number;
  roleCode: string;
  startsAtUtc: Date;
  endsAtUtc: Date | null;
  leadProjectPks: number[];
  hrDepartmentIds: number[];
}

export interface EffectiveRoles {
  permanentRole: string;
  activeTemporaryRoles: ActiveTemporaryRole[];
  isAdmin: boolean;
  isActiveTeamLead: boolean;
  isActiveHR: boolean;
  isHRandTeamLead: boolean;
  leadProjectPks: number[];
  hrDepartmentIds: number[];
}

interface RoleRow {
  userroleid: number;
  rolecode: string;
  istemporary: boolean;
  startsatutc: string | Date;
  endsatutc: string | Date | null;
  projectid: number | null;
  departmentid: number | null;
}

const ROLE_CODE_MAP: Record<string, string> = {
  Administrator: 'Admin',
  TeamMember: 'Team_Member',
  TeamLead: 'Team_Lead',
  HRRepresentative: 'HR',
};

const fallback = (role: string): EffectiveRoles => ({
  permanentRole: role,
  activeTemporaryRoles: [],
  isAdmin: role === 'Admin',
  isActiveTeamLead: role === 'Team_Lead',
  isActiveHR: role === 'HR',
  isHRandTeamLead: false,
  leadProjectPks: [],
  hrDepartmentIds: [],
});

export const getEffectiveRoles = async (userId: string): Promise<EffectiveRoles> => {
  const storedRole = userStore.findById(userId)?.role || 'Team_Member';
  if (!isDatabaseConfigured()) return fallback(storedRole);

  try {
    const result = await query<RoleRow>(
      `SELECT ur.userroleid, r.rolecode, r.istemporary, ur.startsatutc, ur.endsatutc,
              tlps.projectid, hds.departmentid
         FROM iam.userroles ur
         JOIN iam.roles r ON r.roleid = ur.roleid
         LEFT JOIN iam.teamleadprojectscopes tlps ON tlps.userroleid = ur.userroleid
         LEFT JOIN iam.hrdepartmentscopes hds ON hds.userroleid = ur.userroleid
        WHERE ur.userid = $1
          AND ur.revokedatutc IS NULL
          AND ur.startsatutc <= now()
          AND (ur.endsatutc IS NULL OR ur.endsatutc > now())`,
      [toUserPk(userId)]
    );

    const permanent = result.rows
      .filter((row) => !row.istemporary)
      .map((row) => ROLE_CODE_MAP[row.rolecode] || row.rolecode);
    const permanentRole = permanent.includes('Admin') ? 'Admin' : permanent[0] || 'Team_Member';
    const temporaryMap = new Map<number, ActiveTemporaryRole>();
    for (const row of result.rows.filter((candidate) => candidate.istemporary)) {
      let role = temporaryMap.get(row.userroleid);
      if (!role) {
        role = {
          userRoleId: row.userroleid,
          roleCode: ROLE_CODE_MAP[row.rolecode] || row.rolecode,
          startsAtUtc: new Date(row.startsatutc),
          endsAtUtc: row.endsatutc ? new Date(row.endsatutc) : null,
          leadProjectPks: [],
          hrDepartmentIds: [],
        };
        temporaryMap.set(row.userroleid, role);
      }
      if (row.projectid !== null && !role.leadProjectPks.includes(row.projectid)) role.leadProjectPks.push(row.projectid);
      if (row.departmentid !== null && !role.hrDepartmentIds.includes(row.departmentid)) role.hrDepartmentIds.push(row.departmentid);
    }

    const activeTemporaryRoles = [...temporaryMap.values()];
    const isAdmin = permanentRole === 'Admin';
    // Permanent HR/Team Lead assignments are elevated roles too. They must use the
    // same visibility and capability paths as active temporary assignments.
    const isActiveHR = !isAdmin && (
      permanentRole === 'HR' || activeTemporaryRoles.some((role) => role.roleCode === 'HR')
    );
    const isActiveTeamLead = !isAdmin && (
      permanentRole === 'Team_Lead' || activeTemporaryRoles.some((role) => role.roleCode === 'Team_Lead')
    );
    return {
      permanentRole,
      activeTemporaryRoles,
      isAdmin,
      isActiveHR,
      isActiveTeamLead,
      isHRandTeamLead: isActiveHR && isActiveTeamLead,
      leadProjectPks: [...new Set(activeTemporaryRoles.flatMap((role) => role.leadProjectPks))],
      hrDepartmentIds: [...new Set(activeTemporaryRoles.flatMap((role) => role.hrDepartmentIds))],
    };
  } catch {
    // Authorization must fail closed when the configured role store is unavailable.
    return fallback('Team_Member');
  }
};

export const attendanceRole = (roles: EffectiveRoles): 'Admin' | 'HR' | 'Member' =>
  roles.isAdmin ? 'Admin' : roles.isActiveHR ? 'HR' : 'Member';

export const canUsePersonalAttendance = (roles: EffectiveRoles): boolean => !roles.isAdmin;
export const canAccessAttendanceReports = (roles: EffectiveRoles): boolean =>
  roles.isAdmin || roles.isActiveHR;
