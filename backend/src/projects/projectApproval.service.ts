import * as repo from './projectApproval.repository.js';
import * as projectRepo from './project.repository.js';
import * as projectService from './project.service.js';
import { resolveTeamLeadUserId } from './project.mapper.js';
import { fromProjectPk, fromUserPk, toProjectPk, toUserPk } from '../utils/idMapping.js';
import { userStore } from '../store/userStore.js';
import * as notificationService from '../notifications/notification.service.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import { ProjectApprovalRequestDTO, ProjectApprovalRequestRow, ProjectApprovalRequestType } from './projectApproval.types.js';
import { actorDisplayName } from '../utils/actorDisplay.js';

// Service Layer for the Project Management Approval Workflow -- business logic + authorization +
// notification publishing, matching project.service.ts's own layering. No SQL here (that's
// projectApproval.repository.ts); no Express req/res here (that's projectApproval.controller.ts).
//
// The core idea: a Team Lead's attempt to edit/archive/delete/restore/permanently-delete a
// project never reaches project.service.ts's own functions directly (see project.controller.ts's
// branch on req.user.role) -- it lands here instead, as a persisted request. Only once an Admin
// approves does this module call the *existing*, unmodified project.service.ts function --
// using the Admin's own identity -- so every validation rule already enforced there (start-date
// immutability, milestone-range checks, audit-immutability-respecting permanent delete, ...)
// still applies at execution time, exactly as before.

export { ProjectAuthorizationError, ProjectNotFoundError, ProjectValidationError } from './project.service.js';
import { ProjectAuthorizationError, ProjectNotFoundError, ProjectValidationError } from './project.service.js';

const actorName = (userId: string): string => actorDisplayName(userId);

const toDTO = async (row: ProjectApprovalRequestRow): Promise<ProjectApprovalRequestDTO> => {
  const project = await projectRepo.findProjectById(row.projectid);
  const requestedByFrontendId = fromUserPk(row.requestedbyuserid);
  return {
    id: row.approvalrequestid,
    projectId: fromProjectPk(row.projectid),
    projectTitle: project?.projectname || fromProjectPk(row.projectid),
    requestType: row.requesttype,
    requestedByUserId: requestedByFrontendId,
    requestedByName: actorName(requestedByFrontendId),
    requestedChanges: row.requestedchangesjson ? JSON.parse(row.requestedchangesjson) : null,
    reason: row.reason,
    status: row.requeststatus,
    reviewedByUserId: row.reviewedbyuserid != null ? fromUserPk(row.reviewedbyuserid) : undefined,
    reviewedByName: row.reviewedbyuserid != null ? actorName(fromUserPk(row.reviewedbyuserid)) : undefined,
    decisionReason: row.decisionreason || undefined,
    createdAt: row.createdatutc.toISOString(),
    decidedAt: row.decidedatutc ? row.decidedatutc.toISOString() : undefined
  };
};

const notifyAdmins = (event: Omit<Parameters<typeof notificationService.publishEvent>[0], 'recipientIds'>) => {
  (async () => {
    const admins = (await userStore.getAllUsers()).filter((user) => user.role === 'Admin');
    if (admins.length === 0) return;
    await notificationService.publishEvent({ ...event, recipientIds: admins.map((user) => user.id) });
  })().catch((error) => console.error('[projectApproval.service] Failed to notify Admins.', error));
};

const notifyRequester = (
  requesterId: string,
  event: Omit<Parameters<typeof notificationService.publishEvent>[0], 'recipientIds'>
) => {
  notificationService
    .publishEvent({ ...event, recipientIds: [requesterId] })
    .catch((error) => console.error('[projectApproval.service] Failed to notify requester.', error));
};

const REQUEST_TYPE_LABEL: Record<ProjectApprovalRequestType, string> = {
  PROJECT_EDIT: 'edit',
  PROJECT_ARCHIVE: 'archive',
  PROJECT_DELETE: 'delete',
  PROJECT_RESTORE: 'restore',
  PROJECT_PERMANENT_DELETE: 'permanently delete'
};

