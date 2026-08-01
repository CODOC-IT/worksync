import * as repo from './project.repository.js';
import { resolveTeamLeadUserId, rowToProjectDTO } from './project.mapper.js';
import { fromUserPk, toProjectPk, toUserPk } from '../utils/idMapping.js';
import { actorDisplayName } from '../utils/actorDisplay.js';
import { userStore } from '../store/userStore.js';
import * as notificationService from '../notifications/notification.service.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import {
  API_TO_DB_PRIORITY,
  API_TO_DB_PROJECT_STATUS,
  ApiProjectStatus,
  CreateProjectInput,
  ProjectDTO,
  ProjectMemberRoleCode,
  ProjectMemberRow,
  ProjectRow,
  UpdateProjectInput
} from './project.types.js';

// Service Layer — business logic + authorization + notification publishing live here (Service
// Layer / Clean Architecture, matching backend/src/notifications). No SQL here (that's
// project.repository.ts); no Express req/res here (that's project.controller.ts).
//
// Recipient resolution for project events queries work.ProjectMembers directly rather than
// going through notification.recipients.ts — that file resolves recipients from the *old*
// in-memory projectStore.ts mock, which Attendance/Break/Chat/AI (out of scope for this branch)
// still use. Now that Projects are real Postgres rows, this service is the actual source of
// truth for "who's on this project," so it queries that directly.

export class ProjectAuthorizationError extends Error {}
export class ProjectNotFoundError extends Error {}
export class ProjectValidationError extends Error {}

const buildDTO = async (row: ProjectRow, members: ProjectMemberRow[]): Promise<ProjectDTO> => {
  const progress = await repo.getProjectProgress(row.projectid);
  return rowToProjectDTO(row, members, progress);
};

const buildDetailDTO = async (row: ProjectRow, members: ProjectMemberRow[]): Promise<ProjectDTO> => {
  const [progress, milestones, files] = await Promise.all([
    repo.getProjectProgress(row.projectid),
    repo.findMilestonesForProject(row.projectid),
    repo.findProjectFiles(row.projectid)
  ]);
  return rowToProjectDTO(row, members, progress, milestones, files);
};

const assertCanCreate = (role: string) => {
  if (role !== 'Admin' && role !== 'Team_Lead' && role !== 'Team_Member') {
    throw new ProjectAuthorizationError('Only Admins and project members can create projects.');
  }
};

const assertCanManage = async (projectRow: ProjectRow, userId: string, role: string) => {
  if (role === 'Admin') return;
  if (role === 'HR') {
    throw new ProjectAuthorizationError('HR users cannot manage projects.');
  }
  const members = await repo.findMembersForProject(projectRow.projectid);
  if (resolveTeamLeadUserId(projectRow, members) !== userId) {
    throw new ProjectAuthorizationError('You can only manage projects you lead.');
  }
};

const notifyRecipients = (
  members: ProjectMemberRow[],
  actorId: string,
  event: Omit<Parameters<typeof notificationService.publishEvent>[0], 'recipientIds'>
) => {
  const recipientIds = Array.from(new Set(members.map((member) => fromUserPk(member.userid)))).filter(
    (id) => id !== actorId
  );
  if (recipientIds.length === 0) return;
  notificationService.publishEvent({ ...event, recipientIds }).catch((error) => {
    console.error('[project.service] Failed to publish notification event.', event.type, error);
  });
};

export const listProjectsForUser = async (userId: string, role: string): Promise<ProjectDTO[]> => {
  // HR gets the same "see every project" query Admin does -- read-only visibility only; nothing
  // else in this file (assertCanCreate/assertCanManage) grants HR any write/manage capability, so
  // this alone can't let HR do anything beyond viewing.
  const rows =
    role === 'Admin' || role === 'HR' ? await repo.findAllProjects() : await repo.findProjectsForUser(toUserPk(userId));
  if (rows.length === 0) return [];
  const membersByProject = await repo.findMembersForProjects(rows.map((row) => row.projectid));
  return Promise.all(
    rows.map((row) => buildDTO(row, membersByProject.filter((member) => member.projectid === row.projectid)))
  );
};

const isMemberOfRow = (row: ProjectRow, members: ProjectMemberRow[], userId: string): boolean =>
  members.some((member) => fromUserPk(member.userid) === userId) || fromUserPk(row.owneruserid) === userId;

