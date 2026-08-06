import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServiceClient } from '../db/supabase.js';
import { query, withTransaction } from '../db/pool.js';
import { sendCredentialEmail } from '../services/emailService.js';
import { fromUserPk, toProjectPk, toUserPk } from '../utils/idMapping.js';
import {
  AccountAuthorizationError,
  AccountConflictError,
  AccountProvisioningUnavailableError,
  AccountValidationError,
  conflictFromDatabaseError
} from './accounts.errors.js';
import {
  AccountBaseRole,
  CreateAccountInput,
  CreateDepartmentInput,
  DepartmentOption,
  InvitationStatus,
  ProvisionedAccount,
  ProvisioningActor
} from './accounts.types.js';

type RunQuery = typeof query;

export interface AccountServiceDependencies {
  query: RunQuery;
  withTransaction: typeof withTransaction;
  supabase: () => SupabaseClient;
  sendCredentials: typeof sendCredentialEmail;
}

const defaultDependencies: AccountServiceDependencies = {
  query,
  withTransaction,
  supabase: getSupabaseServiceClient,
  sendCredentials: sendCredentialEmail
};

const baseRoleCode: Record<AccountBaseRole, string> = {
  Admin: 'Administrator',
  HR: 'HRRepresentative',
  Team_Member: 'TeamMember'
};

const authCreateError = (message?: string): Error => {
  const normalized = (message || '').toLowerCase();
  if (normalized.includes('already') || normalized.includes('exists') || normalized.includes('registered')) {
    return new AccountConflictError('An account already exists for this email.');
  }
  return new AccountProvisioningUnavailableError('Supabase could not create the account identity.');
};

const assertActorCanCreate = (actor: ProvisioningActor, input: CreateAccountInput): void => {
  if (actor.role === 'Admin') return;
  if (actor.role === 'HR' && input.baseRole === 'Team_Member' && !input.teamLeadAssignment) return;
  throw new AccountAuthorizationError('You do not have permission to create this account.');
};

export const listPermittedDepartments = async (
  actor: ProvisioningActor,
  dependencies: AccountServiceDependencies = defaultDependencies
): Promise<DepartmentOption[]> => {
  if (actor.role === 'Admin') {
    const result = await dependencies.query<{ departmentid: number; departmentname: string }>(
      `SELECT departmentid, departmentname
         FROM org.departments
        WHERE organizationid = 1 AND isactive = TRUE
        ORDER BY departmentname`
    );
    return result.rows.map((row) => ({ id: row.departmentid, name: row.departmentname }));
  }
  if (actor.role !== 'HR') throw new AccountAuthorizationError('Only Admin and HR users can manage accounts.');

  const result = await dependencies.query<{ departmentid: number; departmentname: string }>(
    `WITH RECURSIVE roots AS (
       SELECT $1::int AS departmentid WHERE $1::int IS NOT NULL
       UNION
       SELECT hds.departmentid
         FROM iam.userroles ur
         JOIN iam.roles r ON r.roleid = ur.roleid AND r.rolecode = 'HRRepresentative'
         JOIN iam.hrdepartmentscopes hds ON hds.userroleid = ur.userroleid
        WHERE ur.userid = $2
          AND ur.revokedatutc IS NULL
          AND ur.startsatutc <= now()
          AND (ur.endsatutc IS NULL OR ur.endsatutc > now())
     ), permitted AS (
       SELECT departmentid FROM roots
       UNION
       SELECT child.departmentid
         FROM org.departments child
         JOIN permitted parent ON child.parentdepartmentid = parent.departmentid
        WHERE child.organizationid = 1
     )
     SELECT d.departmentid, d.departmentname
       FROM org.departments d
       JOIN permitted p ON p.departmentid = d.departmentid
      WHERE d.organizationid = 1 AND d.isactive = TRUE
      ORDER BY d.departmentname`,
    [actor.departmentId, toUserPk(actor.id)]
  );
  return result.rows.map((row) => ({ id: row.departmentid, name: row.departmentname }));
};

const assertDepartmentPermitted = async (
  actor: ProvisioningActor,
  departmentId: number,
  dependencies: AccountServiceDependencies
): Promise<void> => {
  const departments = await listPermittedDepartments(actor, dependencies);
  if (!departments.some((department) => department.id === departmentId)) {
    throw new AccountAuthorizationError(
      actor.role === 'HR'
        ? 'You can only manage Members within your department hierarchy.'
        : 'Select an active department.'
    );
  }
};

const toDepartmentCode = (name: string): string => {
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return (cleaned || 'DEPARTMENT').slice(0, 24);
};

const assertDepartmentNameUnique = async (
  name: string,
  dependencies: AccountServiceDependencies
): Promise<void> => {
  const existing = await dependencies.query<{ departmentid: number }>(
    `SELECT departmentid FROM org.departments
      WHERE organizationid = 1 AND lower(departmentname) = lower($1)
      LIMIT 1`,
    [name]
  );
  if (existing.rows[0]) throw new AccountConflictError('A department with this name already exists.');
};

