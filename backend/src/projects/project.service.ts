import * as repo from './project.repository.js';
import {
  isTeamLeadOfProject,
  resolveTeamLeadUserId,
  rowToMilestoneDTO,
  rowToProjectDTO,
  rowToProjectFileDTO
} from './project.mapper.js';
import { fromTeamPk, fromUserPk, toProjectPk, toTeamPk, toUserPk } from '../utils/idMapping.js';
import { actorDisplayName } from '../utils/actorDisplay.js';
import { userStore } from '../store/userStore.js';
import * as notificationService from '../notifications/notification.service.js';
import { recordActivitySafe } from '../activity/activity.service.js';
import { findActiveTaskAssignmentsForUserInProject, getProjectTaskCompletion } from '../tasks/task.repository.js';
import { resolveCreateParticipants, resolveTeamSetup, resolveUpdatedParticipants } from './projectWorkflow.rules.js';
import {
  API_TO_DB_PRIORITY,
  API_TO_DB_PROJECT_STATUS,
  ApiProjectStatus,
  CreateMilestoneInput,
  CreateProjectFileInput,
  CreateProjectInput,
  MilestoneDTO,
  MilestoneRow,
  ProjectDTO,
  ProjectFileDTO,
  ProjectMemberRoleCode,
  ProjectMemberRow,
  ProjectRow,
  ProjectTeamRow,
  TeamMemberRow,
  UpdateMilestoneInput,
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

const buildDTO = async (
  row: ProjectRow,
  members: ProjectMemberRow[],
  milestones: MilestoneRow[] = [],
  teams?: ProjectTeamRow[],
  teamMembers?: TeamMemberRow[]
): Promise<ProjectDTO> => {
  const progress = await repo.getProjectProgress(row.projectid);
  if (!teams || !teamMembers) {
    const [fetchedTeams, fetchedTeamMembers] = await Promise.all([
      repo.findTeamsForProject(row.projectid),
      repo.findTeamMembersForProject(row.projectid)
    ]);
    return rowToProjectDTO(row, members, progress, milestones, undefined, fetchedTeams, fetchedTeamMembers);
  }
  return rowToProjectDTO(row, members, progress, milestones, undefined, teams, teamMembers);
};

const buildDetailDTO = async (row: ProjectRow, members: ProjectMemberRow[]): Promise<ProjectDTO> => {
  const [progress, milestones, files, teams, teamMembers] = await Promise.all([
    repo.getProjectProgress(row.projectid),
    repo.findMilestonesForProject(row.projectid),
    repo.findProjectFiles(row.projectid),
    repo.findTeamsForProject(row.projectid),
    repo.findTeamMembersForProject(row.projectid)
  ]);
  return rowToProjectDTO(row, members, progress, milestones, files, teams, teamMembers);
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
  const [members, teamMembers] = await Promise.all([
    repo.findMembersForProject(projectRow.projectid),
    repo.findTeamMembersForProject(projectRow.projectid)
  ]);
  // isTeamLeadOfProject (not resolveTeamLeadUserId's single representative value) so every team's
  // lead on a multi-team project passes this, not just the first 'TeamLead' row found.
  if (!isTeamLeadOfProject(projectRow, members, teamMembers, userId)) {
    throw new ProjectAuthorizationError('You can only manage projects you lead.');
  }
};

// Member management (add/remove) is Admin-only -- deliberately stricter than assertCanManage's
// "Admin, or this project's own lead" rule, which still applies to everything else a lead
// manages (milestones, general project edits via the PROJECT_EDIT approval flow). A Team Lead is
// an existing project member designated as lead, not a separate role with member-management
// authority, so addMember/removeMember use this instead of assertCanManage.
const assertCanManageMembers = (role: string) => {
  if (role !== 'Admin') {
    throw new ProjectAuthorizationError('Only Admins can add or remove project members.');
  }
};

const PROJECT_LEAD_ELIGIBLE_ROLES = new Set(['Team_Lead', 'Team_Member']);
const PROJECT_MEMBER_ELIGIBLE_ROLES = new Set(['Team_Member']);

// Mirrors the eligibility already enforced client-side (frontend/.../ProjectsView.tsx's
// teamLeads/assignableMembers filters: Admins and HR never appear in either selector, and
// inactive accounts are excluded) -- enforced here too so a direct API call (bypassing the UI
// entirely) can't assign an Admin, an HR account, a deactivated account, or a nonexistent id as a
// project's Team Lead or Member. Uses userStore.getAllUsers() rather than the synchronous
// findById(), which only reflects whichever users have already been cached on this process since
// its last cold start (see userStore.ts's own comment on that method).
const assertEligibleAssignee = async (
  userId: string,
  eligibleRoles: Set<string>,
  label: string
): Promise<void> => {
  const target = (await userStore.getAllUsers()).find((user) => user.id === userId);
  if (!target) throw new ProjectValidationError(`Selected ${label} could not be found.`);
  if (target.status === 'inactive') {
    throw new ProjectValidationError(`${target.name} is a deactivated account and cannot be assigned to a project.`);
  }
  if (!eligibleRoles.has(target.role)) {
    throw new ProjectValidationError(`${target.name} is not eligible to be assigned to a project as ${label}.`);
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
  const rows = await repo.findAllProjects();
  if (rows.length === 0) return [];
  const projectIds = rows.map((row) => row.projectid);
  const [membersByProject, milestonesByProject, teamsByProject, teamMembersByProject] = await Promise.all([
    repo.findMembersForProjects(projectIds),
    repo.findMilestonesForProjects(projectIds),
    repo.findTeamsForProjects(projectIds),
    repo.findTeamMembersForProjects(projectIds)
  ]);
  // Admin and HR have organization-wide visibility. Every other user may only receive projects
  // they lead, own, or belong to; this is enforced at the API boundary rather than relying on a
  // client-side card filter that could be bypassed by inspecting the response.
  const visibleRows = (role === 'Admin' || role === 'HR')
    ? rows
    : rows.filter((row) => membersByProject.some(
      (member) => member.projectid === row.projectid && fromUserPk(member.userid) === userId
    ) || fromUserPk(row.owneruserid) === userId);
  return Promise.all(
    visibleRows.map((row) =>
      buildDTO(
        row,
        membersByProject.filter((member) => member.projectid === row.projectid),
        milestonesByProject.filter((milestone) => milestone.projectid === row.projectid),
        teamsByProject.filter((team) => team.projectid === row.projectid),
        teamMembersByProject.filter((member) => member.projectid === row.projectid)
      )
    )
  );
};

const isMemberOfRow = (row: ProjectRow, members: ProjectMemberRow[], userId: string): boolean =>
  members.some((member) => fromUserPk(member.userid) === userId) || fromUserPk(row.owneruserid) === userId;

// Shared with task.service.ts (a task's project-level access = its parent project's access —
// there's no separate task-level ACL in the schema) so Task Module authorization stays
// consistent with Project Module authorization without duplicating the membership query.
export const isProjectAccessible = async (projectId: string, userId: string, role: string): Promise<boolean> => {
  // HR has organization-wide, read-only project/task visibility.  Mutations use the
  // separate lead/manage guards below, so this read bypass cannot grant write access.
  if (role === 'Admin' || role === 'HR') return true;
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) return false;
  const members = await repo.findMembersForProject(row.projectid);
  return isMemberOfRow(row, members, userId);
};

// Whether `userId` leads (or, as Admin, may act on) the given project — used by task.service.ts
// to gate task creation/reopen the same way Project updates are gated. Pass
// `{ allowAdmin: false }` for checks where Admin must NOT get a blanket bypass (e.g. task review
// decisions, which are a per-project Team Lead responsibility, not a system-administration one —
// see task.service.ts's decideReview) — the per-project `MemberRoleCode = 'TeamLead'` check
// itself is unchanged either way, so a Team Member holding that membership row is always treated
// as the project's lead regardless of their account role.
export const isProjectLead = async (
  projectId: string,
  userId: string,
  role: string,
  options: { allowAdmin?: boolean } = {}
): Promise<boolean> => {
  const { allowAdmin = true } = options;
  if (allowAdmin && role === 'Admin') return true;
  if (role === 'HR') return false;
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) return false;
  const [members, teamMembers] = await Promise.all([
    repo.findMembersForProject(row.projectid),
    repo.findTeamMembersForProject(row.projectid)
  ]);
  // isTeamLeadOfProject, not a single resolved lead -- a multi-team project has one 'TeamLead'
  // row per team, and every one of them must be recognized here, not just the first found.
  return isTeamLeadOfProject(row, members, teamMembers, userId);
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
  // Mirrors the frontend's create-only creationReason check (ProjectsView.tsx's validate()) --
  // every non-Admin create becomes a PROJECT_CREATE approval request (see the actorRole check a
  // few lines below), so this is the only thing stopping a direct API call from submitting one
  // with no reviewer context at all (project.controller.ts otherwise silently falls back to a
  // generic placeholder message). Admin creates apply immediately with no approval step, so
  // they're exempt, same as the frontend.
  if (actorRole !== 'Admin' && !input.creationReason?.trim()) {
    throw new ProjectValidationError('Creation notes are required when submitting a project for Admin approval.');
  }

  // Multi-team create/proposal: when the client supplies a full team setup, it becomes the
  // source of truth for the project's structure (and, for a non-Admin submitter, is what an Admin
  // later materializes verbatim on approval). Otherwise we fall back to the legacy single-lead
  // participants flow so nothing already working changes.
  let teamSetup;
  let teamLeadUserIds: string[] | undefined;
  let memberIdsToInsert = input.memberIds;
  let teamsForInsert: repo.InsertTeamRow[] | undefined;
  if (input.teams && input.teams.length > 0) {
    teamSetup = resolveTeamSetup(input.teams);
    if (teamSetup.error) throw new ProjectValidationError(teamSetup.error);
    // A non-Admin submitter must be leading the project they propose (mirrors the single-lead
    // rule below); an Admin has no such constraint because they may build teams for others.
    if (actorRole !== 'Admin' && !teamSetup.teamLeadUserIds.includes(actorId)) {
      throw new ProjectValidationError('The person submitting a project must be a Team Lead of one of its teams.');
    }
    teamLeadUserIds = teamSetup.teamLeadUserIds;
    memberIdsToInsert = teamSetup.memberUserIds;
    teamsForInsert = teamSetup.teams.map((team) => ({
      name: team.name,
      description: team.description,
      leadId: toUserPk(team.leadId),
      memberIds: team.memberIds.map(toUserPk)
    }));
  } else {
    const participants = resolveCreateParticipants(actorId, actorRole, input.teamLeadId, input.memberIds);
    if (participants.error) throw new ProjectValidationError(participants.error);
    teamLeadUserIds = participants.teamLeadId ? [participants.teamLeadId] : [];
    memberIdsToInsert = participants.memberIds;
  }

  const effectiveTeamLeadId = teamLeadUserIds[0];
  if (effectiveTeamLeadId) {
    await assertEligibleAssignee(effectiveTeamLeadId, PROJECT_LEAD_ELIGIBLE_ROLES, 'Team Lead');
  }
  if (teamLeadUserIds.length > 1) {
    for (const leadId of teamLeadUserIds.slice(1)) {
      await assertEligibleAssignee(leadId, PROJECT_LEAD_ELIGIBLE_ROLES, 'Team Lead');
    }
  }
  const effectiveMemberIds = memberIdsToInsert;
  for (const memberId of effectiveMemberIds) {
    if (teamLeadUserIds.includes(memberId)) continue;
    await assertEligibleAssignee(memberId, PROJECT_MEMBER_ELIGIBLE_ROLES, 'a member');
  }

  const priorityCode = API_TO_DB_PRIORITY[input.priority] || 'Medium';
  const priorityId = await repo.getPriorityId(priorityCode);
  // Admin-created projects go live immediately; a Team Lead's submission needs Admin activation
  // (the same two-step flow the frontend prototype already modeled) — see
  // project.service.ts's activateProject for the other half of this.
  const statusCode = actorRole === 'Admin' ? 'Active' : 'PendingActivation';
  const statusId = await repo.getProjectStatusId(statusCode);

  const ownerPk = toUserPk(actorId);
  const teamLeadPk = effectiveTeamLeadId ? toUserPk(effectiveTeamLeadId) : undefined;
  const teamLeadPks = teamLeadUserIds.length > 0 ? teamLeadUserIds.map(toUserPk) : undefined;
  const memberPks = effectiveMemberIds.map(toUserPk);

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
    teamLeadUserIds: teamLeadPks,
    memberUserIds: memberPks,
    teams: teamsForInsert,
    // An Admin who creates a project is its creator, not a team member -- they get no 'Owner'
    // membership row (Admins already have org-wide project access), so they don't show up in the
    // project's own member list. A Team Member/Lead creator, by contrast, always becomes the
    // project's Owner (and, via resolveTeamLeadUserId's owner-fallback, its lead).
    includeOwnerMembership: actorRole !== 'Admin'
  });

  const row = await repo.findProjectById(projectId);
  const members = await repo.findMembersForProject(projectId);
  const dto = await buildDTO(row!, members);
  const actorName = actorDisplayName(actorId);

  // The project's Team Lead reads a distinct "...as the Team Lead" message; every other
  // recipient gets the plain "added you to it" wording — never the reverse. `recipientMessages`
  // is per-recipient, so this is one publishEvent call, not two. There is no separate "Project
  // Lead" concept -- this is the same per-project Team Lead designation resolveTeamLeadUserId
  // resolves, just worded for whoever that happens to be on a single-lead/legacy project.
  const leadFrontendId = teamLeadPk ? fromUserPk(teamLeadPk) : undefined;

  if (statusCode === 'Active') {
    notifyRecipients(members, actorId, {
      type: 'project_created',
      title: 'Project Created',
      message: `${actorName} created "${dto.title}" and added you to it.`,
      recipientMessages: leadFrontendId
        ? { [leadFrontendId]: `${actorName} created "${dto.title}" and added you to it as the Team Lead.` }
        : undefined,
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
      recipientMessages: leadFrontendId
        ? {
            [leadFrontendId]: `${actorName} created "${dto.title}" and added you to it as the Team Lead ` +
              '(pending Admin activation).'
          }
        : undefined,
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
  const currentMembers = await repo.findMembersForProject(row.projectid);
  const currentLeadId = resolveTeamLeadUserId(row, currentMembers);
  const participants = resolveUpdatedParticipants(currentLeadId, input.teamLeadId, input.memberIds);
  if (participants.error) throw new ProjectValidationError(participants.error);
  const effectiveLeadId = participants.teamLeadId;
  if (participants.memberIds !== undefined) {
    input.memberIds = participants.memberIds;
    for (const memberId of input.memberIds) {
      if (memberId === effectiveLeadId) continue;
      await assertEligibleAssignee(memberId, PROJECT_MEMBER_ELIGIBLE_ROLES, 'a member');
    }
  }

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
  const nextStartDate = input.startDate ?? row.startdate;
  const nextTargetDate = input.targetDate ?? row.enddate;
  if (nextTargetDate < nextStartDate) {
    throw new ProjectValidationError('Due date cannot be earlier than the start date.');
  }
  // Historical dates are valid when left untouched. A newly selected date, however, must not be
  // in the past; this prevents accidentally backdating a project while preserving old records.
  const today = new Date().toISOString().slice(0, 10);
  if (input.startDate !== undefined && input.startDate !== row.startdate && input.startDate < today) {
    throw new ProjectValidationError('A changed start date cannot be in the past.');
  }
  if (input.targetDate !== undefined && input.targetDate !== row.enddate && input.targetDate < today) {
    throw new ProjectValidationError('A changed due date cannot be in the past.');
  }
  if (nextStartDate !== row.startdate || nextTargetDate !== row.enddate) {
    const [milestones, tasks] = await Promise.all([
      repo.findMilestonesForProject(row.projectid),
      repo.findActiveTaskDatesForProject(row.projectid)
    ]);
    const outsideMilestones = milestones.filter(
      (milestone) => milestone.duedate < nextStartDate || milestone.duedate > nextTargetDate
    );
    if (outsideMilestones.length > 0) {
      throw new ProjectValidationError(
        `Cannot change project dates: milestone(s) fall outside the new range (${outsideMilestones.map((m) => m.milestonename).join(', ')}).`
      );
    }
    const outsideTasks = tasks.filter(
      (task) => task.startdate < nextStartDate || task.duedate > nextTargetDate
    );
    if (outsideTasks.length > 0) {
      throw new ProjectValidationError(
        `Cannot change project dates: task(s) fall outside the new range (${outsideTasks.map((t) => t.tasknumber || t.title).join(', ')}).`
      );
    }
  }

  const updates: repo.UpdateProjectRow = {
    title: input.title?.trim(),
    description: input.description?.trim(),
    targetDate: input.targetDate,
    startDate: input.startDate,
    creationReason: input.creationReason?.trim()
  };
  if (input.priority) updates.priorityId = await repo.getPriorityId(API_TO_DB_PRIORITY[input.priority]);
  // Ordinary lifecycle changes (such as activating a pending project) still use this update path.
  // Archive/restore are deliberately handled above by their transactional cascade endpoints.
  if (input.status) {
    if (input.status !== row.statuscode && input.status !== 'Pending Approval' && actorRole !== 'Admin') {
      throw new ProjectAuthorizationError('Only Admins can change a project\'s status.');
    }
    // Gate the transition INTO Completed only (not a no-op resubmission of an already-Completed
    // project) -- every status-change path funnels through here (a direct Admin update, and a
    // Team Lead's PROJECT_EDIT request once approved -- see projectApproval.service.ts), so this
    // is the single choke point a direct API call can't bypass. Scoping to the transition, rather
    // than every save, means editing an unrelated field on an already-Completed project never
    // fails just because a task was added or reopened afterward.
    if (input.status === 'Completed' && input.status !== row.statuscode) {
      const { total, completed } = await getProjectTaskCompletion(row.projectid);
      if (total === 0) {
        throw new ProjectValidationError('A project with no tasks cannot be marked as Completed.');
      }
      if (completed < total) {
        throw new ProjectValidationError('All tasks must be completed before this project can be marked as Completed.');
      }
    }
    updates.statusId = await repo.getProjectStatusId(API_TO_DB_PROJECT_STATUS[input.status as ApiProjectStatus]);
  }

  await repo.updateProject(row.projectid, updates);

  // TeamLead is a ProjectMembers role, not a projects-table column (see reassignTeamLead's
  // comment), so it's handled as its own step rather than through the updates object above.
  let previousLeadId: string | undefined;
  if (input.teamLeadId !== undefined) {
    await assertEligibleAssignee(input.teamLeadId, PROJECT_LEAD_ELIGIBLE_ROLES, 'Team Lead');
    previousLeadId = resolveTeamLeadUserId(row, await repo.findMembersForProject(row.projectid));
    await repo.reassignTeamLead(row.projectid, toUserPk(input.teamLeadId), row.owneruserid, toUserPk(actorId));
  }

  if (input.memberIds !== undefined) {
    const desiredIds = new Set(input.memberIds);
    const ownerId = fromUserPk(row.owneruserid);
    const activeAfterLeadChange = await repo.findMembersForProject(row.projectid);
    for (const member of activeAfterLeadChange) {
      const memberId = fromUserPk(member.userid);
      if (memberId === ownerId || memberId === effectiveLeadId || desiredIds.has(memberId)) continue;
      // Issue #6: route through removeMember() instead of repo.removeProjectMember() directly,
      // so a member dropped via an ordinary project-edit save gets the same active-task check /
      // Pending Removal flagging / notifications as the dedicated DELETE endpoint -- a direct
      // repo call here bypassed all of that. Each member is awaited and caught independently so
      // one failure (or one Pending Removal flag) doesn't stop the rest of this diff from
      // applying to the other members being edited in the same save.
      try {
        await removeMember(projectId, memberId, 'Removed during project update', actorId, actorRole);
      } catch (error) {
        console.error(`[project.service] Failed to remove member ${memberId} during project update.`, error);
      }
    }
    const remaining = await repo.findMembersForProject(row.projectid);
    const remainingIds = new Set(remaining.map((member) => fromUserPk(member.userid)));
    for (const memberId of desiredIds) {
      if (memberId === ownerId || memberId === effectiveLeadId || remainingIds.has(memberId)) continue;
      await repo.addProjectMember(row.projectid, toUserPk(memberId), 'Member', toUserPk(actorId));
    }
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

  // A member newly assigned as Team Lead through an edit (not project creation, see
  // createProject) hears about it distinctly from the generic "Project Updated" notice above.
  if (input.teamLeadId !== undefined && input.teamLeadId !== previousLeadId) {
    notificationService
      .publishEvent({
        type: 'project_member_added',
        title: 'Assigned as Team Lead',
        message: `${actorName} assigned you as the Team Lead of "${dto.title}".`,
        actorId,
        projectId: dto.id,
        recipientIds: [input.teamLeadId]
      })
      .catch((error) => console.error('[project.service] Failed to publish lead-assigned event.', error));
  }

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

export const activatePendingProject = async (
  projectId: string,
  actorRole: string
): Promise<void> => {
  if (actorRole !== 'Admin') throw new ProjectAuthorizationError('Only Admins can activate project proposals.');
  const projectPk = toProjectPk(projectId);
  const row = await repo.findProjectById(projectPk);
  if (!row) throw new ProjectNotFoundError('Project not found.');
  if (row.statuscode !== 'PendingActivation') {
    throw new ProjectValidationError('This project proposal is no longer pending activation.');
  }
  if (!await repo.activatePendingProject(projectPk)) {
    throw new ProjectValidationError('This project proposal is no longer pending activation.');
  }
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

// Step two of the two-step delete: only an already-Archived project may be hard-deleted, and only
// once. Every project-owned dependent (tasks/subtasks, task history, assignments, dependencies,
// comments, discussion threads, milestones, members, reviewer designations, files, and calendar
// events) is deleted transactionally by the repository before the project row itself; Notifications
// and AI activity are historical logs so they're detached (their Project/Task reference nulled)
// rather than deleted; audit.AuditEvents/AuditEventChanges are never touched. The 23503 catch below
// is a defensive fallback for any FK the repository's cleanup doesn't yet know about.
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
        'This project still has linked records that could not be automatically removed. Please contact support.'
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
  assertCanManageMembers(actorRole);

  await assertEligibleAssignee(
    memberUserId,
    roleCode === 'TeamLead' ? PROJECT_LEAD_ELIGIBLE_ROLES : PROJECT_MEMBER_ELIGIBLE_ROLES,
    roleCode === 'TeamLead' ? 'Team Lead' : 'a member'
  );

  await repo.addProjectMember(row.projectid, toUserPk(memberUserId), roleCode || 'Member', toUserPk(actorId));

  const members = await repo.findMembersForProject(row.projectid);
  const dto = await buildDTO(row, members);
  const actorName = actorDisplayName(actorId);

  // Only a member added specifically as the project's Team Lead reads "...as the Team Lead" —
  // every other member role (plain Member, Reviewer, Observer) gets the plain wording.
  const isLead = roleCode === 'TeamLead';
  notificationService
    .publishEvent({
      type: 'project_member_added',
      title: 'Added to Project',
      message: isLead
        ? `${actorName} added you to "${dto.title}" as the Team Lead.`
        : `${actorName} added you to "${dto.title}".`,
      actorId,
      projectId: dto.id,
      recipientIds: [memberUserId]
    })
    .catch((error) => console.error('[project.service] Failed to publish member-added event.', error));

  const addedMemberName = actorDisplayName(memberUserId);
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    affectedUserId: memberUserId, affectedUserName: addedMemberName,
    action: 'Assigned', module: 'Projects', entityType: 'User', entityId: memberUserId,
    entityName: addedMemberName, projectId: dto.id, projectName: dto.title,
    description: `${actorName} added ${addedMemberName} to “${dto.title}”.`,
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
  assertCanManageMembers(actorRole);
  const [currentMembers, currentTeamMembers] = await Promise.all([
    repo.findMembersForProject(row.projectid),
    repo.findTeamMembersForProject(row.projectid)
  ]);
  // isTeamLeadOfProject so removing any one of a multi-team project's several team leads is
  // blocked the same way removing the sole lead of a single-team project already was -- not just
  // whichever one resolveTeamLeadUserId happens to resolve first.
  if (isTeamLeadOfProject(row, currentMembers, currentTeamMembers, memberUserId)) {
    throw new ProjectValidationError(
      'The current Team Lead cannot be removed. Assign another Team Lead before removing this member.'
    );
  }

  const actorName = actorDisplayName(actorId);
  const memberPk = toUserPk(memberUserId);

  // Issue #6: never actually remove a member who still has active task/subtask work in this
  // project -- flag them Pending Removal instead, so that work keeps an owner until it's
  // reassigned or completed (see task.service.ts's completion hooks -> recheckPendingRemovalForMember
  // below). Checked here, not just in the frontend's own pre-check, so a direct API call can't
  // bypass it.
  const activeAssignments = await findActiveTaskAssignmentsForUserInProject(row.projectid, memberPk);
  if (activeAssignments.length > 0) {
    const flagged = await repo.flagMemberPendingRemoval(
      row.projectid,
      memberPk,
      toUserPk(actorId),
      `Has ${activeAssignments.length} active task/subtask assignment(s) remaining.`
    );
    if (!flagged) throw new ProjectValidationError('That user is not an active member of this project.');

    const members = await repo.findMembersForProject(row.projectid);
    const dto = await buildDTO(row, members);
    const memberName = actorDisplayName(memberUserId);

    notificationService
      .publishEvent({
        type: 'project_member_pending_removal',
        title: 'Member Pending Removal',
        message: `${actorName} tried to remove ${memberName} from "${dto.title}", but they still ` +
          `have ${activeAssignments.length} active task/subtask assignment(s). Reassign or complete their work to ` +
          'finish removing them.',
        actorId,
        projectId: dto.id,
        recipientIds: [resolveTeamLeadUserId(row, members)]
      })
      .catch((error) => console.error('[project.service] Failed to publish pending-removal event.', error));

    recordActivitySafe({
      actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
      affectedUserId: memberUserId, affectedUserName: memberName,
      action: 'Flagged', module: 'Projects', entityType: 'User', entityId: memberUserId,
      entityName: memberName, projectId: dto.id, projectName: dto.title,
      description: `${actorName} flagged ${memberName} for removal from “${dto.title}”, pending ` +
        `${activeAssignments.length} active task/subtask assignment(s).`,
      reason, linkRoute: 'projects', important: true
    });

    return dto;
  }

  const removed = await repo.removeProjectMember(
    row.projectid,
    memberPk,
    toUserPk(actorId),
    reason?.trim() || 'Removed from project'
  );
  if (!removed) throw new ProjectValidationError('That user is not an active member of this project.');

  const members = await repo.findMembersForProject(row.projectid);
  const dto = await buildDTO(row, members);

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

  const removedMemberName = actorDisplayName(memberUserId);
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    affectedUserId: memberUserId, affectedUserName: removedMemberName,
    action: 'Reassigned', module: 'Projects', entityType: 'User', entityId: memberUserId,
    entityName: removedMemberName, projectId: dto.id, projectName: dto.title,
    description: `${actorName} removed ${removedMemberName} from “${dto.title}”.`,
    reason, linkRoute: 'projects', important: true
  });

  return dto;
};

export const moveMember = async (
  projectId: string,
  memberUserId: string,
  toTeamId: string,
  actorId: string,
  actorRole: string
): Promise<ProjectDTO> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');
  assertCanManageMembers(actorRole);

  const targetTeam = await repo.findTeamById(toTeamPk(toTeamId));
  if (!targetTeam || targetTeam.projectid !== row.projectid) {
    throw new ProjectValidationError('Target team not found in this project.');
  }

  const moved = await repo.moveTeamMember(row.projectid, toUserPk(memberUserId), targetTeam.teamid, toUserPk(actorId));
  if (!moved) {
    throw new ProjectValidationError('That user is not currently in a team of this project.');
  }

  const members = await repo.findMembersForProject(row.projectid);
  const dto = await buildDTO(row, members);
  const actorName = actorDisplayName(actorId);
  const memberName = actorDisplayName(memberUserId);

  notificationService
    .publishEvent({
      type: 'team_member_moved',
      title: 'Moved to a New Team',
      message: `${actorName} moved you to team "${targetTeam.teamname}" in "${dto.title}".`,
      actorId,
      projectId: dto.id,
      recipientIds: [memberUserId]
    })
    .catch((error) => console.error('[project.service] Failed to publish member-moved event.', error));

  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    affectedUserId: memberUserId, affectedUserName: memberName,
    action: 'Reassigned', module: 'Projects', entityType: 'User', entityId: memberUserId,
    entityName: memberName, projectId: dto.id, projectName: dto.title,
    description: `${actorName} moved ${memberName} to team “${targetTeam.teamname}” in “${dto.title}”.`,
    linkRoute: 'projects', important: true
  });

  return dto;
};

