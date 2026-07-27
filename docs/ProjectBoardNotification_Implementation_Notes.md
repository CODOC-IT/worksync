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
- [ ] Project CRUD API (`GET/POST/PUT/DELETE /api/projects`, members sub-resource)
- [ ] Task API migration to Postgres + missing endpoints (status/history/approve/reject)
- [ ] Kanban board frontend refactor (remove local state dependency)
- [ ] Project Module frontend refactor (ProjectsView off local state)
- [ ] Server-side notification publishing wired into Project/Task routes
- [ ] Update ProjectAnalysis.md / BoardModuleGuide.md / Notification_Module_Guide.md
- [ ] Full verification pass (tsc, build, tests)
