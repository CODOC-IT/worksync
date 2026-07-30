import { Router, Request, Response } from 'express';
import { getSupabaseServiceClient, isSupabaseServiceConfigured } from '../db/supabase.js';
import { query, withTransaction } from '../db/pool.js';
import { fromUserPk, toProjectPk, toUserPk } from '../utils/idMapping.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import { AccountValidationError, parseCreateAccount } from './accounts.validation.js';
import { CreateAccountInput, ProvisioningActor } from './accounts.types.js';

const router = Router();
class AccountAuthorizationError extends Error {}
class AccountConflictError extends Error {}
class AccountProvisioningUnavailableError extends Error {}

const invitationError = (message?: string): Error => {
  const normalized = (message || '').toLowerCase();
  if (normalized.includes('already') || normalized.includes('exists') || normalized.includes('registered')) {
    return new AccountConflictError('This email already exists in Supabase Auth. Link or reconcile that identity before inviting the member.');
  }
  if (normalized.includes('rate limit')) return new AccountProvisioningUnavailableError('Supabase email rate limit reached. Please wait before sending another invitation.');
  if (normalized.includes('redirect') || normalized.includes('url')) return new AccountProvisioningUnavailableError('Supabase invitation redirect URL is not configured for this deployment.');
  return new AccountProvisioningUnavailableError('Supabase could not deliver the invitation. Check the Auth email provider and server configuration.');
};

const accessToken = (req: Request): string => {
  const value = req.header('authorization');
  if (!value?.startsWith('Bearer ')) throw new AccountAuthorizationError('Authorization header with a Supabase Bearer token is required.');
  return value.slice(7);
};

const resolveActor = async (token: string): Promise<ProvisioningActor> => {
  const { data, error } = await getSupabaseServiceClient().auth.getUser(token);
  if (error || !data.user) throw new AccountAuthorizationError('Invalid or expired Supabase session.');
  const result = await query<{ userid: number; email: string; accountstatus: string; rolecode: string | null }>(`
    SELECT u.userid, u.email, u.accountstatus,
      COALESCE(MAX(r.rolecode) FILTER (WHERE r.rolecode = 'Administrator'), MAX(r.rolecode) FILTER (WHERE r.rolecode = 'HRRepresentative'), 'TeamMember') AS rolecode
    FROM iam.users u LEFT JOIN iam.userroles ur ON ur.userid = u.userid AND ur.revokedatutc IS NULL AND (ur.endsatutc IS NULL OR ur.endsatutc > now())
    LEFT JOIN iam.roles r ON r.roleid = ur.roleid WHERE u.authuserid = $1 GROUP BY u.userid`, [data.user.id]);
  const actor = result.rows[0];
  if (!actor || actor.accountstatus !== 'Active') throw new AccountAuthorizationError('Your WorkSync account is not active.');
  return { id: fromUserPk(actor.userid), email: actor.email, role: actor.rolecode === 'Administrator' ? 'Admin' : actor.rolecode === 'HRRepresentative' ? 'HR' : 'Team_Member' };
};

const assertCanCreate = (actor: ProvisioningActor, input: CreateAccountInput) => {
  if (actor.role === 'Admin') return;
  if (actor.role === 'HR' && input.baseRole === 'Team_Member' && !input.teamLeadAssignment) return;
  throw new AccountAuthorizationError('You do not have permission to create this account.');
};