export const replaceTeamLead = async (
  projectId: string,
  teamId: string,
  newLeadId: string,
  actorId: string,
  actorRole: string
): Promise<ProjectDTO> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');
  assertCanManageMembers(actorRole);

  const team = await repo.findTeamById(toTeamPk(teamId));
  if (!team || team.projectid !== row.projectid) {
    throw new ProjectValidationError('Team not found in this project.');
  }

  const teamMembers = await repo.findTeamMembersForTeam(team.teamid);
  const currentLead = teamMembers.find((m) => m.islead);
  if (!currentLead) throw new ProjectValidationError('This team has no Team Lead to replace.');
  if (fromUserPk(currentLead.userid) === newLeadId) {
    throw new ProjectValidationError('That user is already the Team Lead of this team.');
  }

  const projectMembers = await repo.findMembersForProject(row.projectid);
  if (!projectMembers.some((m) => fromUserPk(m.userid) === newLeadId)) {
    throw new ProjectValidationError('The new Team Lead must already be a member of this project.');
  }
  // Reject up front, before the repository attempts a write: if the replacement is already an
  // active member of a *different* team in this project, repo.replaceTeamLead would try to insert
  // a second work.TeamMembers row for the same (ProjectId, UserId), which collides with
  // UQ_TeamMembers_Project_User (the one-team-per-project invariant) and previously surfaced as a
  // raw Postgres 23505 unique-violation instead of a clean validation error.
  const projectTeamMembers = await repo.findTeamMembersForProject(row.projectid);
  const newLeadCurrentTeam = projectTeamMembers.find((m) => fromUserPk(m.userid) === newLeadId);
  if (newLeadCurrentTeam && newLeadCurrentTeam.teamid !== team.teamid) {
    throw new ProjectValidationError(
      'That person is already on a different team in this project. Move them to this team first, or choose someone else.'
    );
  }
  await assertEligibleAssignee(newLeadId, PROJECT_LEAD_ELIGIBLE_ROLES, 'Team Lead');

  await repo.replaceTeamLead(row.projectid, team.teamid, currentLead.userid, toUserPk(newLeadId), toUserPk(actorId));

  const members = await repo.findMembersForProject(row.projectid);
  const dto = await buildDTO(row, members);
  const actorName = actorDisplayName(actorId);
  const newLeadName = actorDisplayName(newLeadId);
  const oldLeadName = actorDisplayName(fromUserPk(currentLead.userid));

  notificationService
    .publishEvent({
      type: 'team_lead_changed',
      title: 'Team Lead Changed',
      message: `${actorName} made you the Team Lead of team "${team.teamname}" in "${dto.title}".`,
      recipientMessages: {
        [fromUserPk(currentLead.userid)]: `${actorName} replaced you as the Team Lead of team ` +
          `"${team.teamname}" in "${dto.title}".`
      },
      actorId,
      projectId: dto.id,
      recipientIds: [newLeadId, fromUserPk(currentLead.userid)]
    })
    .catch((error) => console.error('[project.service] Failed to publish team-lead-changed event.', error));

  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    affectedUserId: newLeadId, affectedUserName: newLeadName,
    action: 'Assigned', module: 'Projects', entityType: 'User', entityId: newLeadId,
    entityName: newLeadName, projectId: dto.id, projectName: dto.title,
    description: `${actorName} made ${newLeadName} the Team Lead of “${team.teamname}” in “${dto.title}”, ` +
      `replacing ${oldLeadName}.`,
    linkRoute: 'projects', important: true
  });

  return dto;
};