// Called from project.controller.ts when the acting user is a Team Lead attempting one of the
// five gated actions. Only ever creates a Pending request -- the underlying project row is
// never touched here.
export const createApprovalRequest = async (
  projectIdStr: string,
  requestType: ProjectApprovalRequestType,
  requestedChanges: Record<string, unknown> | null,
  reason: string,
  requesterId: string,
  requesterRole: string
): Promise<ProjectApprovalRequestDTO> => {
  if (requesterRole !== 'Team_Lead') {
    throw new ProjectAuthorizationError('Only Team Leads submit project approval requests.');
  }
  if (!reason?.trim()) {
    throw new ProjectValidationError('A reason is required to submit this request for Admin approval.');
  }

  const projectPk = toProjectPk(projectIdStr);
  const row = await projectRepo.findProjectById(projectPk);
  if (!row) throw new ProjectNotFoundError('Project not found.');

  const members = await projectRepo.findMembersForProject(projectPk);
  if (resolveTeamLeadUserId(row, members) !== requesterId) {
    throw new ProjectAuthorizationError('You can only request changes for projects you lead.');
  }

  const approvalRequestId = await repo.insertApprovalRequest({
    projectId: projectPk,
    requestType,
    requestedByUserId: toUserPk(requesterId),
    requestedChangesJson: requestedChanges ? JSON.stringify(requestedChanges) : null,
    reason: reason.trim()
  });

  const requesterDisplayName = actorName(requesterId);
  notifyAdmins({
    type: 'approval',
    title: 'Project Approval Requested',
    message: `${requesterDisplayName} requested to ${REQUEST_TYPE_LABEL[requestType]} "${row.projectname}".`,
    actorId: requesterId,
    projectId: projectIdStr
  });
  recordActivitySafe({
    actorId: requesterId, actorName: requesterDisplayName, actorEmail: userStore.findById(requesterId)?.email,
    actorRole: requesterRole, action: 'Requested', module: 'Projects', entityType: 'Project',
    entityId: projectIdStr, entityName: row.projectname, projectId: projectIdStr, projectName: row.projectname,
    description: `${requesterDisplayName} requested to ${REQUEST_TYPE_LABEL[requestType]} "${row.projectname}".`,
    reason: reason.trim(), linkRoute: 'approvals', important: true
  });

  const created = await repo.findApprovalRequestById(approvalRequestId);
  return toDTO(created!);
};

// Admin's Approval Inbox -- every Pending request, regardless of project. HR is deliberately
// never checked for here or anywhere else in this module: HR has no role in this workflow beyond
// the read-only Activity Log visibility it already has (backend/src/activity), which this module
// doesn't touch.
export const listPendingApprovalsForAdmin = async (actorRole: string): Promise<ProjectApprovalRequestDTO[]> => {
  if (actorRole !== 'Admin') throw new ProjectAuthorizationError('Only Admins can view the project approval inbox.');
  const rows = await repo.findPendingApprovalRequests();
  return Promise.all(rows.map(toDTO));
};

// A Team Lead checking the status of their own submitted requests -- any authenticated user may
// call this, scoped to their own userId only, so no extra role gate is needed.
export const listMyApprovalRequests = async (userId: string): Promise<ProjectApprovalRequestDTO[]> => {
  const rows = await repo.findApprovalRequestsForUser(toUserPk(userId));
  return Promise.all(rows.map(toDTO));
};

