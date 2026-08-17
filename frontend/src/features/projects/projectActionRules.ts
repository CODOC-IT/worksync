import type { Project, UserRole } from '../../types';

export type ProjectCardAction = 'edit' | 'archive' | 'restore' | 'permanent-delete';

export const isCurrentProjectLead = (project: Project, userId: string): boolean =>
  Boolean(userId) && project.teamLeadId === userId;

export const projectCardActions = (
  role: UserRole,
  userId: string,
  project: Project
): ProjectCardAction[] => {
  const isAdmin = role === 'Admin';
  const isLead = (role === 'Team_Lead' || role === 'Team_Member') && isCurrentProjectLead(project, userId);
  if (!isAdmin && !isLead) return [];

  return project.status === 'Archived'
    ? ['edit', 'restore', 'permanent-delete']
    : ['edit', 'archive'];
};

// Who may create/propose a project at all -- mirrors backend/src/projects/project.service.ts's
// assertCanCreate exactly. ProjectsView.tsx's multi-team builder (create mode) is available to
// this same set of roles, not just Admin: the backend already accepts a complete multi-team
// proposal from a Team Lead/Team Member, it only additionally requires the submitter lead one of
// the proposed teams (validated in ProjectsView.tsx's own validate()).
export const canCreateProject = (role: UserRole): boolean =>
  role === 'Admin' || role === 'Team_Lead' || role === 'Team_Member';

// Admin-only: moving a project member between teams, or replacing a team's Team Lead
// (backend/src/projects/project.service.ts's assertCanManageMembers rejects any other role for
// both actions, deliberately stricter than isCurrentProjectLead's "Admin or this project's own
// lead" rule above -- a Team Lead is an existing member designated as lead, not a separate
// manager of other members/teams).
export const canManageProjectTeams = (role: UserRole): boolean => role === 'Admin';