// Shared with task.service.ts (a task's project-level access = its parent project's access —
// there's no separate task-level ACL in the schema) so Task Module authorization stays
// consistent with Project Module authorization without duplicating the membership query.
export const isProjectAccessible = async (projectId: string, userId: string, role: string): Promise<boolean> => {
  if (role === 'Admin') return true;
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) return false;
  const members = await repo.findMembersForProject(row.projectid);
  return isMemberOfRow(row, members, userId);
};

// Whether `userId` leads (or, as Admin, may act on) the given project — used by task.service.ts
// to gate task status-change review Approve/Reject the same way Project updates are gated.
export const isProjectLead = async (projectId: string, userId: string, role: string): Promise<boolean> => {
  if (role === 'Admin') return true;
  if (role === 'HR') return false;
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) return false;
  const members = await repo.findMembersForProject(row.projectid);
  return resolveTeamLeadUserId(row, members) === userId;
};

export const getProjectForUser = async (projectId: string, userId: string, role: string): Promise<ProjectDTO> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');

  const members = await repo.findMembersForProject(row.projectid);
  // Same HR read-only bypass as listProjectsForUser above -- HR can open any project's detail
  // view, but this function only ever returns data, never grants a mutation.
  if (role !== 'Admin' && role !== 'HR' && !isMemberOfRow(row, members, userId)) {
    throw new ProjectAuthorizationError('You do not have access to this project.');
  }

  return buildDetailDTO(row, members);
};

export const getProjectMemberDirectoryForUser = async (
  projectId: string,
  userId: string,
  role: string
) => {
  const project = await getProjectForUser(projectId, userId, role);
  const members = project.memberIds
    .map((memberId) => userStore.findById(memberId))
    .filter((member): member is NonNullable<typeof member> => Boolean(member))
    .map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      department: member.department,
      title: member.title,
      status: member.status
    }));

  return {
    teamLeadId: project.teamLeadId,
    memberIds: project.memberIds,
    members
  };
};

export const createProject = async (
  input: CreateProjectInput,
  actorId: string,
  actorRole: string
): Promise<ProjectDTO> => {
  assertCanCreate(actorRole);

  if (!input.title?.trim()) throw new ProjectValidationError('Project title is required.');
  if (!input.description?.trim()) throw new ProjectValidationError('Project description is required.');
  if (!input.startDate || !input.targetDate) throw new ProjectValidationError('Start and target dates are required.');
  if (input.targetDate < input.startDate) throw new ProjectValidationError('Target date cannot be before the start date.');

  const priorityCode = API_TO_DB_PRIORITY[input.priority] || 'Medium';
  const priorityId = await repo.getPriorityId(priorityCode);
  // Admin-created projects go live immediately; a Team Lead's submission needs Admin activation
  // (the same two-step flow the frontend prototype already modeled) — see
  // project.service.ts's activateProject for the other half of this.
  const statusCode = actorRole === 'Admin' ? 'Active' : 'PendingActivation';
  const statusId = await repo.getProjectStatusId(statusCode);

  const ownerPk = toUserPk(actorId);
  const teamLeadPk = input.teamLeadId ? toUserPk(input.teamLeadId) : actorRole !== 'Admin' ? ownerPk : undefined;
  const memberPks = (input.memberIds || []).map(toUserPk);

  const projectId = await repo.insertProject({
    title: input.title.trim(),
    description: input.description.trim(),
    priorityId,
    statusId,
    startDate: input.startDate,
    targetDate: input.targetDate,
    ownerUserId: ownerPk,
    createdByUserId: ownerPk,
    creationReason: input.creationReason?.trim() || null,
    teamLeadUserId: teamLeadPk,
    memberUserIds: memberPks
  });

  const row = await repo.findProjectById(projectId);
  const members = await repo.findMembersForProject(projectId);
  const dto = await buildDTO(row!, members);
  const actorName = actorDisplayName(actorId);

  if (statusCode === 'Active') {
    notifyRecipients(members, actorId, {
      type: 'project_created',
      title: 'Project Created',
      message: `${actorName} created "${dto.title}" and added you to it.`,
      actorId,
      projectId: dto.id
    });
  } else {
    // Pending activation: the acting Team Lead's own team hears they were added; Admins hear a
    // project needs their activation decision.
    notifyRecipients(members, actorId, {
      type: 'project_created',
      title: 'Project Created',
      message: `${actorName} created "${dto.title}" and added you to it (pending Admin activation).`,
      actorId,
      projectId: dto.id
    });
    (async () => {
      const admins = (await userStore.getAllUsers()).filter(
        (user) => user.role === 'Admin' && user.id !== actorId
      );
      await notificationService.publishEvent({
        type: 'approval',
        title: 'Project Activation Requested',
        message: `${actorName} submitted "${dto.title}" for activation.`,
        actorId,
        projectId: dto.id,
        recipientIds: admins.map((user) => user.id)
      });
    })().catch((error) => console.error('[project.service] Failed to publish approval-request event.', error));
  }

  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Created', module: 'Projects', entityType: 'Project', entityId: dto.id,
    entityName: dto.title, projectId: dto.id, projectName: dto.title,
    description: `${actorName} created project “${dto.title}”.`, reason: input.creationReason,
    linkRoute: 'projects', important: statusCode !== 'Active',
    changes: [
      { field: 'Status', previousValue: null, newValue: dto.status },
      { field: 'Priority', previousValue: null, newValue: priorityCode }
    ]
  });

  return dto;
};

