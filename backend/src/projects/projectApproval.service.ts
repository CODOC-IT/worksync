import * as repo from './projectApproval.repository.js';
import * as projectRepo from './project.repository.js';
import * as projectService from './project.service.js';
import { isTeamLeadOfProject, rowToProjectDTO } from './project.mapper.js';
import { fromProjectPk, fromUserPk, toProjectPk, toUserPk } from '../utils/idMapping.js';
import { userStore } from '../store/userStore.js';
import * as notificationService from '../notifications/notification.service.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import { ProjectApprovalRequestDTO, ProjectApprovalRequestRow, ProjectApprovalRequestType } from './projectApproval.types.js';
import { actorDisplayName } from '../utils/actorDisplay.js';
import {
  buildProjectDecisionMessage,
  projectDecisionEffect,
  resolveUpdatedParticipants,
  validateProjectDecision
} from './projectWorkflow.rules.js';
import { buildProjectApprovalRejectionCopy } from './projectApprovalRejectionCopy.js';
import {
  ProposedTaskSummary,
  buildTaskAssigneeApprovedCopy,
  buildTaskCreateApprovedCopy,
  buildTaskCreateRejectedCopy,
  buildTaskCreateRequestCopy
} from './taskCreateApprovalCopy.js';
import { ProjectTeamRow, TeamMemberRow, UpdateProjectInput } from './project.types.js';
import * as taskService from '../tasks/task.service.js';
import { CreateTaskInput } from '../tasks/task.types.js';
import {
  buildProjectEditPayload,
  conflictingProjectFields,
  enrichProjectEditPayload,
  parseProjectEditPayload,
  resolveProjectUserIdentity,
} from './projectApprovalChanges.js';

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

const unknownUser = (id: string): string => `Unknown user (ID: ${id})`;

