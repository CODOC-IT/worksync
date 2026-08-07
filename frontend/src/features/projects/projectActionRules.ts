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
