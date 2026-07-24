import { Project, TaskStatus, UserRole } from '../../types';

// The four columns the Project Board renders. `Blocked` remains a valid Task.status value
// owned by the Task Creation module but is intentionally not surfaced on the board
// (see docs/BoardModuleGuide.md §8/§12).
export const BOARD_COLUMNS: TaskStatus[] = ['Todo', 'In Progress', 'Review', 'Done'];

// Admin: every project ("workspace"). Team Lead: only projects they lead, so they can
// switch between the ones they manage. Team Member: only projects they belong to.
export const getAccessibleProjects = (
  role: UserRole,
  userId: string,
  projects: Project[]
): Project[] => {
  if (role === 'Admin') return projects;
  if (role === 'Team_Lead') return projects.filter((project) => project.teamLeadId === userId);
  return projects.filter((project) => project.memberIds.includes(userId));
};

// Who may Approve/Reject a task sitting in Review with a Pending decision.
export const canDecideReview = (
  role: UserRole,
  userId: string,
  project: Project
): boolean =>
  role === 'Admin' || (role === 'Team_Lead' && project.teamLeadId === userId);
