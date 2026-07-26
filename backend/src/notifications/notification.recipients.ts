import { projectStore } from '../store/projectStore.js';
import { userStore } from '../store/userStore.js';

// Recipient resolution (RBAC) — the backend mirror of
// frontend/src/features/notifications/notificationService.ts's resolveTaskRecipients/
// resolveProjectRecipients/resolveAdminRecipients/resolveSingleRecipient. Built on the
// existing projectStore/userStore (backend/src/store/) rather than querying the new
// work.Projects/iam.Users Postgres tables directly — those Postgres rows exist purely as FK
// targets for notify.* (see database/18_notify_seed.sql), not as this backend's live source of
// truth for who's on what project; projectStore/userStore already are that source of truth for
// every other backend route (see assistantRoutes.ts).
//
// Every id here stays in the frontend's `usr-<n>`/`prj-<n>` string form — the notification
// repository is the only place that converts to integer primary keys.

const without = (ids: (string | null | undefined)[], excludeUserId?: string): string[] =>
  Array.from(new Set(ids.filter((id): id is string => Boolean(id) && id !== excludeUserId)));

export const resolveAdminRecipients = (excludeUserId?: string): string[] =>
  without(
    userStore.getAllUsers().filter((user) => user.role === 'Admin').map((user) => user.id),
    excludeUserId
  );

export const resolveProjectRecipients = (projectId: string, excludeUserId?: string): string[] => {
  const project = projectStore.getProjectById(projectId);
  if (!project) return [];
  return without([project.ownerUserId, ...project.memberIds], excludeUserId);
};

export const resolveTaskRecipients = (taskId: string, excludeUserId?: string): string[] => {
  const task = projectStore.getTaskById(taskId);
  if (!task) return [];
  const project = projectStore.getProjectById(task.projectId);
  return without([task.assigneeId, project?.ownerUserId], excludeUserId);
};

export const resolveSingleRecipient = (userId?: string | null, excludeUserId?: string): string[] =>
  without([userId], excludeUserId);