// Approves or rejects a request. Rejecting just marks it decided -- the project is never
// touched. Approving executes the *existing* project.service.ts function, using the Admin's own
// identity, before marking the request decided -- if that execution throws (e.g. a validation
// rule that became true between request and decision), the request stays Pending and the error
// surfaces to the Admin, rather than being silently marked Approved with nothing having happened.
export const decideApprovalRequest = async (
  approvalRequestId: string,
  decision: 'Approved' | 'Rejected',
  actorId: string,
  actorRole: string,
  decisionReason: string | null
): Promise<ProjectApprovalRequestDTO> => {
  if (actorRole !== 'Admin') {
    throw new ProjectAuthorizationError('Only Admins can approve or reject project requests.');
  }

  const row = await repo.findApprovalRequestById(approvalRequestId);
  if (!row) throw new ProjectNotFoundError('Approval request not found.');
  if (row.requeststatus !== 'Pending') {
    throw new ProjectValidationError('This request has already been decided.');
  }

  const projectIdStr = fromProjectPk(row.projectid);
  const requesterId = fromUserPk(row.requestedbyuserid);
  // Captured before execution -- a PROJECT_PERMANENT_DELETE removes the project row entirely,
  // so this is the only point at which its name is still readable.
  const projectRowBeforeExecution = await projectRepo.findProjectById(row.projectid);
  const projectName = projectRowBeforeExecution?.projectname || projectIdStr;

  if (decision === 'Approved') {
    switch (row.requesttype) {
      case 'PROJECT_EDIT':
        await projectService.updateProject(
          projectIdStr,
          row.requestedchangesjson ? JSON.parse(row.requestedchangesjson) : {},
          actorId,
          'Admin'
        );
        break;
      case 'PROJECT_ARCHIVE':
      case 'PROJECT_DELETE':
        await projectService.archiveProject(projectIdStr, row.reason, actorId, 'Admin');
        break;
      case 'PROJECT_RESTORE':
        await projectService.restoreProject(projectIdStr, actorId, 'Admin');
        break;
      case 'PROJECT_PERMANENT_DELETE':
        await projectService.permanentlyDeleteProject(projectIdStr, actorId, 'Admin');
        break;
    }
  }

  const decided = await repo.decideApprovalRequest(approvalRequestId, decision, toUserPk(actorId), decisionReason?.trim() || null);

  const requesterDisplayName = actorName(requesterId);
  const reviewerDisplayName = actorName(actorId);
  const outcomeVerb = decision === 'Approved' ? 'approved' : 'rejected';
  notifyRequester(requesterId, {
    type: 'approval',
    title: `Project Request ${decision}`,
    message: `${reviewerDisplayName} ${outcomeVerb} your request to ${REQUEST_TYPE_LABEL[row.requesttype]} "${projectName}".`,
    actorId,
    projectId: row.requesttype === 'PROJECT_PERMANENT_DELETE' ? undefined : projectIdStr
  });
  recordActivitySafe({
    actorId, actorName: reviewerDisplayName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: decision, module: 'Projects', entityType: 'Project', entityId: projectIdStr,
    entityName: projectName, projectName,
    description: `${reviewerDisplayName} ${outcomeVerb} ${requesterDisplayName}'s request to ${REQUEST_TYPE_LABEL[row.requesttype]} "${projectName}".`,
    reason: decisionReason?.trim() || undefined, linkRoute: 'approvals', important: true
  });

  // A PROJECT_PERMANENT_DELETE that was just approved cascade-deletes this very request row
  // (FK_ProjectApprovalRequests_Project ON DELETE CASCADE, database/25_project_approvals.sql) --
  // there's nothing left to re-fetch or mark Approved. Report the outcome from the in-memory row
  // instead of erroring on "row not found."
  if (!decided) {
    if (decision === 'Approved' && row.requesttype === 'PROJECT_PERMANENT_DELETE') {
      return {
        id: row.approvalrequestid,
        projectId: projectIdStr,
        projectTitle: projectName,
        requestType: row.requesttype,
        requestedByUserId: requesterId,
        requestedByName: requesterDisplayName,
        requestedChanges: null,
        reason: row.reason,
        status: 'Approved',
        reviewedByUserId: actorId,
        reviewedByName: reviewerDisplayName,
        decisionReason: decisionReason?.trim() || undefined,
        createdAt: row.createdatutc.toISOString(),
        decidedAt: new Date().toISOString()
      };
    }
    throw new ProjectValidationError('This request has already been decided.');
  }

  return toDTO(decided);
};
