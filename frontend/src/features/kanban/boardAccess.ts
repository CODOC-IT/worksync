import { Project, TaskStatus, UserRole } from '../../types';
import { isActiveProject } from '../tasks/taskRules';

// The four columns the Project Board renders. `Blocked` remains a valid Task.status value
// owned by the Task Creation module but is intentionally not surfaced on the board
// (see docs/BoardModuleGuide.md §8/§12).
export const BOARD_COLUMNS: TaskStatus[] = ['Todo', 'In Progress', 'Review', 'Done'];

// Admin: every project ("workspace"). HR: every project too, but strictly read-only — every
// mutating helper below (canDecideReview/canReopenTask) and taskRules.ts's canEditTask
// independently return false for HR, and the backend rejects HR on every write path
// (assertCanEditTask/assertCanChangeTaskStatus/assertCanDeleteTask/isProjectLead), so widening
// visibility here cannot widen what HR may change. Without this HR fell through to the
// membership filter below and — never being a project member — saw an empty board.
// Team Lead: only projects they lead. Team Member: only projects they belong to.
//
// Only *active* projects reach the board. This reuses taskRules.ts's `isActiveProject`
// (`status === 'Active' && approvalStatus === 'Approved'`) rather than re-deriving the rule
// here, so the board agrees with every other surface that already gates on it — most relevantly
// `canCreateTaskForProject`, which refuses to create work in a non-active project, and the
// backend's own `createTask`, which rejects any project whose `StatusCode` is not `Active`.
// The previous `status !== 'Archived'` filter was strictly wider than that and let projects
// still awaiting approval (`Pending Approval` / `Draft`), paused (`On Hold`) and closed
// (`Completed`) ones onto the board and into the project selector, where they could never
// legitimately hold movable work.
export const getAccessibleProjects = (
  role: UserRole,
  userId: string,
  projects: Project[]
): Project[] => {
  const activeProjects = projects.filter(isActiveProject);
  if (role === 'Admin' || role === 'HR') return activeProjects;
  if (role === 'Team_Lead') return activeProjects.filter((project) => project.teamLeadId === userId);
  return activeProjects.filter((project) => project.memberIds.includes(userId));
};

// Who may Approve/Reject a task sitting in Review with a Pending decision. Deliberately no Admin
// bypass: only this specific project's Team Lead (a per-project membership, not an account role —
// see project.teamLeadId) may decide a review. Matches canReopenTask's rule below and the
// server-authoritative check in backend/src/tasks/task.service.ts's decideReview
// (isProjectLead(..., { allowAdmin: false })), which is what actually enforces this.
export const canDecideReview = (
  role: UserRole,
  userId: string,
  project: Project
): boolean => role !== 'HR' && project.teamLeadId === userId;

// Who may reopen a Done task. Deliberately stricter than canDecideReview: an Admin can approve
// a review but may NOT reopen a completed task — reversing a delivered outcome belongs to the
// Team Lead who owns that project. Mirrors the same rule the backend enforces independently in
// task.service.ts's reopenTask, which is the authoritative check (this one is UX only).
export const canReopenTask = (
  role: UserRole,
  userId: string,
  project: Project
): boolean => role !== 'HR' && project.teamLeadId === userId;

// Where a reopened task may land. Never 'Done' (that's where it is) and never 'Blocked'
// (Task Module territory) — matches REOPEN_TARGETS in backend/src/tasks/task.service.ts.
export const REOPEN_TARGETS: TaskStatus[] = ['Review', 'In Progress', 'Todo'];

export interface DueDateIndicator {
  label: string;
  className: string;
}

// Dynamic due-date pill for a board card: Overdue / Due Today / Due Tomorrow / N Days Left.
// Returns null once a task is Done, since a completed task has no "days left" to show.
export const getDueDateIndicator = (
  dueDate: string,
  todayIso: string,
  isDone: boolean
): DueDateIndicator | null => {
  if (isDone) return null;

  const due = new Date(`${dueDate}T00:00:00`);
  const today = new Date(`${todayIso}T00:00:00`);
  if (Number.isNaN(due.getTime())) return null;

  const diffDays = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { label: 'Overdue', className: 'border-rose-500/30 bg-rose-500/10 text-rose-300' };
  }
  if (diffDays === 0) {
    return { label: 'Due Today', className: 'border-amber-500/30 bg-amber-500/10 text-amber-300' };
  }
  if (diffDays === 1) {
    return { label: 'Due Tomorrow', className: 'border-amber-400/30 bg-amber-400/10 text-amber-200' };
  }
  return { label: `${diffDays} Days Left`, className: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300' };
};