export const updateProject = async (
  projectId: string,
  input: UpdateProjectInput,
  actorId: string,
  actorRole: string
): Promise<ProjectDTO> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');
  await assertCanManage(row, actorId, actorRole);

  if (input.title !== undefined && !input.title.trim()) {
    throw new ProjectValidationError('Project title cannot be empty.');
  }
  if (input.description !== undefined && !input.description.trim()) {
    throw new ProjectValidationError('Project description cannot be empty.');
  }
  // Archiving/restoring must use their dedicated endpoints so the project and all of its related
  // tasks change archive state in one transaction. Rejecting this generic status shortcut also
  // prevents API clients from bypassing the task cascade implemented by archiveProject/restoreProject.
  if (input.status === 'Archived' && row.statuscode !== 'Archived') {
    throw new ProjectValidationError('Use the project archive action to archive this project and its tasks.');
  }
  if (row.statuscode === 'Archived' && input.status && input.status !== 'Archived') {
    throw new ProjectValidationError('Use the project restore action to restore this project and its tasks.');
  }
  // Start date is fixed at creation and never editable again, matching the edit form's disabled
  // Start Date field (frontend/.../ProjectsView.tsx) -- enforced here too since a client could
  // otherwise call this endpoint directly and bypass the disabled UI field.
  if (input.startDate !== undefined && input.startDate !== row.startdate) {
    throw new ProjectValidationError('Start date cannot be changed after project creation.');
  }
  // An end-date change that would strand an existing milestone past the new deadline is rejected
  // outright, reusing repo.findMilestonesForProject (already used by buildDetailDTO) rather than
  // adding a new query.
  if (input.targetDate !== undefined && input.targetDate !== row.enddate) {
    const milestones = await repo.findMilestonesForProject(row.projectid);
    const strandedMilestones = milestones.filter((milestone) => milestone.duedate > input.targetDate!);
    if (strandedMilestones.length > 0) {
      throw new ProjectValidationError(
        `Cannot change the end date to ${input.targetDate}: ${strandedMilestones.length} existing milestone(s) ` +
        `(${strandedMilestones.map((milestone) => milestone.milestonename).join(', ')}) fall after that date.`
      );
    }
  }

  const updates: repo.UpdateProjectRow = {
    title: input.title?.trim(),
    description: input.description?.trim(),
    targetDate: input.targetDate,
    creationReason: input.creationReason?.trim()
  };
  if (input.priority) updates.priorityId = await repo.getPriorityId(API_TO_DB_PRIORITY[input.priority]);
  // Ordinary lifecycle changes (such as activating a pending project) still use this update path.
  // Archive/restore are deliberately handled above by their transactional cascade endpoints.
  if (input.status) {
    if (input.status !== row.statuscode && input.status !== 'Pending Approval' && actorRole !== 'Admin') {
      throw new ProjectAuthorizationError('Only Admins can change a project\'s status.');
    }
    updates.statusId = await repo.getProjectStatusId(API_TO_DB_PROJECT_STATUS[input.status as ApiProjectStatus]);
  }

  await repo.updateProject(row.projectid, updates);

  // TeamLead is a ProjectMembers role, not a projects-table column (see reassignTeamLead's
  // comment), so it's handled as its own step rather than through the updates object above.
  if (input.teamLeadId !== undefined) {
    await repo.reassignTeamLead(row.projectid, toUserPk(input.teamLeadId), row.owneruserid, toUserPk(actorId));
  }

  const updatedRow = await repo.findProjectById(row.projectid);
  const members = await repo.findMembersForProject(row.projectid);
  const dto = await buildDTO(updatedRow!, members);
  const actorName = actorDisplayName(actorId);

  notifyRecipients(members, actorId, {
    type: 'project_updated',
    title: 'Project Updated',
    message: `${actorName} updated "${dto.title}".`,
    actorId,
    projectId: dto.id
  });

  const projectChanges = [
    input.title !== undefined && input.title.trim() !== row.projectname ? { field: 'Title', previousValue: row.projectname, newValue: dto.title } : null,
    input.description !== undefined && input.description.trim() !== row.description ? { field: 'Description', previousValue: row.description, newValue: dto.description } : null,
    input.priority !== undefined && API_TO_DB_PRIORITY[input.priority] !== row.prioritycode ? { field: 'Priority', previousValue: row.prioritycode, newValue: input.priority } : null,
    input.status !== undefined && API_TO_DB_PROJECT_STATUS[input.status] !== row.statuscode ? { field: 'Status', previousValue: row.statuscode, newValue: dto.status } : null,
    input.startDate !== undefined && input.startDate !== row.startdate ? { field: 'Start date', previousValue: row.startdate, newValue: dto.startDate } : null,
    input.targetDate !== undefined && input.targetDate !== row.enddate ? { field: 'Due date', previousValue: row.enddate, newValue: dto.targetDate } : null
  ].filter((change): change is { field: string; previousValue: string; newValue: string } => Boolean(change));
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: input.status && API_TO_DB_PROJECT_STATUS[input.status] !== row.statuscode ? 'Status Changed' : 'Updated',
    module: 'Projects', entityType: 'Project', entityId: dto.id, entityName: dto.title,
    projectId: dto.id, projectName: dto.title, description: `${actorName} updated project “${dto.title}”.`,
    linkRoute: 'projects', changes: projectChanges
  });

  return dto;
};

