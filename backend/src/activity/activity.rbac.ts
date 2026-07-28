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
  isActiveTeamLead: boolean;
  isActiveHR: boolean;
  leadProjectPks: number[];
}

interface DbTemporaryRoleRow {
  userroleid: number;
  rolecode: string;
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

export const getEffectiveRoles = async (userId: string): Promise<EffectiveRoles> => {
  const user = userStore.findById(userId);
  let permanentRole: string = user?.role || 'Team_Member';

  if (!isDatabaseConfigured()) {
    return {
      permanentRole,
      activeTemporaryRoles: [],
      isActiveTeamLead: permanentRole === 'Team_Lead',
      isActiveHR: permanentRole === 'HR',
      leadProjectPks: [],
    };
  }

  try {
    const userPk = toUserPk(userId);
    const permanentRoleResult = await query<{ rolecode: string }>(
      `SELECT r.rolecode
       FROM iam.userroles ur
       JOIN iam.roles r ON r.roleid = ur.roleid
       WHERE ur.userid = $1
         AND ur.revokedatutc IS NULL
         AND ur.startsatutc <= now()
         AND (ur.endsatutc IS NULL OR ur.endsatutc > now())
         AND r.istemporary = FALSE
       ORDER BY ur.startsatutc DESC
       LIMIT 1`,
      [userPk]
    );
    if (permanentRoleResult.rows[0]) {
      permanentRole = ROLE_CODE_MAP[permanentRoleResult.rows[0].rolecode]
        || permanentRoleResult.rows[0].rolecode;
    }

    const result = await query<DbTemporaryRoleRow>(
      `SELECT ur.userroleid, r.rolecode,
               ur.startsatutc, ur.endsatutc,
               tlps.projectid, hds.departmentid
       FROM iam.userroles ur
       JOIN iam.roles r ON r.roleid = ur.roleid
       LEFT JOIN iam.teamleadprojectscopes tlps ON tlps.userroleid = ur.userroleid
       LEFT JOIN iam.hrdepartmentscopes hds ON hds.userroleid = ur.userroleid
       WHERE ur.userid = $1
         AND ur.revokedatutc IS NULL
         AND ur.startsatutc <= now()
         AND (ur.endsatutc IS NULL OR ur.endsatutc > now())
         AND r.istemporary = TRUE`,
      [userPk]
    );

    const roleMap = new Map<number, ActiveTemporaryRole>();
    for (const row of result.rows) {
      let role = roleMap.get(row.userroleid);
      if (!role) {
        role = {
          userRoleId: row.userroleid,
          roleCode: ROLE_CODE_MAP[row.rolecode] || row.rolecode,
          startsAtUtc: new Date(row.startsatutc),
          endsAtUtc: row.endsatutc ? new Date(row.endsatutc) : null,
          leadProjectPks: [],
          hrDepartmentIds: [],
        };
        roleMap.set(row.userroleid, role);
      }
      if (row.projectid !== null) role.leadProjectPks.push(row.projectid);
      if (row.departmentid !== null) role.hrDepartmentIds.push(row.departmentid);
    }

    const activeTemporaryRoles = Array.from(roleMap.values());
    const isActiveTeamLead = activeTemporaryRoles.some((r) => r.roleCode === 'Team_Lead');
    const isActiveHR = activeTemporaryRoles.some((r) => r.roleCode === 'HR');

    const leadProjectPks = Array.from(
      new Set(activeTemporaryRoles.flatMap((r) => r.leadProjectPks))
    );

    return { permanentRole, activeTemporaryRoles, isActiveTeamLead, isActiveHR, leadProjectPks };
  } catch (err) {
    return {
      permanentRole,
      activeTemporaryRoles: [],
      isActiveTeamLead: permanentRole === 'Team_Lead',
      isActiveHR: permanentRole === 'HR',
      leadProjectPks: [],
    };
  }
};

export const hasAccessToSensitivity = (
  viewerPermanentRole: string,
  _isActiveTeamLead: boolean,
  _isActiveHR: boolean,
  viewerId: string,
  sensitivity?: string
): boolean => {
  if (viewerPermanentRole === 'Admin') return true;
  if (!sensitivity || sensitivity === 'Normal') return true;
  if (sensitivity === 'Sensitive') {
    return viewerPermanentRole === 'Admin';
  }
  if (sensitivity === 'Restricted') {
    return false;
  }
  return true;
};
