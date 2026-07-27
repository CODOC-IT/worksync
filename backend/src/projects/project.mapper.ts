import { fromProjectPk, fromUserPk } from '../utils/idMapping.js';
import { ProjectMemberRow, ProjectRow, DB_TO_API_PRIORITY, DB_TO_API_PROJECT_STATUS, ProjectDTO } from './project.types.js';

const formatDate = (value: string | Date): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

// `progress` has no column in work.Projects (schema wasn't redesigned to add one) — the service
// layer computes it from task completion ratios and passes it in here, same "derive, don't
// store" approach already used for other frontend-only display fields.
export const rowToProjectDTO = (
  row: ProjectRow,
  members: ProjectMemberRow[],
  progress: number
): ProjectDTO => {
  const teamLead = members.find((member) => member.memberrolecode === 'TeamLead');
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
    teamLeadId: teamLead ? fromUserPk(teamLead.userid) : fromUserPk(row.owneruserid),
    memberIds: members
      .filter((member) => member.memberrolecode === 'Member' || member.memberrolecode === 'Owner')
      .map((member) => fromUserPk(member.userid)),
    startDate: formatDate(row.startdate),
    targetDate: formatDate(row.enddate),
    priority: DB_TO_API_PRIORITY[row.prioritycode],
    progress,
    tags: [],
    creationReason: row.creationreason || undefined
  };
};