export const archiveProject = async (
  projectId: string,
  reason: string,
  actorId: string,
  actorRole: string
): Promise<void> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');
  await assertCanManage(row, actorId, actorRole);
  if (!reason?.trim()) throw new ProjectValidationError('An archive reason is required.');

  const members = await repo.findMembersForProject(row.projectid);
  const archived = await repo.archiveProject(row.projectid, toUserPk(actorId), reason.trim());
  if (!archived) throw new ProjectValidationError('Project is already archived.');

  const actorName = actorDisplayName(actorId);
  notifyRecipients(members, actorId, {
    type: 'project_archived',
    title: 'Project Archived',
    message: `${actorName} archived "${row.projectname}": ${reason.trim()}`,
    actorId,
    projectId
  });
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Deleted', module: 'Projects', entityType: 'Project', entityId: projectId,
    entityName: row.projectname, projectId, projectName: row.projectname,
    description: `${actorName} archived project “${row.projectname}”.`, reason: reason.trim(),
    linkRoute: 'projects', important: true,
    changes: [{ field: 'Status', previousValue: row.statuscode, newValue: 'Archived' }]
  });
};

// Step two of the two-step delete: only an already-Archived project may be hard-deleted, and
// only once. Related tasks/subtasks are deleted transactionally by the repository. A remaining
// project-level Calendar/Discussion/AI FK still surfaces as a clear validation error.
export const permanentlyDeleteProject = async (
  projectId: string,
  actorId: string,
  actorRole: string
): Promise<void> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');
  await assertCanManage(row, actorId, actorRole);
  if (row.statuscode !== 'Archived') {
    throw new ProjectValidationError('Only archived projects can be permanently deleted.');
  }

  let deleted: boolean;
  try {
    deleted = await repo.permanentlyDeleteProject(row.projectid);
  } catch (error) {
    if ((error as { code?: string } | null)?.code === '23503') {
      throw new ProjectValidationError(
        'This project still has calendar events, project discussions, or AI activity linked to it. Remove those first.'
      );
    }
    throw error;
  }
  if (!deleted) throw new ProjectValidationError('Project could not be permanently deleted.');

  const actorName = actorDisplayName(actorId);
  // No projectId here -- the row is gone, so a real FK reference would itself violate the
  // AuditEvents FK. projectName is a plain snapshot column, safe to keep for readability.
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Deleted', module: 'Projects', entityType: 'Project', entityId: projectId,
    entityName: row.projectname, projectName: row.projectname,
    description: `${actorName} permanently deleted project “${row.projectname}”.`,
    linkRoute: 'projects', important: true,
    changes: [{ field: 'Status', previousValue: row.statuscode, newValue: 'Permanently Deleted' }]
  });
};

