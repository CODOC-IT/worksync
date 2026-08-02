import * as repo from './project.repository.js';
import { resolveTeamLeadUserId, rowToMilestoneDTO, rowToProjectDTO, rowToProjectFileDTO } from './project.mapper.js';
import { fromUserPk, toProjectPk, toUserPk } from '../utils/idMapping.js';
import { actorDisplayName } from '../utils/actorDisplay.js';
import { userStore } from '../store/userStore.js';
import * as notificationService from '../notifications/notification.service.js';
import { recordActivitySafe } from '../activity/activity.service.js';
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
  milestones: MilestoneRow[] = []
): Promise<ProjectDTO> => {
  const progress = await repo.getProjectProgress(row.projectid);
  return rowToProjectDTO(row, members, progress, milestones);
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
  // Every role sees every project -- read-only visibility only; nothing else in this file
  // (assertCanCreate/assertCanManage) grants HR or a non-lead Team_Member any write/manage
  // capability, so this alone can't let anyone do more than view. Team Lead is not a separate
  // account role here (see isProjectLead/resolveTeamLeadUserId): whether a Team_Member happens to
  // lead any given project only changes how the frontend categorizes/labels it for display
  // (Led/Assigned/Unassigned in ProjectsView.tsx), never whether it's returned here.
  const rows = await repo.findAllProjects();
  if (rows.length === 0) return [];
  const projectIds = rows.map((row) => row.projectid);
  const [membersByProject, milestonesByProject] = await Promise.all([
    repo.findMembersForProjects(projectIds),
    repo.findMilestonesForProjects(projectIds)
  ]);
  return Promise.all(
    rows.map((row) =>
      buildDTO(
        row,
        membersByProject.filter((member) => member.projectid === row.projectid),
        milestonesByProject.filter((milestone) => milestone.projectid === row.projectid)
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

  if (input.teamLeadId) {
    await assertEligibleAssignee(input.teamLeadId, PROJECT_LEAD_ELIGIBLE_ROLES, 'Team Lead');
  }
  for (const memberId of input.memberIds || []) {
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
    memberUserIds: memberPks,
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

  // The project's Team Lead reads a distinct "...as the Project Lead" message; every other
  // recipient gets the plain "added you to it" wording — never the reverse (see
  // docs/Notification_Module_Guide.md's Project Lead assignment section). `recipientMessages`
  // is per-recipient, so this is one publishEvent call, not two.
  const leadFrontendId = teamLeadPk ? fromUserPk(teamLeadPk) : undefined;

  if (statusCode === 'Active') {
    notifyRecipients(members, actorId, {
      type: 'project_created',
      title: 'Project Created',
      message: `${actorName} created "${dto.title}" and added you to it.`,
      recipientMessages: leadFrontendId
        ? { [leadFrontendId]: `${actorName} created "${dto.title}" and added you to it as the Project Lead.` }
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
            [leadFrontendId]: `${actorName} created "${dto.title}" and added you to it as the Project Lead ` +
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
  let previousLeadId: string | undefined;
  if (input.teamLeadId !== undefined) {
    await assertEligibleAssignee(input.teamLeadId, PROJECT_LEAD_ELIGIBLE_ROLES, 'Team Lead');
    previousLeadId = resolveTeamLeadUserId(row, await repo.findMembersForProject(row.projectid));
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

  // A member newly assigned as Team Lead through an edit (not project creation, see
  // createProject) hears about it distinctly from the generic "Project Updated" notice above.
  if (input.teamLeadId !== undefined && input.teamLeadId !== previousLeadId) {
    notificationService
      .publishEvent({
        type: 'project_member_added',
        title: 'Assigned as Project Lead',
        message: `${actorName} assigned you as the Project Lead of "${dto.title}".`,
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
  await assertCanManage(row, actorId, actorRole);

  await assertEligibleAssignee(
    memberUserId,
    roleCode === 'TeamLead' ? PROJECT_LEAD_ELIGIBLE_ROLES : PROJECT_MEMBER_ELIGIBLE_ROLES,
    roleCode === 'TeamLead' ? 'Team Lead' : 'a member'
  );

  await repo.addProjectMember(row.projectid, toUserPk(memberUserId), roleCode || 'Member', toUserPk(actorId));

  const members = await repo.findMembersForProject(row.projectid);
  const dto = await buildDTO(row, members);
  const actorName = actorDisplayName(actorId);

  // Only a member added specifically as the project's Team Lead reads "...as the Project Lead" —
  // every other member role (plain Member, Reviewer, Observer) gets the plain wording.
  const isLead = roleCode === 'TeamLead';
  notificationService
    .publishEvent({
      type: 'project_member_added',
      title: 'Added to Project',
      message: isLead
        ? `${actorName} added you to "${dto.title}" as the Project Lead.`
        : `${actorName} added you to "${dto.title}".`,
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
