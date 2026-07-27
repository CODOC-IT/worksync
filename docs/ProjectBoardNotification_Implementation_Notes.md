# Project Module / Project Board / Notification — Production Backend Implementation Notes

Working notes for the `feature/backend-project-board-notification` branch. Read this before
re-analyzing the repo — it captures what was already true as of branch start plus what this
branch changes. Companion docs: `docs/ProjectAnalysis.md` (general architecture, now partly
stale — see "Known drift" below), `docs/BoardModuleGuide.md`, `docs/Notification_Module_Guide.md`
(Notification Module backend — already production-complete, merged via PR #70).

## Starting state (branched from `main` @ 9745fbc, which includes PR #70)

- **Notification Module backend**: already fully implemented and merged (`backend/src/notifications/*`,
  REST API at `/api/notifications`, real Postgres persistence, email digest, snooze, analytics).
  Nothing to redo here — this branch's Notification work is *wiring new publishers* (Project/Task
  events), not rebuilding the module.
- **Task API**: `backend/src/routes/taskRoutes.ts` + `backend/src/store/taskStore.ts` exist (merged
  from another branch) but `taskStore.ts` is **file-based** (JSON on disk via `fs`), not Postgres.
  Only `GET /api/tasks` and `POST /api/tasks` exist — no update/delete/status-change/history/
  approve/reject. This violates "Postgres is the single source of truth" and must be migrated,
  not just extended.
- **Project API**: does not exist. No `/api/projects` route mounted anywhere. `projectStore.ts`
  is read-only in-memory (seeded from hardcoded data), used only for authorization checks by
  `taskRoutes.ts`/`assistantRoutes.ts`. No project CRUD backend at all.
- **Kanban board / Project Board UI**: 100% frontend `AppContext` state (`projects`, `tasks`
  arrays), matches `docs/BoardModuleGuide.md`'s description exactly — nothing persists across
  refresh.
- **Database**: local PostgreSQL 18 (installed via Chocolatey on this dev machine), `worksync`
  database, full 70-table schema applied (`database/setup.sql`). The user's own Supabase project
  isn't available yet (teammate who owns it is offline) — `DATABASE_URL` points at local Postgres
  for now. Swapping to the real Supabase connection string later is purely an env var change
  (same schema, same driver, `pg` doesn't care which Postgres it's talking to).

## Schema mapping (already exists, DO NOT modify — see `database/04_work_tables.sql`)