// Re-checks a single Pending-Removal member after one of their tasks/subtasks in this project
// reaches Done (see task.service.ts's changeTaskStatus/decideReview hooks) -- if they now have
// zero active assignments left in the project, finishes the removal that removeMember above
// deferred, notifying both the Admin who originally flagged them and the member themselves. A
// no-op if the member isn't currently flagged, or still has other active work. Deliberately keyed
// on a single (project, user) pair, not the whole completed task's assignee list, so a future
// "task/subtask reassigned" hook can call this exact same function once that feature exists --
// see task.repository.ts's findActiveTaskAssignmentsForUserInProject for the other half of this.
export const recheckPendingRemovalForMember = async (
  projectId: string,
  memberUserId: string,
  actorId: string
): Promise<void> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) return;
  const members = await repo.findMembersForProject(row.projectid);
  const memberPk = toUserPk(memberUserId);
  const member = members.find((m) => m.userid === memberPk);
  if (!member || member.pendingremovalatutc === null || member.pendingremovalbyuserid === null) return;

  const stillActive = await findActiveTaskAssignmentsForUserInProject(row.projectid, memberPk);
  if (stillActive.length > 0) return;

  const removed = await repo.removeProjectMember(
    row.projectid,
    memberPk,
    member.pendingremovalbyuserid,
    'Automatically removed -- all previously active work was reassigned or completed.'
  );
  if (!removed) return;

  const memberName = actorDisplayName(memberUserId);
  const flaggedByUserId = fromUserPk(member.pendingremovalbyuserid);

  notificationService
    .publishEvent({
      type: 'project_member_auto_removed',
      title: 'Member Removed',
      message: `${memberName} was automatically removed from "${row.projectname}" -- their ` +
        'previously active work is now reassigned or completed.',
      recipientMessages: { [memberUserId]: `You were removed from "${row.projectname}".` },
      actorId,
      projectId,
      recipientIds: [flaggedByUserId, memberUserId]
    })
    .catch((error) => console.error('[project.service] Failed to publish auto-removed event.', error));

  recordActivitySafe({
    actorId, actorName: actorDisplayName(actorId),
    affectedUserId: memberUserId, affectedUserName: memberName,
    action: 'Auto-Removed', module: 'Projects', entityType: 'User', entityId: memberUserId,
    entityName: memberName, projectId, projectName: row.projectname,
    description: `${memberName} was automatically removed from “${row.projectname}” after their ` +
      'previously active work was reassigned or completed.',
    linkRoute: 'projects', important: true
  });
};