export const createDepartment = async (
  actor: ProvisioningActor,
  input: CreateDepartmentInput,
  dependencies: AccountServiceDependencies = defaultDependencies
): Promise<DepartmentOption> => {
  if (actor.role !== 'Admin') {
    throw new AccountAuthorizationError('Only Administrators can create departments.');
  }

  const normalizedName = input.name.trim();
  await assertDepartmentNameUnique(normalizedName, dependencies);

  const baseCode = toDepartmentCode(normalizedName);
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const code = attempt === 0 ? baseCode : `${baseCode.slice(0, 20)}_${attempt}`;
    try {
      const inserted = await dependencies.query<{ departmentid: number }>(
        `INSERT INTO org.departments (organizationid, departmentcode, departmentname, isactive)
         VALUES (1, $1, $2, TRUE)
         RETURNING departmentid`,
        [code, normalizedName]
      );
      const departmentId = inserted.rows[0]?.departmentid;
      if (!departmentId) throw new Error('Department insert returned no id.');
      return { id: departmentId, name: normalizedName };
    } catch (error: any) {
      const message = String(error?.message || '').toLowerCase();
      if (message.includes('duplicate') || error?.code === '23505') continue;
      throw error;
    }
  }

  // All generated codes collided, but the name is still unique. Re-check the name and surface a
  // clear conflict instead of failing with an ambiguous DB error.
  await assertDepartmentNameUnique(normalizedName, dependencies);
  throw new AccountConflictError('Could not assign a unique department code. Try a different name.');
};