| Concept | Table | Notes |
|---|---|---|
| Project | `work.Projects` | `ProjectStatusId`/`PriorityId` are FKs to lookup tables (`work.ProjectStatuses`/`work.Priorities`), not free-text. `RowVersion` column exists for optimistic concurrency. Archive is soft-delete shaped (`ArchivedAtUtc`/`ArchivedByUserId`/`ArchiveReason`, enforced by `CK_Projects_Archive`). |
| Project membership | `work.ProjectMembers` | `MemberRoleCode IN ('Owner','TeamLead','Member','Reviewer','Observer')`. Soft-remove shaped (`LeftAtUtc`/`RemovedByUserId`/`RemovalReason`). A project's "Team Lead" for authorization purposes = the member row with `MemberRoleCode = 'TeamLead'` and `LeftAtUtc IS NULL`. |
| Task | `work.Tasks` | `TaskStatusId`/`PriorityId` FK to lookups. `TaskNumber` unique per project (`UQ_Tasks_Project_Number`) — this is the frontend's `taskNumber` field. `RowVersion` for optimistic concurrency. Completion requires `CompletionSummary` (`CK_Tasks_Completion`). |
| Task assignees | `work.TaskAssignees` | Many-to-many, soft-unassign shaped. |
| Task status history | `work.TaskStatusHistory` | Exactly matches the frontend's `TaskStatusHistoryEntry` — `FromTaskStatusId`/`ToTaskStatusId`/`ChangedByUserId`/`ProgressNote`/`ChangedAtUtc`. This is the audit trail the Kanban board's mandatory-reason modal writes to. |
| Task blockers | `work.TaskBlockers` | Exists but out of scope unless the board surfaces `Blocked` (currently doesn't, per BoardModuleGuide §8/§12). |
| Lookups | `work.ProjectStatuses`, `work.TaskStatuses`, `work.Priorities` | Seeded in `17_seed.sql`. `TaskStatuses.RequiresReview` flag already models the Review gate. |

**Id convention**: reuse `backend/src/notifications/idMapping.ts`'s exact pattern
(`usr-<id>`/`prj-<id>`/`tsk-<id>` prefix ↔ integer PK) — this branch adds `toProjectPk`/
`fromProjectPk`/`toTaskPk`/`fromTaskPk` equivalents for the project/task backend (or reuses
`idMapping.ts` directly since it already has all four).

## Architecture decision: server-side event publishing

Previously (Notification Module PR #70), the frontend called `dispatchNotifications` →
`POST /api/notifications` for every event, including ones that were really describing a
frontend-only mutation (project created, task status changed, etc.). Now that Projects/Tasks
move to the backend, the correct shape is **the Project/Task routes publish notification events
server-side**, in-process, calling `notification.service.publishEvent()` directly — the exact
pattern `backend/src/routes/assistantRoutes.ts` already established for the AI Assistant hook.
The frontend no longer needs to call `dispatchNotifications` for anything that goes through a
real backend route; `AppContext`'s notification-dispatch calls for Project/Task/Board events
become dead code once the corresponding action is migrated to a real API call (removed as part
of that migration, not left in place as a redundant duplicate path).

## New backend modules (this branch)

```
backend/src/
├── routes/projectRoutes.ts        # /api/projects/*
├── controllers/projectController.ts
├── services/projectService.ts     # recipient resolution + publishEvent calls live here
├── repositories/projectRepository.ts   # all SQL for work.Projects/ProjectMembers
├── routes/taskRoutes.ts           # extended, not replaced — same route file, Postgres-backed
├── controllers/taskController.ts
├── services/taskService.ts
├── repositories/taskRepository.ts # all SQL for work.Tasks/TaskAssignees/TaskStatusHistory
└── validators/                    # shared field validators (project/task)
```

`backend/src/store/taskStore.ts` and its file-backed persistence are retired once
`taskRepository.ts` covers the same ground — not deleted blindly; confirm no other route still
imports it first.

## Progress log

- [x] Read ProjectAnalysis.md, BoardModuleGuide.md, Notification PRD, README.md
- [x] Confirmed PR #70 merged to main; branched `feature/backend-project-board-notification`
- [x] Documented schema mapping + architecture decision (this file)
- [x] Project CRUD API (`GET/POST/PUT/DELETE /api/projects`, members sub-resource) — live-verified
- [x] Task API migration to Postgres + missing endpoints (status/history/approve/reject) — live-verified
- [x] Kanban board frontend refactor (remove local state dependency)
- [x] Project Module frontend refactor (ProjectsView + AppContext off local state) — live-verified
- [x] Server-side notification publishing wired into Project/Task routes
- [ ] Update ProjectAnalysis.md / BoardModuleGuide.md / Notification_Module_Guide.md
- [x] Full verification pass (tsc, build) — backend has no automated test suite in this repo
- [ ] Push branch / open or update PR (pending explicit user go-ahead)

## Project/Task frontend refactor (AppContext.tsx / ProjectsView.tsx / TasksView.tsx)

`createProject`/`approveProject`/`rejectProject`/`updateProject`/`deleteProject`/
`approveProjectDeletion` and `updateTask`/`deleteTask` are now async and call the real
`/api/projects`/`/api/tasks` endpoints via `projectRepository.ts`/`taskRepository.ts` — same
"no local fallback, no fake success" contract `updateTaskStatus` already established. `tasks`/
`projects` state only ever changes from the server's response; a failed call returns
`{ success: false, message }` and leaves state untouched. `ProjectsView.tsx`'s create/edit form and
delete-confirmation dialog now `await` these calls, show a real inline error on failure (no local
guessing), and stay open/disabled while the request is in flight (mirrors `KanbanView.tsx`'s
`StatusChangeModal`/`modalSubmitting` pattern). `ApprovalsInboxView.tsx`'s `handleApprove`/
`handleReject` do the same.

Removed all the `dispatchNotifications(...)` calls inside these functions — `project.service.ts`/
`task.service.ts` already publish the equivalent event server-side (`project_created`/`updated`/
`archived`/`member_added`/`member_removed`, `task_assigned`/`updated`/`deleted`), so leaving the
frontend calls in place would have doubled every one of those notifications (confirmed this would
have been a real bug in `createTask`, which still had its old `task_assigned` dispatch even though
`task.service.ts`'s `createTask` already fires the same event — fixed as part of this pass).
`updateTask`'s old fine-grained notification differentiation (`task_reassigned`/
`task_priority_changed`/`task_due_date_changed`/`checklist_completed`) has no backend equivalent
yet (`task.service.ts`'s `updateTask` only fires a generic `task_updated`) — accepted as a scoped-down
simplification since the spec's explicit notification list only calls out Assigned/Approved/
Rejected/Status Changed, not this level of granularity. `Controlled_Edit` approvals stay local-only
(no backend endpoint for that workflow; out of this branch's scope).

**Reject-as-archive mapping**: `ApiProjectStatus` has no `Rejected` value (see `project.types.ts`) —
there's no backend concept distinct from `Archived`. `rejectProject`/`rejectApprovalItem` for a
`Project_Creation` request now call `archiveProjectApi(projectId, reason)`, the same soft-delete
every other Project mutation uses, with the rejection reason recorded on `ArchiveReason` for the
audit trail. Locally, `projects` state is annotated with `approvalStatus: 'Rejected'` for immediate
UI feedback (used by `DashboardView.tsx`'s pending-approvals count and `taskRules.ts`'s
`canCreateTaskForProject`), but a page refresh will re-fetch from the server and see
`approvalStatus: 'Approved'` instead (the DTO only derives `Pending Approval` vs `Approved` from
`StatusCode`, never `Rejected`) — this is a known, harmless cosmetic gap: `status` is still
`Archived` either way, which is what actually gates task creation and Kanban visibility. A real fix
would add an additive `Rejected` value to `work.ProjectStatuses` and extend the DTO mapping; not
done here given schema-change caution and the low practical impact.

**Deletion no longer cascades**: the old mock `deleteProject`/`approveProjectDeletion` removed the
project *and every task in it* from local state. The real backend never cascades a Project archive
to `work.Tasks` (soft-delete only touches the one row being archived), so the new versions leave
`tasks` completely untouched — a deleted/archived project's tasks remain visible/editable via the
Task module. `ProjectsView.tsx`'s delete-confirmation copy was updated to say this explicitly
instead of claiming tasks get "permanently deleted."

**`milestones`/`files`/`pinnedMessagesCount`**: still no backend representation (`ProjectDTO` omits
them, see `project.types.ts`). `createProject`/`hydrateProjects` default them to `[]`/`[]`/`0` on
every project entering state (the API response has no such keys) so `ProjectsView.tsx`'s form/render
code never dereferences `undefined`; `updateProject` preserves whatever the project already had
locally (spreading the API response over the existing object never clobbers keys absent from the
response). They remain pure frontend decoration, same as `tags`.

**Live verification**: exercised the exact payloads `AppContext.tsx` now sends via `curl` against
the running local Postgres-backed API — Admin create → Active; Team_Lead create → Pending Approval;
Admin update; Admin archive (reject-mapping); archived project still returned by
`GET /api/projects/:id` with `status: "Archived"` (never removed from `work.Projects`); Task
create/update/archive round-trip; confirmed `findAllTasks`/`findTasksForProject` filter out archived
tasks (so a deleted task correctly disappears from lists/Kanban) while `findAllProjects` does **not**
filter archived projects (so `ProjectsView`'s "Archived" status filter keeps working).
