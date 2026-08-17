import type { ProjectApprovalRequestType } from './projectApproval.types.js';

export interface ParticipantResolution {
  teamLeadId: string;
  memberIds: string[];
  error?: string;
}

// A single team as submitted during project creation / proposal. memberIds is the team's regular
// (non-lead) membership; the lead is separate. Together with the lead each team needs >= 2 people.
export interface TeamSetupInput {
  name: string;
  description: string;
  leadId: string;
  memberIds: string[];
}

export interface NormalizedTeam {
  name: string;
  description: string;
  leadId: string;
  memberIds: string[];
}

export interface TeamSetupValidation {
  teams: NormalizedTeam[];
  teamLeadUserIds: string[];
  memberUserIds: string[];
  error?: string;
}

// Validates a complete multi-team setup and flattens it into the ProjectMembers structure the
// rest of the pipeline expects (one 'TeamLead' membership per team lead, one 'Member' membership
// per non-lead member). Invariants, all enforced server-side:
//   * every team has a name, a description, exactly one lead, and >= 2 people total;
//   * team names are unique within the project (case-insensitive);
//   * no person appears in more than one team in the same project (one-team-per-project).
// An empty/undefined input is valid and signals the caller should keep the legacy single-lead
// path. On any violation the returned object carries error and empty arrays.
export const resolveTeamSetup = (teams: TeamSetupInput[] | undefined): TeamSetupValidation => {
  if (!teams || teams.length === 0) {
    return { teams: [], teamLeadUserIds: [], memberUserIds: [] };
  }

  const normalized: NormalizedTeam[] = [];
  const teamLeadUserIds: string[] = [];
  const memberUserIds: string[] = [];
  const seenNames = new Set<string>();
  const seenMembers = new Set<string>();

  const fail = (error: string): TeamSetupValidation =>
    ({ teams: [], teamLeadUserIds: [], memberUserIds: [], error });

  for (const team of teams) {
    const name = team.name?.trim();
    const description = team.description?.trim();
    if (!name) return fail('Every team must have a name.');
    if (!description) return fail(`Team "${name}" must have a description.`);
    if (seenNames.has(name.toLowerCase())) {
      return fail(`Duplicate team name "${name}". Team names must be unique within a project.`);
    }
    if (!team.leadId) return fail(`Team "${name}" must have a Team Lead.`);

    const members = Array.from(new Set([...team.memberIds, team.leadId]));
    if (members.length < 2) {
      return fail(`Team "${name}" must have at least one member besides its Team Lead.`);
    }
    for (const userId of members) {
      if (seenMembers.has(userId)) {
        return fail('A person cannot belong to more than one team in the same project.');
      }
      seenMembers.add(userId);
    }

    normalized.push({ name, description, leadId: team.leadId, memberIds: members });
    teamLeadUserIds.push(team.leadId);
    memberUserIds.push(...members);
    seenNames.add(name.toLowerCase());
  }

  return {
    teams: normalized,
    teamLeadUserIds: Array.from(new Set(teamLeadUserIds)),
    memberUserIds: Array.from(new Set(memberUserIds))
  };
};

export const resolveCreateParticipants = (
  actorId: string,
  actorRole: string,
  selectedTeamLeadId: string | undefined,
  selectedMemberIds: string[] = []
): ParticipantResolution => {
  if (actorRole !== 'Admin' && selectedTeamLeadId && selectedTeamLeadId !== actorId) {
    return {
      teamLeadId: actorId,
      memberIds: [],
      error: 'A project creator must be the Team Lead of their submitted project.'
    };
  }
  const teamLeadId = actorRole === 'Admin' ? selectedTeamLeadId || '' : actorId;
  if (!teamLeadId) {
    return { teamLeadId: '', memberIds: [], error: 'An Admin must choose a Team Lead.' };
  }
  const memberIds = Array.from(new Set([...selectedMemberIds, teamLeadId]));
  // A Team Lead is an existing project member designated as lead, not a separate entity -- so
  // "at least 1 Team Lead and at least 1 regular member" means memberIds must contain someone
  // other than the lead, not merely be non-empty (a lead-only memberIds list already satisfies
  // "non-empty" on its own).
  if (memberIds.length < 2) {
    return { teamLeadId, memberIds: [], error: 'A project must have at least one member besides the Team Lead.' };
  }
  return { teamLeadId, memberIds };
};

export const resolveUpdatedParticipants = (
  currentTeamLeadId: string,
  proposedTeamLeadId: string | undefined,
  proposedMemberIds: string[] | undefined
): { teamLeadId: string; memberIds?: string[]; error?: string } => {
  const teamLeadId = proposedTeamLeadId ?? currentTeamLeadId;
  if (proposedMemberIds === undefined) return { teamLeadId };
  if (!proposedMemberIds.includes(currentTeamLeadId) && teamLeadId === currentTeamLeadId) {
    return {
      teamLeadId,
      error: 'The current Team Lead cannot be removed from project members without assigning a replacement lead.'
    };
  }
  const memberIds = Array.from(new Set([...proposedMemberIds, teamLeadId]));
  // Same "lead alone isn't enough" rule as resolveCreateParticipants -- memberIds always includes
  // the lead by this point, so length < 2 means every other member was edited out.
  if (memberIds.length < 2) {
    return { teamLeadId, error: 'A project must have at least one member besides the Team Lead.' };
  }
  return { teamLeadId, memberIds };
};

export const validateProjectDecision = (
  decision: 'Approved' | 'Rejected',
  reason: string | null | undefined
): string | null =>
  decision === 'Rejected' && !reason?.trim() ? 'A rejection reason is required.' : null;

export const buildProjectDecisionMessage = (
  reviewerName: string,
  decision: 'Approved' | 'Rejected',
  actionLabel: string,
  projectName: string,
  reason?: string | null
): string =>
  `${reviewerName} ${decision === 'Approved' ? 'approved' : 'rejected'} your request to ` +
  `${actionLabel} "${projectName}".` +
  (decision === 'Rejected' ? ` Reason: ${reason?.trim() || ''}` : '');

export const projectDecisionEffect = (
  requestType: ProjectApprovalRequestType,
  decision: 'Approved' | 'Rejected'
): 'apply-proposed-edit' | 'discard-proposed-edit' | 'remove-rejected-creation' | 'execute-action' | 'none' => {
  if (decision === 'Rejected') {
    if (requestType === 'PROJECT_CREATE') return 'remove-rejected-creation';
    if (requestType === 'PROJECT_EDIT') return 'discard-proposed-edit';
    return 'none';
  }
  if (requestType === 'PROJECT_EDIT') return 'apply-proposed-edit';
  return 'execute-action';
};
