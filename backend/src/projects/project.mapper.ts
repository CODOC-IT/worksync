import { fromProjectPk, fromUserPk } from '../utils/idMapping.js';
import { ProjectMemberRow, ProjectRow, DB_TO_API_PRIORITY, DB_TO_API_PROJECT_STATUS, ProjectDTO } from './project.types.js';

const formatDate = (value: string | Date): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

// The project's functional lead: whoever has the explicit 'TeamLead' membership row, or — when
// nobody does, which is the common case for a project a Team Lead created for themselves (see
// project.repository.ts's insertProject: the creator only gets an 'Owner' row when they're also
// the team lead, never a redundant second 'TeamLead' row) — the project's Owner. This is the
// single source of truth for "who leads this project"; both the DTO (display) and
// project.service.ts's isProjectLead/assertCanManage (authorization) must agree on it, or a
// self-led project's own creator ends up locked out of managing it despite the UI correctly
// showing them as the lead.
export const resolveTeamLeadUserId = (row: ProjectRow, members: ProjectMemberRow[]): string => {
  const teamLead = members.find((member) => member.memberrolecode === 'TeamLead');
  return teamLead ? fromUserPk(teamLead.userid) : fromUserPk(row.owneruserid);
};

// `progress` has no column in work.Projects (schema wasn't redesigned to add one) — the service
// layer computes it from task completion ratios and passes it in here, same "derive, don't
// store" approach already used for other frontend-only display fields.
export const rowToProjectDTO = (
  row: ProjectRow,
  members: ProjectMemberRow[],
  progress: number
): ProjectDTO => {
  const isPendingActivation = row.statuscode === 'PendingActivation';

  return {
    id: fromProjectPk(row.projectid),
    code: row.projectcode,
    title: row.projectname,
    description: row.description,
    status: DB_TO_API_PROJECT_STATUS[row.statuscode],
    // No 'Rejected' state exists in work.ProjectStatuses (schema wasn't redesigned to add one)
    // — rejecting a pending project archives it instead (see project.service.ts), so from the
    // frontend's perspective a rejected project simply becomes 'Archived' with an ArchiveReason
    // explaining why, rather than a distinct approvalStatus value ever being persisted.
    approvalStatus: isPendingActivation ? 'Pending Approval' : 'Approved',
    createdBy: fromUserPk(row.createdbyuserid),
    teamLeadId: resolveTeamLeadUserId(row, members),
    // Includes 'TeamLead' now too (not just 'Member'/'Owner') -- a separately-assigned Team Lead
    // (e.g. an Admin-created project where the lead isn't the Owner) must be assignable to the
    // project's own tasks just like an Owner-who-is-also-lead already was.
    memberIds: members
      .filter((member) =>
        member.memberrolecode === 'Member'
        || member.memberrolecode === 'Owner'
        || member.memberrolecode === 'TeamLead'
      )
      .map((member) => fromUserPk(member.userid)),
    startDate: formatDate(row.startdate),
    targetDate: formatDate(row.enddate),
    priority: DB_TO_API_PRIORITY[row.prioritycode],
    progress,
    tags: [],
    creationReason: row.creationreason || undefined
  };
};
