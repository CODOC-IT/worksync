import { fromProjectPk, fromTeamPk, fromUserPk } from '../utils/idMapping.js';
import {
  MilestoneDTO,
  MilestoneRow,
  ProjectFileDTO,
  ProjectFileRow,
  ProjectMemberRow,
  ProjectRow,
  ProjectTeamRow,
  TeamDTO,
  TeamMemberRow,
  DB_TO_API_PRIORITY,
  DB_TO_API_PROJECT_STATUS,
  ProjectDTO
} from './project.types.js';

const formatDate = (value: string | Date): string =>
  typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);

// The project's functional lead: whoever has the explicit 'TeamLead' membership row, or — when
// nobody does, which is the common case for a project a Team Lead created for themselves (see
// project.repository.ts's insertProject: the creator only gets an 'Owner' row when they're also
// the team lead, never a redundant second 'TeamLead' row) — the project's Owner. This is a single
// *representative* lead for display purposes (the DTO's `teamLeadId`, "who to notify" defaults,
// etc.) — a multi-team project can have several people holding a 'TeamLead' row, and this only
// ever returns the first one found. Do NOT use this for an authorization decision ("is this
// person allowed to...") — use isTeamLeadOfProject below for that, which recognizes every one of
// them, not just the first.
export const resolveTeamLeadUserId = (row: ProjectRow, members: ProjectMemberRow[]): string => {
  const teamLead = members.find((member) => member.memberrolecode === 'TeamLead');
  return teamLead ? fromUserPk(teamLead.userid) : fromUserPk(row.owneruserid);
};

// Whether `userId` is recognized as *a* Team Lead of this project.
//
// For a multi-team project (teamMembers non-empty), work.TeamMembers.IsLead is the authoritative
// source, not ProjectMembers.MemberRoleCode='TeamLead' -- project.repository.ts's insertProject/
// insertTeam deliberately never writes a redundant 'TeamLead' ProjectMembers row for a team lead
// who is also the project's Owner (they already have an 'Owner' row), so a project where the
// Owner leads one team and someone else leads another only has ONE explicit 'TeamLead'
// ProjectMembers row even though there are two real team leads. Reading IsLead directly avoids
// that gap and correctly recognizes every team's lead, including an Owner who leads a team.
//
// For a single-lead/legacy/no-team project (teamMembers empty), this falls back to the original
// ProjectMembers-only rule -- resolveTeamLeadUserId's exact logic, generalized from "the first
// 'TeamLead' row" to "any 'TeamLead' row" (a no-op for 0 or 1 such rows, which is every legacy
// project), so existing single-lead behavior is unchanged.
export const isTeamLeadOfProject = (
  row: ProjectRow,
  members: ProjectMemberRow[],
  teamMembers: TeamMemberRow[],
  userId: string
): boolean => {
  if (teamMembers.length > 0) {
    const activeProjectMemberIds = new Set(members.map((member) => member.userid));
    return teamMembers.some((member) =>
      member.islead
      && activeProjectMemberIds.has(member.userid)
      && fromUserPk(member.userid) === userId
    );
  }
  const teamLeads = members.filter((member) => member.memberrolecode === 'TeamLead');
  if (teamLeads.length === 0) return fromUserPk(row.owneruserid) === userId;
  return teamLeads.some((member) => fromUserPk(member.userid) === userId);
};

// Shared by rowToProjectDTO below (list/detail fetches) and project.service.ts's
// addMilestone/updateMilestone (which return the single row they just wrote) -- one mapping,
// not two copies that could drift.
export const rowToMilestoneDTO = (m: MilestoneRow): MilestoneDTO => ({
  id: String(m.milestoneid),
  title: m.milestonename,
  description: m.description,
  dueDate: m.duedate.slice(0, 10),
  completed: m.completedatutc !== null,
  completedAt: m.completedatutc ? m.completedatutc.toISOString() : null,
  createdBy: fromUserPk(m.createdbyuserid),
  createdAt: m.createdatutc.toISOString()
});

// Shared by rowToProjectDTO below and project.service.ts's addProjectFile (which returns the
// single row it just wrote) -- one mapping, not two copies that could drift.
export const rowToProjectFileDTO = (f: ProjectFileRow): ProjectFileDTO => ({
  id: String(f.fileid),
  name: f.originalfilename,
  size: Number(f.sizebytes),
  mimeType: f.mimetype,
  uploadedBy: fromUserPk(f.uploadedbyuserid),
  uploadedAt: f.uploadedatutc.toISOString()
});

// `progress` has no column in work.Projects (schema wasn't redesigned to add one) — the service
// layer computes it from task completion ratios and passes it in here, same "derive, don't
// store" approach already used for other frontend-only display fields.
export const rowToProjectDTO = (
  row: ProjectRow,
  members: ProjectMemberRow[],
  progress: number,
  milestones?: MilestoneRow[],
  files?: ProjectFileRow[],
  teams?: ProjectTeamRow[],
  teamMembers?: TeamMemberRow[]
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
    pendingRemovalMemberIds: members
      .filter((member) => member.pendingremovalatutc !== null)
      .map((member) => fromUserPk(member.userid)),
    teams: teams && teamMembers ? buildTeamDTOs(teams, teamMembers) : [],
    startDate: formatDate(row.startdate),
    targetDate: formatDate(row.enddate),
    priority: DB_TO_API_PRIORITY[row.prioritycode],
    progress,
    tags: [],
    creationReason: row.creationreason || undefined,
    createdAt: formatDate(row.createdatutc),
    milestones: (milestones || []).map(rowToMilestoneDTO),
    files: (files || []).map(rowToProjectFileDTO)
  };
};

// Groups the active team-member rows under their teams into a TeamDTO list. Only members with a
// matching team row (and whose ProjectMembers row is still active) are included; an orphaned
// TeamMembers row is skipped rather than crashing the map.
export const buildTeamDTOs = (teams: ProjectTeamRow[], teamMembers: TeamMemberRow[]): TeamDTO[] => {
  const memberUserIds = new Set(teamMembers.map((m) => m.userid));
  return teams.map((team) => {
    const members = teamMembers
      .filter((m) => m.teamid === team.teamid && memberUserIds.has(m.userid))
      .sort((a, b) => (a.islead === b.islead ? a.userid - b.userid : a.islead ? -1 : 1));
    const lead = members.find((m) => m.islead);
    return {
      id: fromTeamPk(team.teamid),
      projectId: fromProjectPk(team.projectid),
      name: team.teamname,
      description: team.description,
      leadId: lead ? fromUserPk(lead.userid) : '',
      memberIds: members.map((m) => fromUserPk(m.userid))
    };
  });
};
