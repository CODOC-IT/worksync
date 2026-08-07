import { Response } from 'express';
import { recordActivitySafe } from '../activity/activity.service.js';
import { AuthenticatedRequest } from '../middleware/authMiddleware.js';
import { accountErrorStatus, AccountAuthorizationError } from './accounts.errors.js';
import { createAccount, createDepartment, deleteDepartment, listPermittedDepartments } from './accounts.service.js';
import { ProvisioningActor } from './accounts.types.js';
import { parseCreateAccount, parseCreateDepartment } from './accounts.validation.js';

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

export const postDepartment = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  let actor: ProvisioningActor | undefined;
  try {
    actor = actorFromRequest(req);
    const input = parseCreateDepartment(req.body);
    const department = await createDepartment(actor, input);
    recordActivitySafe({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'Created',
      module: 'Organization',
      entityType: 'Department',
      entityId: String(department.id),
      entityName: department.name,
      description: `${actor.email} created department ${department.name}.`,
      result: 'Successful',
      source: 'API',
      important: true
    });
    res.status(201).json({ success: true, message: 'Department created.', data: { department } });
  } catch (error) {
    sendError(res, error, 'Could not create department.');
  }
};

export const deleteDepartmentController = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  let actor: ProvisioningActor | undefined;
  try {
    actor = actorFromRequest(req);
    const departmentId = Number(req.params.id);
    if (!Number.isInteger(departmentId) || departmentId <= 0) {
      res.status(400).json({ success: false, message: 'Invalid department id.' });
      return;
    }
    const department = await deleteDepartment(actor, departmentId);
    recordActivitySafe({
      actorId: actor.id,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: 'Deleted',
      module: 'Organization',
      entityType: 'Department',
      entityId: String(department.id),
      entityName: department.name,
      description: `${actor.email} deleted department ${department.name}.`,
      result: 'Successful',
      source: 'API',
      important: true
    });
    res.status(200).json({ success: true, message: 'Department deleted.', data: { department } });
  } catch (error) {
    if (actor) {
      recordActivitySafe({
        actorId: actor.id,
        actorEmail: actor.email,
        actorRole: actor.role,
        action: 'Deleted',
        module: 'Organization',
        entityType: 'Department',
        entityId: String(req.params.id ?? ''),
        entityName: 'Department',
        description: 'Department deletion failed.',
        result: 'Failed',
        source: 'API',
        important: true
      });
    }
    sendError(res, error, 'Could not delete department.');
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