const MILESTONE_TITLE_MAX_LENGTH = 150; // matches work.ProjectMilestones.MilestoneName varchar(150)

const assertMilestoneDatesWithinProject = (row: ProjectRow, dueDate: string) => {
  if (dueDate < row.startdate || dueDate > row.enddate) {
    throw new ProjectValidationError(
      `Milestone due date must fall between the project's start date (${row.startdate}) and end date (${row.enddate}).`
    );
  }
};

export const addMilestone = async (
  projectId: string,
  input: CreateMilestoneInput,
  actorId: string,
  actorRole: string
): Promise<MilestoneDTO> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');
  await assertCanManage(row, actorId, actorRole);

  if (!input.title?.trim()) throw new ProjectValidationError('Milestone title is required.');
  if (input.title.trim().length > MILESTONE_TITLE_MAX_LENGTH) {
    throw new ProjectValidationError(`Milestone title cannot exceed ${MILESTONE_TITLE_MAX_LENGTH} characters.`);
  }
  if (!input.dueDate) throw new ProjectValidationError('Milestone due date is required.');
  assertMilestoneDatesWithinProject(row, input.dueDate);

  let milestoneId: number;
  try {
    milestoneId = await repo.insertMilestone({
      projectId: row.projectid,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      dueDate: input.dueDate,
      createdByUserId: toUserPk(actorId)
    });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === '23505') {
      throw new ProjectValidationError('A milestone with this name already exists for this project.');
    }
    throw error;
  }

  const dto = rowToMilestoneDTO((await repo.findMilestoneById(milestoneId))!);
  const actorName = actorDisplayName(actorId);
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Created', module: 'Projects', entityType: 'Milestone', entityId: dto.id,
    entityName: dto.title, projectId, projectName: row.projectname,
    description: `${actorName} added milestone “${dto.title}” to “${row.projectname}”.`,
    linkRoute: 'projects'
  });

  return dto;
};