export const deleteDepartment = async (
  actor: ProvisioningActor,
  departmentId: number,
  dependencies: AccountServiceDependencies = defaultDependencies
): Promise<DepartmentOption> => {
  if (actor.role !== 'Admin') {
    throw new AccountAuthorizationError('Only Administrators can delete departments.');
  }

  const existing = await dependencies.query<{ departmentid: number; departmentname: string }>(
    `SELECT departmentid, departmentname
       FROM org.departments
      WHERE organizationid = 1 AND departmentid = $1
      LIMIT 1`,
    [departmentId]
  );
  const department = existing.rows[0];
  if (!department) throw new AccountConflictError('This department no longer exists.');

  const activeAssigned = await dependencies.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
       FROM iam.users
      WHERE organizationid = 1 AND departmentid = $1 AND accountstatus = 'Active'`,
    [departmentId]
  );
  if (Number(activeAssigned.rows[0]?.count || 0) > 0) {
    throw new AccountConflictError('This department still has active members assigned. Reassign them before deleting.');
  }

  try {
    await dependencies.withTransaction(async (runQuery) => {
      await runQuery(
        `UPDATE iam.users
            SET departmentid = NULL, updatedatutc = CURRENT_TIMESTAMP
          WHERE organizationid = 1 AND departmentid = $1`,
        [departmentId]
      );

      await runQuery(
        `DELETE FROM org.departments
          WHERE organizationid = 1 AND departmentid = $1`,
        [departmentId]
      );
    });
  } catch (error) {
    // hr.HolidayAudienceDepartments (database/28_holiday_audience.sql) FKs this department with
    // no ON DELETE clause (RESTRICT) -- deliberately, so a department still targeted by a
    // holiday's audience can't silently vanish from it. Surface that as the same clean
    // AccountConflictError shape as the active-members check above, instead of letting the raw
    // Postgres foreign-key-violation (23503) propagate as an unhandled 500.
    if ((error as { code?: string } | null)?.code === '23503') {
      throw new AccountConflictError(
        'This department is still referenced by one or more holidays. Remove it from their audience before deleting.'
      );
    }
    throw error;
  }

  return { id: department.departmentid, name: department.departmentname };
};

const assertUniqueAccount = async (
  input: Pick<CreateAccountInput, 'email' | 'username'>,
  dependencies: AccountServiceDependencies
): Promise<void> => {
  const duplicate = await dependencies.query<{ emailmatch: boolean; usernamematch: boolean }>(
    `SELECT
       EXISTS (SELECT 1 FROM iam.users WHERE organizationid = 1 AND lower(email) = $1) AS emailmatch,
       EXISTS (SELECT 1 FROM iam.users WHERE organizationid = 1 AND lower(username) = $2) AS usernamematch`,
    [input.email, input.username]
  );
  if (duplicate.rows[0]?.emailmatch) throw new AccountConflictError('An account already exists for this email.');
  if (duplicate.rows[0]?.usernamematch) throw new AccountConflictError('This username is already in use.');
};

const insertProfile = async (
  actor: ProvisioningActor,
  input: CreateAccountInput,
  authUserId: string,
  dependencies: AccountServiceDependencies
): Promise<ProvisionedAccount> => dependencies.withTransaction(async (run) => {
  const role = await run<{ roleid: number }>('SELECT roleid FROM iam.roles WHERE rolecode = $1', [baseRoleCode[input.baseRole]]);
  if (!role.rows[0]) throw new Error('Required base role is not configured.');

  let projectId: number | undefined;
  let teamLeadRoleId: number | undefined;
  if (input.teamLeadAssignment) {
    projectId = toProjectPk(input.teamLeadAssignment.projectId);
    const project = await run<{ projectid: number }>(
      `SELECT p.projectid
         FROM work.projects p
         JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
        WHERE p.projectid = $1 AND p.organizationid = 1
          AND p.archivedatutc IS NULL AND ps.statuscode = 'Active'`,
      [projectId]
    );
    if (!project.rows[0]) throw new AccountValidationError('Select an active project for the Team Lead assignment.');
    const existingLead = await run(
      `SELECT 1 FROM work.projectmembers
        WHERE projectid = $1 AND memberrolecode = 'TeamLead' AND leftatutc IS NULL`,
      [projectId]
    );
    if (existingLead.rowCount) throw new AccountConflictError('This project already has an active Team Lead.');
    const leadRole = await run<{ roleid: number }>("SELECT roleid FROM iam.roles WHERE rolecode = 'TeamLead'");
    if (!leadRole.rows[0]) throw new Error('Team Lead role is not configured.');
    teamLeadRoleId = leadRole.rows[0].roleid;
  }

  const [givenName, ...familyParts] = input.fullName.split(/\s+/);
  const familyName = familyParts.join(' ') || givenName;
  const inserted = await run<{ userid: number }>(
    `INSERT INTO iam.users
       (organizationid, departmentid, email, username, authuserid, givenname, familyname,
        displayname, designation, accountstatus, createdbyuserid, invitationsentatutc, activatedatutc)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,'Active',$9,NULL,CURRENT_TIMESTAMP)
     RETURNING userid`,
    [
      input.departmentId,
      input.email,
      input.username,
      authUserId,
      givenName,
      familyName,
      input.fullName,
      input.designation || null,
      toUserPk(actor.id)
    ]
  );
  const userId = inserted.rows[0].userid;
  await run(
    'INSERT INTO iam.userroles (userid, roleid, grantedbyuserid) VALUES ($1,$2,$3)',
    [userId, role.rows[0].roleid, toUserPk(actor.id)]
  );

  if (input.teamLeadAssignment && projectId && teamLeadRoleId) {
    const grant = await run<{ userroleid: number }>(
      `INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, endsatutc)
       VALUES ($1,$2,$3,$4) RETURNING userroleid`,
      [userId, teamLeadRoleId, toUserPk(actor.id), input.teamLeadAssignment.endsAtUtc]
    );
    await run(
      `INSERT INTO work.projectmembers (projectid, userid, memberrolecode, addedbyuserid)
       VALUES ($1,$2,'TeamLead',$3)`,
      [projectId, userId, toUserPk(actor.id)]
    );
    await run(
      'INSERT INTO iam.teamleadprojectscopes (userroleid, projectid) VALUES ($1,$2)',
      [grant.rows[0].userroleid, projectId]
    );
  }

  return {
    id: fromUserPk(userId),
    fullName: input.fullName,
    username: input.username,
    email: input.email,
    baseRole: input.baseRole,
    departmentId: input.departmentId,
    accountStatus: 'Active',
    invitationSentAtUtc: null
  };
});

export const createAccount = async (
  actor: ProvisioningActor,
  input: CreateAccountInput,
  dependencies: AccountServiceDependencies = defaultDependencies
): Promise<{ account: ProvisionedAccount; invitationStatus: InvitationStatus }> => {
  assertActorCanCreate(actor, input);
  await assertDepartmentPermitted(actor, input.departmentId, dependencies);
  await assertUniqueAccount(input, dependencies);

  const supabase = dependencies.supabase();
  const created = await supabase.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { username: input.username, full_name: input.fullName }
  });
  if (created.error || !created.data.user) throw authCreateError(created.error?.message);

  let account: ProvisionedAccount;
  try {
    account = await insertProfile(actor, input, created.data.user.id, dependencies);
  } catch (error) {
    try {
      const compensation = await supabase.auth.admin.deleteUser(created.data.user.id);
      if (compensation.error) console.error('[accounts] Auth identity compensation failed.');
    } catch {
      console.error('[accounts] Auth identity compensation failed.');
    }
    throw conflictFromDatabaseError(error) || error;
  }

  try {
    await dependencies.sendCredentials({
      toEmail: input.email,
      recipientName: input.fullName,
      password: input.password,
      role: input.baseRole === 'Team_Member' ? 'Member' : input.baseRole
    });
  } catch {
    return { account, invitationStatus: 'email_failed' };
  }

  try {
    const sentAt = await dependencies.query<{ invitationsentatutc: string }>(
      `UPDATE iam.users SET invitationsentatutc = CURRENT_TIMESTAMP, updatedatutc = CURRENT_TIMESTAMP
        WHERE userid = $1 RETURNING invitationsentatutc`,
      [toUserPk(account.id)]
    );
    account.invitationSentAtUtc = sentAt.rows[0]?.invitationsentatutc
      ? new Date(sentAt.rows[0].invitationsentatutc).toISOString()
      : new Date().toISOString();
  } catch {
    // Account creation and delivery both completed. Do not turn a post-delivery bookkeeping
    // failure into a false 500 response that could cause an operator to create a duplicate.
  }
  return { account, invitationStatus: 'sent' };
};
