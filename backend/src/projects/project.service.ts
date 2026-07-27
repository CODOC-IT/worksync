import * as repo from './project.repository.js';
import { rowToProjectDTO } from './project.mapper.js';
import { fromUserPk, toProjectPk, toUserPk } from '../utils/idMapping.js';
import { userStore } from '../store/userStore.js';
import * as notificationService from '../notifications/notification.service.js';
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
  const isLead = members.some(
    (member) => member.memberrolecode === 'TeamLead' && fromUserPk(member.userid) === userId
  );
  if (!isLead) {
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

export const getProjectForUser = async (projectId: string, userId: string, role: string): Promise<ProjectDTO> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');

  const members = await repo.findMembersForProject(row.projectid);
  const isMember = members.some((member) => fromUserPk(member.userid) === userId) || fromUserPk(row.owneruserid) === userId;
  if (role !== 'Admin' && !isMember) {
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

  return dto;
};
