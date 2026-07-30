import { Response } from 'express';
import { recordActivitySafe } from '../activity/activity.service.js';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { accountErrorStatus, AccountAuthorizationError, AccountValidationError } from './accounts.errors.js';
import { completeFirstLogin, createAccount, listPermittedDepartments, resendInvitation } from './accounts.service.js';
import { ProvisioningActor } from './accounts.types.js';
import { parseChangePassword, parseCreateAccount } from './accounts.validation.js';

const actorFromRequest = (req: AuthenticatedRequest): ProvisioningActor => {
  if (!req.user) throw new AccountAuthorizationError('Authentication required.');
  return {
    id: req.user.id,
    email: req.user.email,
    role: req.user.role === 'Admin' ? 'Admin' : req.user.role === 'HR' ? 'HR' : 'Team_Member',
    departmentId: req.user.departmentId ?? null
  };
};

const sendError = (res: Response, error: unknown, fallback: string): void => {
  const status = accountErrorStatus(error);
  if (status >= 500) console.error('[accounts]', fallback, error instanceof Error ? error.message : 'Unknown error');
  res.status(status).json({ success: false, message: error instanceof Error ? error.message : fallback });
};

export const getDepartments = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const departments = await listPermittedDepartments(actorFromRequest(req));
    res.status(200).json({ success: true, data: { departments } });
  } catch (error) {
    sendError(res, error, 'Could not load departments.');
  }
};

export const postAccount = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  let actor: ProvisioningActor | undefined;
  try {
    actor = actorFromRequest(req);
    const input = parseCreateAccount(req.body);
    const data = await createAccount(actor, input);
    recordActivitySafe({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      affectedUserId: data.account.id,
      affectedUserName: data.account.fullName,
      action: 'Created',
      module: 'Authentication',
      entityType: 'User',
      entityId: data.account.id,
      entityName: data.account.fullName,
      description: `${actor.email} created account ${data.account.email}.`,
      result: 'Successful',
      source: 'API',
      important: true
    });
    res.status(201).json({
      success: true,
      message: data.invitationStatus === 'sent'
        ? 'Account created and credential email sent.'
        : 'Account created, but the credential email could not be sent.',
      data
    });
  } catch (error) {
    if (actor) {
      recordActivitySafe({
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'Created',
        module: 'Authentication',
        entityType: 'User',
        entityId: 'provisioning',
        entityName: 'Account provisioning',
        description: 'Account creation failed.',
        result: 'Failed',
        source: 'API',
        important: true
      });
    }
    sendError(res, error, 'Account creation failed.');
  }
};

export const postInvitationResend = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const actor = actorFromRequest(req);
    await resendInvitation(actor, req.params.userId);
    recordActivitySafe({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      affectedUserId: req.params.userId,
      action: 'Updated',
      module: 'Authentication',
      entityType: 'User',
      entityId: req.params.userId,
      entityName: 'Pending account',
      description: `${actor.email} resent a password setup invitation.`,
      result: 'Successful',
      source: 'API',
      important: true
    });
    res.status(200).json({ success: true, message: 'Password setup email sent.' });
  } catch (error) {
    sendError(res, error, 'Could not resend the invitation.');
  }
};

export const postFirstLoginPassword = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.user) throw new AccountAuthorizationError('Authentication required.');
    if (!req.user.mustChangePassword && req.user.accountStatus !== 'Pending') {
      throw new AccountValidationError('This account does not require a first-login password change.');
    }
    const { password } = parseChangePassword(req.body);
    await completeFirstLogin(req.user.authUserId, password, req.user.appMetadata);
    res.status(200).json({ success: true, message: 'Password changed. Your account is now active.' });
  } catch (error) {
    sendError(res, error, 'Could not complete first-login password change.');
  }
};
