import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServiceClient } from '../db/supabase.js';
import { query, withTransaction } from '../db/pool.js';
import { sendCredentialEmail, sendPasswordSetupEmail } from '../services/emailService.js';
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
  sendPasswordSetup: typeof sendPasswordSetupEmail;
}

const defaultDependencies: AccountServiceDependencies = {
  query,
  withTransaction,
  supabase: getSupabaseServiceClient,
  sendCredentials: sendCredentialEmail,
  sendPasswordSetup: sendPasswordSetupEmail
};

const baseRoleCode: Record<AccountBaseRole, string> = {
  Admin: 'Administrator',
  HR: 'HRRepresentative',
  Team_Member: 'TeamMember'
};

const publicRole = (roleCode: string | null): AccountBaseRole =>
  roleCode === 'Administrator' ? 'Admin' : roleCode === 'HRRepresentative' ? 'HR' : 'Team_Member';

const authCreateError = (message?: string): Error => {
  const normalized = (message || '').toLowerCase();
  if (normalized.includes('already') || normalized.includes('exists') || normalized.includes('registered')) {
    return new AccountConflictError('An account already exists for this email.');
  }
  return new AccountProvisioningUnavailableError('Supabase could not create the account identity.');
};

const authLinkError = (message?: string): Error => {
  const normalized = (message || '').toLowerCase();
  if (normalized.includes('rate limit')) {
    return new AccountProvisioningUnavailableError('Password setup email rate limit reached. Please try again later.');
  }
  return new AccountProvisioningUnavailableError('Supabase could not create a password setup link.');
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
        displayname, designation, accountstatus, createdbyuserid, invitationsentatutc)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,'Pending',$9,NULL)
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
    accountStatus: 'Pending',
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
    app_metadata: { must_change_password: true },
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
      temporaryPassword: input.password,
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

interface ResendTarget {
  userid: number;
  authuserid: string | null;
  email: string;
  displayname: string;
  departmentid: number | null;
  accountstatus: string;
  rolecode: string | null;
}

export const resendInvitation = async (
  actor: ProvisioningActor,
  targetUserId: string,
  dependencies: AccountServiceDependencies = defaultDependencies
): Promise<void> => {
  if (actor.role !== 'Admin' && actor.role !== 'HR') {
    throw new AccountAuthorizationError('Only Admin and HR users can resend account invitations.');
  }
  const targetResult = await dependencies.query<ResendTarget>(
    `SELECT u.userid, u.authuserid, u.email, u.displayname, u.departmentid, u.accountstatus,
       COALESCE(
         MAX(r.rolecode) FILTER (WHERE r.rolecode = 'Administrator'),
         MAX(r.rolecode) FILTER (WHERE r.rolecode = 'HRRepresentative'),
         MAX(r.rolecode) FILTER (WHERE r.rolecode = 'TeamMember')
       ) AS rolecode
     FROM iam.users u
     LEFT JOIN iam.userroles ur ON ur.userid = u.userid AND ur.revokedatutc IS NULL
       AND ur.startsatutc <= now() AND (ur.endsatutc IS NULL OR ur.endsatutc > now())
     LEFT JOIN iam.roles r ON r.roleid = ur.roleid
     WHERE u.userid = $1
     GROUP BY u.userid`,
    [toUserPk(targetUserId)]
  );
  const target = targetResult.rows[0];
  if (!target) throw new AccountValidationError('Account not found.');
  if (target.accountstatus !== 'Pending' || !target.authuserid) {
    throw new AccountValidationError('Only pending provisioned accounts are eligible for invitation resend.');
  }
  if (actor.role === 'HR') {
    if (publicRole(target.rolecode) !== 'Team_Member') {
      throw new AccountAuthorizationError('HR users may only resend invitations for Member accounts.');
    }
    if (!target.departmentid) throw new AccountAuthorizationError('The Member is outside your department hierarchy.');
    await assertDepartmentPermitted(actor, target.departmentid, dependencies);
  }

  const generated = await dependencies.supabase().auth.admin.generateLink({
    type: 'recovery',
    email: target.email,
    options: { redirectTo: process.env.SUPABASE_PASSWORD_RESET_REDIRECT_URL || process.env.APP_LOGIN_URL || undefined }
  });
  const actionLink = generated.data?.properties?.action_link;
  if (generated.error || !actionLink) throw authLinkError(generated.error?.message);

  try {
    await dependencies.sendPasswordSetup({
      toEmail: target.email,
      recipientName: target.displayname,
      actionLink
    });
  } catch {
    throw new AccountProvisioningUnavailableError('The password setup email could not be sent.');
  }

  await dependencies.query(
    `UPDATE iam.users SET invitationsentatutc = CURRENT_TIMESTAMP, updatedatutc = CURRENT_TIMESTAMP
      WHERE userid = $1`,
    [target.userid]
  );
};

export const completeFirstLogin = async (
  authUserId: string,
  password: string,
  currentAppMetadata: Record<string, unknown>,
  dependencies: AccountServiceDependencies = defaultDependencies
): Promise<void> => {
  const supabase = dependencies.supabase();
  const passwordUpdate = await supabase.auth.admin.updateUserById(authUserId, { password });
  if (passwordUpdate.error) {
    throw new AccountProvisioningUnavailableError('Supabase could not update the password.');
  }

  const activated = await dependencies.query(
    `UPDATE iam.users
        SET accountstatus = 'Active',
            activatedatutc = COALESCE(activatedatutc, CURRENT_TIMESTAMP),
            updatedatutc = CURRENT_TIMESTAMP
      WHERE authuserid = $1 AND accountstatus IN ('Pending', 'Active')`,
    [authUserId]
  );
  if (!activated.rowCount) throw new AccountValidationError('This account is not awaiting first-login activation.');

  const metadataUpdate = await supabase.auth.admin.updateUserById(authUserId, {
    app_metadata: { ...currentAppMetadata, must_change_password: false }
  });
  if (metadataUpdate.error) {
    throw new AccountProvisioningUnavailableError('Password changed, but account activation could not be finalized. Please retry.');
  }
};