export const updateMilestone = async (
  projectId: string,
  milestoneId: string,
  input: UpdateMilestoneInput,
  actorId: string,
  actorRole: string
): Promise<MilestoneDTO> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');
  await assertCanManage(row, actorId, actorRole);

  const milestonePk = Number(milestoneId);
  if (!Number.isInteger(milestonePk)) throw new ProjectValidationError('Invalid milestone id.');

  if (input.title !== undefined) {
    if (!input.title.trim()) throw new ProjectValidationError('Milestone title cannot be empty.');
    if (input.title.trim().length > MILESTONE_TITLE_MAX_LENGTH) {
      throw new ProjectValidationError(`Milestone title cannot exceed ${MILESTONE_TITLE_MAX_LENGTH} characters.`);
    }
  }
  if (input.dueDate !== undefined) assertMilestoneDatesWithinProject(row, input.dueDate);

  let updated: boolean;
  try {
    updated = await repo.updateMilestone(milestonePk, row.projectid, {
      title: input.title?.trim(),
      description: input.description !== undefined ? (input.description.trim() || null) : undefined,
      dueDate: input.dueDate
    });
  } catch (error) {
    if ((error as { code?: string } | null)?.code === '23505') {
      throw new ProjectValidationError('A milestone with this name already exists for this project.');
    }
    throw error;
  }
  if (!updated) throw new ProjectValidationError('Milestone not found for this project.');

  const dto = rowToMilestoneDTO((await repo.findMilestoneById(milestonePk))!);
  const actorName = actorDisplayName(actorId);
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Updated', module: 'Projects', entityType: 'Milestone', entityId: dto.id,
    entityName: dto.title, projectId, projectName: row.projectname,
    description: `${actorName} updated milestone “${dto.title}” on “${row.projectname}”.`,
    linkRoute: 'projects'
  });

  return dto;
};