router.post('/', async (req: Request, res: Response): Promise<void> => {
  let actor: ProvisioningActor | undefined;
  let invitedAuthUserId: string | undefined;
  try {
    if (!isSupabaseServiceConfigured()) throw new AccountProvisioningUnavailableError('Account invitations are unavailable because the Supabase server credentials are not configured.');
    actor = await resolveActor(accessToken(req));
    const input = parseCreateAccount(req.body);
    assertCanCreate(actor, input);
    if (input.teamLeadAssignment && actor.role !== 'Admin') throw new AccountAuthorizationError('Only an Admin can assign a Team Lead.');
    const duplicate = await query('SELECT 1 FROM iam.users WHERE organizationid = 1 AND (lower(email) = $1 OR lower(username) = $2)', [input.email, input.username]);
    if (duplicate.rowCount) throw new AccountConflictError('An account with this email or username already exists.');
    const redirectTo = process.env.SUPABASE_INVITE_REDIRECT_URL || process.env.SUPABASE_PASSWORD_RESET_REDIRECT_URL || undefined;
    const invite = await getSupabaseServiceClient().auth.admin.inviteUserByEmail(input.email, { data: { username: input.username }, redirectTo });
    if (invite.error || !invite.data.user) throw invitationError(invite.error?.message);
    invitedAuthUserId = invite.data.user.id;
    const [givenName, ...family] = input.fullName.split(/\s+/);
    const account = await withTransaction(async (run) => {
      const roleCode = input.baseRole === 'HR' ? 'HRRepresentative' : 'TeamMember';
      const role = await run<{ roleid: number }>('SELECT roleid FROM iam.roles WHERE rolecode = $1', [roleCode]);
      if (!role.rows[0]) throw new Error('Required base role is not configured.');
      const inserted = await run<{ userid: number }>(`INSERT INTO iam.users (organizationid, email, username, authuserid, givenname, familyname, displayname, designation, accountstatus, createdbyuserid, invitationsentatutc) VALUES (1,$1,$2,$3,$4,$5,$6,$7,'Pending',$8,CURRENT_TIMESTAMP) RETURNING userid`, [input.email, input.username, invitedAuthUserId, givenName, family.join(' ') || givenName, input.fullName, input.designation || null, toUserPk(actor!.id)]);
      const userId = inserted.rows[0].userid;
      await run('INSERT INTO iam.userroles (userid, roleid, grantedbyuserid) VALUES ($1,$2,$3)', [userId, role.rows[0].roleid, toUserPk(actor!.id)]);
      if (input.teamLeadAssignment) {
        const projectId = toProjectPk(input.teamLeadAssignment.projectId);
        const project = await run<{ projectid: number }>('SELECT projectid FROM work.projects WHERE projectid = $1 AND archivedatutc IS NULL', [projectId]);
        if (!project.rows[0]) throw new AccountValidationError('Select an eligible project for the Team Lead assignment.');
        const leadRole = await run<{ roleid: number }>("SELECT roleid FROM iam.roles WHERE rolecode = 'TeamLead'");
        const grant = await run<{ userroleid: number }>('INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, endsatutc) VALUES ($1,$2,$3,$4) RETURNING userroleid', [userId, leadRole.rows[0].roleid, toUserPk(actor!.id), input.teamLeadAssignment.endsAtUtc]);
        await run("INSERT INTO work.projectmembers (projectid, userid, memberrolecode, addedbyuserid) VALUES ($1,$2,'TeamLead',$3)", [projectId, userId, toUserPk(actor!.id)]);
        await run('INSERT INTO iam.teamleadprojectscopes (userroleid, projectid) VALUES ($1,$2)', [grant.rows[0].userroleid, projectId]);
      }
      return { id: fromUserPk(userId), fullName: input.fullName, username: input.username, email: input.email, baseRole: input.baseRole, accountStatus: 'pending' };
    });
    recordActivitySafe({ actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, affectedUserId: account.id, affectedUserName: account.fullName, action: 'Created', module: 'Authentication', entityType: 'User', entityId: account.id, entityName: account.fullName, description: `${actor.email} invited ${account.email}.`, result: 'Successful', source: 'API', important: true });
    res.status(201).json({ success: true, account, invitationStatus: 'sent' });
  } catch (error) {
    if (invitedAuthUserId) await getSupabaseServiceClient().auth.admin.deleteUser(invitedAuthUserId).catch(() => undefined);
    if (error instanceof Error) console.error('[accounts] Invitation provisioning failed:', error.message);
    if (actor) recordActivitySafe({ actorId: actor.id, actorEmail: actor.email, actorRole: actor.role, action: 'Created', module: 'Authentication', entityType: 'User', entityId: 'provisioning', entityName: 'Account provisioning', description: 'Account invitation failed.', result: 'Failed', source: 'API', important: true });
    const status = error instanceof AccountAuthorizationError ? 403 : error instanceof AccountConflictError ? 409 : error instanceof AccountValidationError ? 400 : error instanceof AccountProvisioningUnavailableError ? 503 : 500;
    res.status(status).json({ success: false, message: error instanceof Error ? error.message : 'Account provisioning failed.' });
  }
});

export default router;