// Restores an Archived project back to Active. Deliberately not routed through updateProject:
// that generic path never touches ArchivedAtUtc/ArchivedByUserId/ArchiveReason, so a plain
// status-only update would leave the row's archive fields stale (see repo.restoreProject's
// comment) -- reusing it here would silently break a later archive of the same project. All
// Other project data (members, milestones, files, notes, team lead) is untouched; related tasks'
// project-driven archive markers are cleared in the same transaction so they become active again.
export const restoreProject = async (
  projectId: string,
  actorId: string,
  actorRole: string
): Promise<void> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');
  await assertCanManage(row, actorId, actorRole);
  if (row.statuscode !== 'Archived') {
    throw new ProjectValidationError('Only archived projects can be restored.');
  }

  const members = await repo.findMembersForProject(row.projectid);
  const restored = await repo.restoreProject(row.projectid);
  if (!restored) throw new ProjectValidationError('Project could not be restored.');

  const actorName = actorDisplayName(actorId);
  notifyRecipients(members, actorId, {
    type: 'project_restored',
    title: 'Project Restored',
    message: `${actorName} restored "${row.projectname}" from Archives.`,
    actorId,
    projectId
  });
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Status Changed', module: 'Projects', entityType: 'Project', entityId: projectId,
    entityName: row.projectname, projectId, projectName: row.projectname,
    description: `${actorName} restored project “${row.projectname}” from Archives.`,
    linkRoute: 'projects', important: true,
    changes: [{ field: 'Status', previousValue: row.statuscode, newValue: 'Active' }]
  });
};

export const addMember = async (
  projectId: string,
  memberUserId: string,
  roleCode: ProjectMemberRoleCode | undefined,
  actorId: string,
  actorRole: string
): Promise<ProjectDTO> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');
  await assertCanManage(row, actorId, actorRole);

  await repo.addProjectMember(row.projectid, toUserPk(memberUserId), roleCode || 'Member', toUserPk(actorId));

  const members = await repo.findMembersForProject(row.projectid);
  const dto = await buildDTO(row, members);
  const actorName = actorDisplayName(actorId);

  notificationService
    .publishEvent({
      type: 'project_member_added',
      title: 'Added to Project',
      message: `${actorName} added you to "${dto.title}".`,
      actorId,
      projectId: dto.id,
      recipientIds: [memberUserId]
    })
    .catch((error) => console.error('[project.service] Failed to publish member-added event.', error));

  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    affectedUserId: memberUserId, affectedUserName: userStore.findById(memberUserId)?.name,
    action: 'Assigned', module: 'Projects', entityType: 'User', entityId: memberUserId,
    entityName: userStore.findById(memberUserId)?.name, projectId: dto.id, projectName: dto.title,
    description: `${actorName} added ${userStore.findById(memberUserId)?.name || memberUserId} to “${dto.title}”.`,
    linkRoute: 'projects', changes: [{ field: 'Project role', previousValue: null, newValue: roleCode || 'Member' }]
  });

  return dto;
};

export const removeMember = async (
  projectId: string,
  memberUserId: string,
  reason: string,
  actorId: string,
  actorRole: string
): Promise<ProjectDTO> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');
  await assertCanManage(row, actorId, actorRole);

  const removed = await repo.removeProjectMember(
    row.projectid,
    toUserPk(memberUserId),
    toUserPk(actorId),
    reason?.trim() || 'Removed from project'
  );
  if (!removed) throw new ProjectValidationError('That user is not an active member of this project.');

  const members = await repo.findMembersForProject(row.projectid);
  const dto = await buildDTO(row, members);
  const actorName = actorDisplayName(actorId);

  notificationService
    .publishEvent({
      type: 'project_member_removed',
      title: 'Removed from Project',
      message: `${actorName} removed you from "${dto.title}".`,
      actorId,
      projectId: dto.id,
      recipientIds: [memberUserId]
    })
    .catch((error) => console.error('[project.service] Failed to publish member-removed event.', error));

  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    affectedUserId: memberUserId, affectedUserName: userStore.findById(memberUserId)?.name,
    action: 'Reassigned', module: 'Projects', entityType: 'User', entityId: memberUserId,
    entityName: userStore.findById(memberUserId)?.name, projectId: dto.id, projectName: dto.title,
    description: `${actorName} removed ${userStore.findById(memberUserId)?.name || memberUserId} from “${dto.title}”.`,
    reason, linkRoute: 'projects', important: true
  });

  return dto;
};