export const deleteMilestone = async (
  projectId: string,
  milestoneId: string,
  actorId: string,
  actorRole: string
): Promise<void> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');
  await assertCanManage(row, actorId, actorRole);

  const milestonePk = Number(milestoneId);
  if (!Number.isInteger(milestonePk)) throw new ProjectValidationError('Invalid milestone id.');

  const milestoneRow = await repo.findMilestoneById(milestonePk);
  const deleted = await repo.deleteMilestone(milestonePk, row.projectid);
  if (!deleted) throw new ProjectValidationError('Milestone not found for this project.');

  const actorName = actorDisplayName(actorId);
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Deleted', module: 'Projects', entityType: 'Milestone', entityId: milestoneId,
    entityName: milestoneRow?.milestonename || milestoneId, projectId, projectName: row.projectname,
    description: `${actorName} removed milestone “${milestoneRow?.milestonename || milestoneId}” from “${row.projectname}”.`,
    linkRoute: 'projects'
  });
};

export const addProjectFile = async (
  projectId: string,
  input: CreateProjectFileInput,
  actorId: string,
  actorRole: string
): Promise<ProjectFileDTO> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');
  await assertCanManage(row, actorId, actorRole);

  if (!input.name?.trim()) throw new ProjectValidationError('File name is required.');
  if (!input.url?.trim()) throw new ProjectValidationError('File content is required.');

  let fileId: number;
  try {
    fileId = await repo.insertProjectFile({
      projectId: row.projectid,
      uploadedByUserId: toUserPk(actorId),
      originalFileName: input.name.trim(),
      mimeType: input.mimeType?.trim() || 'application/octet-stream',
      dataUrl: input.url
    });
  } catch (error) {
    throw new ProjectValidationError((error as Error)?.message || 'Failed to store the attachment.');
  }

  const dto = rowToProjectFileDTO((await repo.findProjectFileById(row.projectid, fileId))!);
  const actorName = actorDisplayName(actorId);
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Created', module: 'Projects', entityType: 'ProjectFile', entityId: dto.id,
    entityName: dto.name, projectId, projectName: row.projectname,
    description: `${actorName} attached “${dto.name}” to “${row.projectname}”.`,
    linkRoute: 'projects'
  });

  return dto;
};

