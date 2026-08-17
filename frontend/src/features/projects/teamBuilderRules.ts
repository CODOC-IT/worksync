// An in-progress team row in the team builder (create form / Admin's Change Setup editor) before
// it's sent to the backend.
export interface DraftTeam {
  id: string;
  name: string;
  description: string;
  leadId: string;
  memberIds: string[];
}

// Validates a draft team-builder setup the same way
// backend/src/projects/projectWorkflow.rules.ts's resolveTeamSetup does server-side: every team
// needs a name, a description, exactly one lead, and >= 2 people; team names are unique
// (case-insensitive); nobody may appear in more than one team. Shared by ProjectsView.tsx's
// create form and ApprovalsInboxView.tsx's Change Setup team editor so the two can't drift on
// what counts as a valid setup. Returns the first violation found, or null when valid.
export const validateTeamSetup = (teams: DraftTeam[]): string | null => {
  if (teams.length === 0) return 'Add at least one team.';

  const teamNames = new Set<string>();
  const seenMembers = new Set<string>();
  for (const team of teams) {
    if (!team.name.trim()) return 'Every team must have a name.';
    if (teamNames.has(team.name.trim().toLowerCase())) {
      return `Duplicate team name "${team.name.trim()}". Team names must be unique.`;
    }
    teamNames.add(team.name.trim().toLowerCase());

    if (!team.description.trim()) return `Team "${team.name.trim()}" needs a description.`;
    if (!team.leadId) return `Team "${team.name.trim()}" needs a Team Lead.`;

    const members = Array.from(new Set([...team.memberIds, team.leadId]));
    if (members.length < 2) {
      return `Team "${team.name.trim()}" needs at least one member besides its Team Lead.`;
    }
    for (const userId of members) {
      if (seenMembers.has(userId)) return 'A person cannot be in more than one team in the same project.';
      seenMembers.add(userId);
    }
  }
  return null;
};