const toDTO = async (row: ProjectApprovalRequestRow): Promise<ProjectApprovalRequestDTO> => {
  const project = row.projectid != null ? await projectRepo.findProjectById(row.projectid) : null;
  const requestedByFrontendId = fromUserPk(row.requestedbyuserid);
  const users = await userStore.getAllUsers();
  const userNames = new Map(users.map((user) => [user.id, user.name]));
  const requester = resolveProjectUserIdentity(requestedByFrontendId, users);
  const parsedChanges = row.requestedchangesjson ? JSON.parse(row.requestedchangesjson) : null;
  const projectEditPayload = row.requesttype === 'PROJECT_EDIT'
    ? parseProjectEditPayload(row.requestedchangesjson)
    : null;
  return {
    id: row.approvalrequestid,
    projectId: row.projectid != null ? fromProjectPk(row.projectid) : '',
    projectTitle: project?.projectname || row.projecttitle,
    requestType: row.requesttype,
    requestedByUserId: requestedByFrontendId,
    requestedByName: requester.name,
    requestedByRole: requester.role,
    requestedByEmail: requester.email,
    requestedChanges: projectEditPayload
      ? enrichProjectEditPayload(projectEditPayload, (id) => userNames.get(id) || unknownUser(id))
      : parsedChanges,
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

// Turns a persisted TASK_CREATE proposal into the display-ready summary the copy module takes.
// Every user id becomes a real display name here — the copy templates never see an id, which is
// what keeps "usr-40" out of a notification body by construction rather than by review.
const summarizeProposedTask = async (
  proposed: CreateTaskInput,
  projectName: string,
  requesterId: string,
  teams: ProjectTeamRow[],
  teamMembers: TeamMemberRow[]
): Promise<ProposedTaskSummary> => {
  // The proposing lead's own team, resolved from work.TeamMembers.IsLead rather than from the
  // request payload, so a stale or absent teamId in an older persisted proposal still names the
  // right team.
  const leadMembership = teamMembers.find(
    (member) => member.userid === toUserPk(requesterId) && member.islead
  );
  const teamName = teams.find((team) => team.teamid === leadMembership?.teamid)?.teamname;
  return {
    title: proposed.title?.trim() || '',
    projectName,
    teamName,
    description: proposed.description?.trim() || undefined,
    priority: proposed.priority,
    dueDate: proposed.dueDate,
    assigneeNames: (proposed.assigneeIds || []).map((id) => actorName(id)),
    requesterName: actorName(requesterId)
  };
};

/**
 * §7's decision fan-out. The requesting Team Lead always hears the outcome, named by the task they
 * proposed; on approval its assignees additionally hear that the task is now live and theirs.
 *
 * On rejection nobody but the requester is written to: the task was never created, so a proposed
 * assignee has nothing to act on and no context for a decision they were not part of.
 */
const notifyTaskCreateDecision = async (
  row: ProjectApprovalRequestRow,
  decision: 'Approved' | 'Rejected',
  actorId: string,
  decisionReason: string | null,
  projectName: string,
  requesterId: string
): Promise<void> => {
  let proposed: CreateTaskInput | null = null;
  try {
    proposed = row.requestedchangesjson ? (JSON.parse(row.requestedchangesjson) as CreateTaskInput) : null;
  } catch {
    proposed = null; // A malformed payload must not cost the requester their decision notification.
  }
  const reviewerName = actorName(actorId);
  if (!proposed) {
    notifyRequester(requesterId, {
      type: 'approval',
      title: `Task ${decision}`,
      message: `${reviewerName} ${decision === 'Approved' ? 'approved' : 'rejected'} your task request for ` +
        `"${projectName}".`,
      detail: decision === 'Rejected'
        ? `Reason: ${decisionReason?.trim() || 'No reason was recorded.'}`
        : undefined,
      actorId,
      projectId: row.projectid != null ? fromProjectPk(row.projectid) : undefined
    });
    return;
  }

  const [teams, teamMembers] = row.projectid != null
    ? await Promise.all([
        projectRepo.findTeamsForProject(row.projectid),
        projectRepo.findTeamMembersForProject(row.projectid)
      ])
    : [[], []];
  const summary = await summarizeProposedTask(proposed, projectName, requesterId, teams, teamMembers);
  const projectIdStr = row.projectid != null ? fromProjectPk(row.projectid) : undefined;

  const leadCopy = decision === 'Approved'
    ? buildTaskCreateApprovedCopy(summary, reviewerName)
    : buildTaskCreateRejectedCopy(summary, reviewerName, decisionReason || '');
  notifyRequester(requesterId, {
    type: 'approval',
    title: leadCopy.title,
    message: leadCopy.message,
    detail: leadCopy.detail,
    metadata: leadCopy.metadata,
    actorId,
    projectId: projectIdStr
  });

  if (decision !== 'Approved') return;
  const assigneeIds = Array.from(new Set(proposed.assigneeIds || [])).filter(
    (id) => id !== requesterId && id !== actorId
  );
  if (assigneeIds.length === 0) return;
  const assigneeCopy = buildTaskAssigneeApprovedCopy(summary, reviewerName);
  notificationService
    .publishEvent({
      type: 'task_assigned',
      title: assigneeCopy.title,
      message: assigneeCopy.message,
      detail: assigneeCopy.detail,
      metadata: assigneeCopy.metadata,
      actorId,
      projectId: projectIdStr,
      recipientIds: assigneeIds
    })
    .catch((error) => console.error('[projectApproval.service] Failed to notify task assignees.', error));
};

const REQUEST_TYPE_LABEL: Record<ProjectApprovalRequestType, string> = {
  PROJECT_CREATE: 'create',
  TASK_CREATE: 'create task',
  PROJECT_EDIT: 'edit',
  PROJECT_ARCHIVE: 'archive',
  PROJECT_RESTORE: 'restore',
  PROJECT_DELETE: 'delete',
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
  if (requesterRole !== 'Team_Lead' && requesterRole !== 'Team_Member') {
    throw new ProjectAuthorizationError('Only project leads can submit project approval requests.');
  }
  if (!reason?.trim()) {
    throw new ProjectValidationError('A reason is required to submit this request for Admin approval.');
  }

  const projectPk = toProjectPk(projectIdStr);
  const row = await projectRepo.findProjectById(projectPk);
  if (!row) throw new ProjectNotFoundError('Project not found.');

  const [members, teamMembers] = await Promise.all([
    projectRepo.findMembersForProject(projectPk),
    projectRepo.findTeamMembersForProject(projectPk)
  ]);
  // isTeamLeadOfProject so any of a multi-team project's several team leads may submit a request
  // for it, not just whichever one resolveTeamLeadUserId happens to resolve first.
  if (!isTeamLeadOfProject(row, members, teamMembers, requesterId)) {
    throw new ProjectAuthorizationError('You can only request changes for projects you lead.');
  }

  let persistedChanges = requestedChanges;
  if (requestType === 'PROJECT_EDIT') {
    const current = rowToProjectDTO(row, members, 0);
    const requestedEdit = { ...(requestedChanges || {}) } as UpdateProjectInput;
    const participants = resolveUpdatedParticipants(current.teamLeadId, requestedEdit.teamLeadId, requestedEdit.memberIds);
    if (participants.error) throw new ProjectValidationError(participants.error);
    if (requestedEdit.memberIds !== undefined) requestedEdit.memberIds = participants.memberIds;
    const payload = buildProjectEditPayload(current, requestedEdit);
    if (payload.changes.length === 0) {
      throw new ProjectValidationError('No project changes were detected. Update at least one field before requesting approval.');
    }
    persistedChanges = payload as unknown as Record<string, unknown>;
  }

  const approvalRequestId = await repo.insertApprovalRequest({
  projectId: projectPk,
  projectTitle: row.projectname,
  requestType,
  requestedByUserId: toUserPk(requesterId),
  requestedChangesJson: persistedChanges ? JSON.stringify(persistedChanges) : null,
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

export const createTaskApprovalRequest = async (
  proposed: CreateTaskInput, requesterId: string, requesterRole: string
): Promise<ProjectApprovalRequestDTO> => {
  if (requesterRole === 'Admin' || requesterRole === 'HR') throw new ProjectAuthorizationError('Only Team Leads can submit task creation requests.');
  const projectPk = toProjectPk(proposed.projectId);
  const project = await projectRepo.findProjectById(projectPk);
  if (!project || project.statuscode !== 'Active') throw new ProjectNotFoundError('Active project not found.');
  const [members, teams, teamMembers] = await Promise.all([
    projectRepo.findMembersForProject(projectPk),
    projectRepo.findTeamsForProject(projectPk),
    projectRepo.findTeamMembersForProject(projectPk)
  ]);
  if (!isTeamLeadOfProject(project, members, teamMembers, requesterId)) {
    throw new ProjectAuthorizationError('You can only create tasks for a project you lead.');
  }
  if (!proposed.assigneeIds?.length) {
    throw new ProjectValidationError('Team Leads must assign each new task to themselves or a member of their team.');
  }
  if (teams.length > 0) {
    const actorTeam = teamMembers.find((member) => member.userid === toUserPk(requesterId) && member.islead);
    if (!actorTeam) throw new ProjectAuthorizationError('You can only create tasks for your own team.');
    const assigneeIds = [proposed, ...(proposed.subtasks || [])].flatMap((task) => task.assigneeIds || []);
    if (assigneeIds.some((id) => !teamMembers.some((member) => member.teamid === actorTeam.teamid && member.userid === toUserPk(id)))) {
      throw new ProjectAuthorizationError('Every proposed assignee must belong to your team.');
    }
    proposed = { ...proposed, teamId: `tm-${actorTeam.teamid}` };
  }
  const reason = (proposed as CreateTaskInput & { creationReason?: string }).creationReason?.trim() || `Create task "${proposed.title.trim()}".`;
  const approvalRequestId = await repo.insertApprovalRequest({
    projectId: projectPk, projectTitle: project.projectname, requestType: 'TASK_CREATE',
    requestedByUserId: toUserPk(requesterId), requestedChangesJson: JSON.stringify(proposed), reason
  });
  // Everything §7 requires an Admin to have in order to decide — project, team, task, assignee,
  // description, priority, deadline and the requesting Team Lead — in the expanded body, leaving the
  // preview to the one line that says what happened.
  const summary = await summarizeProposedTask(proposed, project.projectname, requesterId, teams, teamMembers);
  const requestCopy = buildTaskCreateRequestCopy(summary);
  notifyAdmins({
    type: 'approval',
    title: requestCopy.title,
    message: requestCopy.message,
    detail: requestCopy.detail,
    metadata: requestCopy.metadata,
    actorId: requesterId,
    projectId: proposed.projectId
  });
  return toDTO((await repo.findApprovalRequestById(approvalRequestId))!);
};

// Admin's Approval Inbox -- every Pending request, regardless of project. HR is deliberately
// never checked for here or anywhere else in this module: HR has no role in this workflow beyond
// the read-only Activity Log visibility it already has (backend/src/activity), which this module
// doesn't touch.
export const listApprovalsForAdmin = async (actorRole: string, status?: 'Pending' | 'Approved' | 'Rejected'): Promise<ProjectApprovalRequestDTO[]> => {
  if (actorRole !== 'Admin') throw new ProjectAuthorizationError('Only Admins can view the project approval inbox.');
  const rows = await repo.findApprovalRequests(status);
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
  const decisionError = validateProjectDecision(decision, decisionReason);
  if (decisionError) throw new ProjectValidationError(decisionError);

  const projectIdStr = fromProjectPk(row.projectid);
  const requesterId = fromUserPk(row.requestedbyuserid);
  // Captured before execution -- a PROJECT_PERMANENT_DELETE removes the project row entirely,
  // so this is the only point at which its name is still readable.
  const projectRowBeforeExecution = await projectRepo.findProjectById(row.projectid);
  const projectName = projectRowBeforeExecution?.projectname || projectIdStr;

  if (decision === 'Approved') {
    switch (row.requesttype) {
      case 'PROJECT_CREATE':
        // The deciding Admin is passed as the actor so the team assignments this materializes are
        // attributed to them, not to the member who proposed the setup (§3 -- the Admin may have
        // edited it via changePendingSetup first).
        await projectService.activatePendingProject(projectIdStr, 'Admin', actorId);
        break;
      case 'TASK_CREATE': {
        const proposal = row.requestedchangesjson ? JSON.parse(row.requestedchangesjson) as CreateTaskInput : null;
        if (!proposal) throw new ProjectValidationError('This task request has invalid setup details.');
        const requester = userStore.findById(requesterId);
        await taskService.createTask(proposal, requesterId, requester?.role || 'Team_Member');
        break;
      }
      case 'PROJECT_EDIT':
        {
          const payload = parseProjectEditPayload(row.requestedchangesjson);
          if (!payload) throw new ProjectValidationError('This project edit request has invalid or incomplete change details.');
          const currentRow = await projectRepo.findProjectById(row.projectid);
          if (!currentRow) throw new ProjectNotFoundError('Project not found.');
          const currentMembers = await projectRepo.findMembersForProject(row.projectid);
          const conflicts = conflictingProjectFields(rowToProjectDTO(currentRow, currentMembers, 0), payload);
          if (conflicts.length > 0) {
            throw new ProjectValidationError(
              `This project changed after the request was submitted. Review and resubmit: ${conflicts.join(', ')}.`
            );
          }
        await projectService.updateProject(
          projectIdStr,
          payload.proposal,
          actorId,
          'Admin'
        );
        break;
        }
      case 'PROJECT_ARCHIVE':
        await projectService.archiveProject(projectIdStr, row.reason, actorId, 'Admin');
        break;
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

  const decided = await repo.decideApprovalRequest(
    approvalRequestId,
    decision,
    toUserPk(actorId),
    decisionReason?.trim() || null
  );
  let decidedDto: ProjectApprovalRequestDTO;
  if (!decided) {
    if (decision === 'Approved' && row.requesttype === 'PROJECT_PERMANENT_DELETE') {
      decidedDto = {
        id: row.approvalrequestid,
        projectId: projectIdStr,
        projectTitle: projectName,
        requestType: row.requesttype,
        requestedByUserId: requesterId,
        requestedByName: actorName(requesterId),
        requestedChanges: null,
        reason: row.reason,
        status: 'Approved',
        reviewedByUserId: actorId,
        reviewedByName: actorName(actorId),
        decisionReason: decisionReason?.trim() || undefined,
        createdAt: row.createdatutc.toISOString(),
        decidedAt: new Date().toISOString()
      };
    } else {
      throw new ProjectValidationError('This request has already been decided.');
    }
  } else {
    decidedDto = await toDTO(decided);
  }

  if (projectDecisionEffect(row.requesttype, decision) === 'remove-rejected-creation') {
    const archived = await projectRepo.archiveProject(
      row.projectid,
      toUserPk(actorId),
      `Creation rejected: ${decisionReason!.trim()}`
    );
    if (!archived || !await projectRepo.permanentlyDeleteProject(row.projectid)) {
      throw new ProjectValidationError('The rejected project proposal could not be removed.');
    }
  }

  const requesterDisplayName = actorName(requesterId);
  const reviewerDisplayName = actorName(actorId);
  const outcomeVerb = decision === 'Approved' ? 'approved' : 'rejected';

  if (row.requesttype === 'TASK_CREATE') {
    // TASK_CREATE has its own copy because the project templates below narrate everything by
    // project name — which for a task request is the wrong subject entirely, and produced
    // "rejected your request to create task "ERP Management System"": the project's name where the
    // proposed task's title belongs (§7).
    await notifyTaskCreateDecision(row, decision, actorId, decisionReason, projectName, requesterId);
  } else {
    const rejectionCopy = decision === 'Rejected' ? buildProjectApprovalRejectionCopy({
      reviewerName: reviewerDisplayName,
      projectName,
      requestTypeLabel: REQUEST_TYPE_LABEL[row.requesttype],
      reason: decisionReason || '',
      decidedAt: decidedDto.decidedAt ? new Date(decidedDto.decidedAt) : new Date()
    }) : null;
    notifyRequester(requesterId, {
      type: 'approval',
      title: rejectionCopy?.title || `Project Request ${decision}`,
      message: rejectionCopy?.message || buildProjectDecisionMessage(
        reviewerDisplayName,
        decision,
        REQUEST_TYPE_LABEL[row.requesttype],
        projectName,
        decisionReason
      ),
      detail: rejectionCopy?.detail || (
        // §3: an approved proposal is the moment its author becomes a Team Lead, and the plain
        // decision line does not say so. Which team they lead is in their own team-assignment
        // notification, published by activatePendingProject from the final approved configuration.
        row.requesttype === 'PROJECT_CREATE' && decision === 'Approved'
          ? `${reviewerDisplayName} approved your project "${projectName}". You are now the Team Lead of ` +
            'the team you proposed — see your team assignment notification for which team, and for its ' +
            'final membership as approved.'
          : undefined
      ),
      metadata: rejectionCopy?.metadata || (
        row.requesttype === 'PROJECT_CREATE' && decision === 'Approved'
          ? { project: projectName, approvedBy: `${reviewerDisplayName} (Admin)`, role: 'Team Lead', status: 'Approved' }
          : undefined
      ),
      actorId,
      projectId:
        row.requesttype === 'PROJECT_PERMANENT_DELETE' ||
        (row.requesttype === 'PROJECT_CREATE' && decision === 'Rejected')
          ? undefined
          : projectIdStr
    });
  }
  recordActivitySafe({
    actorId, actorName: reviewerDisplayName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: row.requesttype === 'PROJECT_EDIT' ? `Project Edit ${decision}` : decision,
    module: 'Projects', entityType: 'Project', entityId: projectIdStr,
    entityName: projectName, projectName,
    description: `${reviewerDisplayName} ${outcomeVerb} ${requesterDisplayName}'s request to ${REQUEST_TYPE_LABEL[row.requesttype]} "${projectName}".`,
    reason: decisionReason?.trim() || undefined, linkRoute: 'approvals', important: true
  });

  // A PROJECT_PERMANENT_DELETE that was just approved cascade-deletes this very request row
  // (FK_ProjectApprovalRequests_Project ON DELETE CASCADE, database/25_project_approvals.sql) --
  // there's nothing left to re-fetch or mark Approved. Report the outcome from the in-memory row
  // instead of erroring on "row not found."
  return decidedDto;
};

export const changePendingSetup = async (id: string, changes: Record<string, unknown>, actorId: string, actorRole: string): Promise<ProjectApprovalRequestDTO> => {
  if (actorRole !== 'Admin') throw new ProjectAuthorizationError('Only Admins can change approval setup.');
  const row = await repo.findApprovalRequestById(id);
  if (!row || row.requeststatus !== 'Pending') throw new ProjectValidationError('Only pending requests can be changed.');
  if (row.requesttype !== 'PROJECT_CREATE' && row.requesttype !== 'TASK_CREATE') throw new ProjectValidationError('Change Setup is only available for creation requests.');
  if (row.requesttype === 'PROJECT_CREATE') await projectService.updateProject(fromProjectPk(row.projectid), changes as UpdateProjectInput, actorId, 'Admin');
  const updated = await repo.updatePendingApprovalSetup(id, JSON.stringify(changes));
  if (!updated) throw new ProjectValidationError('The request is no longer pending.');
  return toDTO(updated);
};