export interface ProjectFileDownload {
  originalFileName: string;
  mimeType: string;
  storageObjectKey: string;
}

// Read-only lookup for streaming/redirecting to a file's stored bytes — deliberately reuses
// isProjectAccessible (the same gate getProjectForUser already uses to decide whether a caller
// may see this project's files list at all) rather than assertCanManage, since opening/downloading
// an attachment isn't a "manage the project" action. This is why HR and any active project member
// (which already covers a Team Lead, per resolveTeamLeadUserId's membership-row/owner-fallback
// resolution) can download here even though only Admin/the project's lead can attach or remove one.
export const getProjectFileForDownload = async (
  projectId: string,
  fileId: string,
  actorId: string,
  actorRole: string
): Promise<ProjectFileDownload> => {
  if (!(await isProjectAccessible(projectId, actorId, actorRole))) {
    throw new ProjectAuthorizationError('You do not have access to this project.');
  }

  const filePk = Number(fileId);
  if (!Number.isInteger(filePk)) throw new ProjectValidationError('Invalid file id.');

  const row = await repo.findProjectFileById(toProjectPk(projectId), filePk);
  if (!row) throw new ProjectNotFoundError('Attachment not found for this project.');

  return {
    originalFileName: row.originalfilename,
    mimeType: row.mimetype,
    storageObjectKey: row.storageobjectkey
  };
};

export const removeProjectFile = async (
  projectId: string,
  fileId: string,
  actorId: string,
  actorRole: string
): Promise<void> => {
  const row = await repo.findProjectById(toProjectPk(projectId));
  if (!row) throw new ProjectNotFoundError('Project not found.');
  await assertCanManage(row, actorId, actorRole);

  const filePk = Number(fileId);
  if (!Number.isInteger(filePk)) throw new ProjectValidationError('Invalid file id.');

  const fileRow = await repo.findProjectFileById(row.projectid, filePk);
  const removed = await repo.removeProjectFile(row.projectid, filePk);
  if (!removed) throw new ProjectValidationError('File not found for this project.');

  const actorName = actorDisplayName(actorId);
  recordActivitySafe({
    actorId, actorName, actorEmail: userStore.findById(actorId)?.email, actorRole,
    action: 'Deleted', module: 'Projects', entityType: 'ProjectFile', entityId: fileId,
    entityName: fileRow?.originalfilename || fileId, projectId, projectName: row.projectname,
    description: `${actorName} removed attachment “${fileRow?.originalfilename || fileId}” from “${row.projectname}”.`,
    linkRoute: 'projects'
  });
};
