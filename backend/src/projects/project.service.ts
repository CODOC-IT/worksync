import * as repo from './project.repository.js';
import { resolveTeamLeadUserId, rowToProjectDTO } from './project.mapper.js';
import { fromUserPk, toProjectPk, toUserPk } from '../utils/idMapping.js';
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

const assertCanCreate = (role: string) => {
  if (role !== 'Admin' && role !== 'Team_Lead') {
    throw new ProjectAuthorizationError('Only Admins and Team Leads can create projects.');
  }
};

const assertCanManage = async (projectRow: ProjectRow, userId: string, role: string) => {
  if (role === 'Admin') return;
  if (role !== 'Team_Lead') {
    throw new ProjectAuthorizationError('Only Admins and Team Leads can manage projects.');
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
    console.warn('[project.service] Failed to publish notification event.', error);
  });
};

export const listProjectsForUser = async (userId: string, role: string): Promise<ProjectDTO[]> => {
  const rows = role === 'Admin' ? await repo.findAllProjects() : await repo.findProjectsForUser(toUserPk(userId));
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
  if (role !== 'Team_Lead') return false;
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) return false;
  const members = await repo.findMembersForProject(row.projectid);
  return resolveTeamLeadUserId(row, members) === userId;
};

export const getProjectForUser = async (projectId: string, userId: string, role: string): Promise<ProjectDTO> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');

  const members = await repo.findMembersForProject(row.projectid);
  if (role !== 'Admin' && !isMemberOfRow(row, members, userId)) {
    throw new ProjectAuthorizationError('You do not have access to this project.');
  }

  return buildDTO(row, members);
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
  const teamLeadPk = input.teamLeadId ? toUserPk(input.teamLeadId) : actorRole === 'Team_Lead' ? ownerPk : undefined;
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
  const actorName = userStore.findById(actorId)?.name || 'Someone';

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
    notificationService
      .publishEvent({
        type: 'approval',
        title: 'Project Activation Requested',
        message: `${actorName} submitted "${dto.title}" for activation.`,
        actorId,
        projectId: dto.id,
        recipientIds: userStore
          .getAllUsers()
          .filter((user) => user.role === 'Admin' && user.id !== actorId)
          .map((user) => user.id)
      })
      .catch((error) => console.warn('[project.service] Failed to publish approval-request event.', error));
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

  const updates: repo.UpdateProjectRow = {
    title: input.title?.trim(),
    description: input.description?.trim(),
    startDate: input.startDate,
    targetDate: input.targetDate
  };
  if (input.priority) updates.priorityId = await repo.getPriorityId(API_TO_DB_PRIORITY[input.priority]);
  // Activating a pending project (Admin-only) goes through this same update path — status is
  // just another field, matching the mandate that PUT /api/projects/:id is the one place a
  // project's fields (including status) change.
  if (input.status) {
    if (input.status !== row.statuscode && input.status !== 'Pending Approval' && actorRole !== 'Admin') {
      throw new ProjectAuthorizationError('Only Admins can change a project\'s status.');
    }
    updates.statusId = await repo.getProjectStatusId(API_TO_DB_PROJECT_STATUS[input.status as ApiProjectStatus]);
  }

  await repo.updateProject(row.projectid, updates);

  const updatedRow = await repo.findProjectById(row.projectid);
  const members = await repo.findMembersForProject(row.projectid);
  const dto = await buildDTO(updatedRow!, members);
  const actorName = userStore.findById(actorId)?.name || 'Someone';

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

  const actorName = userStore.findById(actorId)?.name || 'Someone';
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
  const actorName = userStore.findById(actorId)?.name || 'Someone';

  notificationService
    .publishEvent({
      type: 'project_member_added',
      title: 'Added to Project',
      message: `${actorName} added you to "${dto.title}".`,
      actorId,
      projectId: dto.id,
      recipientIds: [memberUserId]
    })
    .catch((error) => console.warn('[project.service] Failed to publish member-added event.', error));

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
  const actorName = userStore.findById(actorId)?.name || 'Someone';

  notificationService
    .publishEvent({
      type: 'project_member_removed',
      title: 'Removed from Project',
      message: `${actorName} removed you from "${dto.title}".`,
      actorId,
      projectId: dto.id,
      recipientIds: [memberUserId]
    })
    .catch((error) => console.warn('[project.service] Failed to publish member-removed event.', error));

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
