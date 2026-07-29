# WorkSync — Project Analysis

Snapshot of the codebase as of the `feature/backend-project-board-notification` branch (July
2026). This document exists so future feature work does not need to re-explore the whole
repository — skim this first, then read the module-specific guide you need (e.g.
`BoardModuleGuide.md`, `docs/ProjectBoardNotification_Implementation_Notes.md` for the
Project/Board/Notification backend specifically).

> **Update (this branch)**: Project, Task, and Notification are no longer client-side
> prototypes. `backend/src/projects/`, `backend/src/tasks/`, and `backend/src/notifications/`
> are real Express + TypeScript modules backed by the Postgres schema described in §5, mounted
> at `/api/projects`, `/api/tasks`, `/api/notifications`. Sections below that used to describe
> "no backend"/"client-side prototype only" for those three modules have been updated; every
> other module (Attendance, Break Management, Reports, AI Assistant, Chat, Calendar, Dashboard,
> User Management) is genuinely unchanged and still frontend-only, as before.

## 1. Folder Structure

```
worksync/
├── frontend/                     # React 19 + TypeScript + Vite SPA (the actual product UI)
│   ├── App.tsx                   # Root component: tab router (currentTab state), layout shell
│   ├── main.tsx                  # Vite entry point
│   ├── index.css                 # Global design tokens + Tailwind import (the ONE stylesheet)
│   ├── package.json              # react, react-dom, lucide-react, motion, recharts
│   └── src/
│       ├── components/
│       │   ├── common/           # GlassCard, StatusBadge, GlobalSearchModal, ShortcutsModal
│       │   └── layout/            # Sidebar, TopNav
│       ├── features/              # One folder per product module (see §3)
│       │   ├── auth/
│       │   ├── dashboard/
│       │   ├── projects/
│       │   ├── tasks/
│       │   ├── kanban/            # ← Project Board module (this branch's focus)
│       │   ├── approvals/
│       │   ├── attendance/
│       │   ├── calendar/
│       │   ├── chat/
│       │   ├── reports/
│       │   ├── activity/
│       │   ├── notifications/
│       │   ├── profile/
│       │   ├── ai-assistant/
│       │   └── weekly-summary/
│       ├── mock-data/fixtures.ts  # Seed data for every entity (INITIAL_* constants)
│       ├── store/AppContext.tsx   # Single global state container (React Context + useState)
│       ├── types/index.ts         # All shared TypeScript interfaces/types
│       └── utils/supabase.ts      # Optional Supabase client (feature-detected, may be null)
├── backend/                       # Express + TypeScript API: auth + Project/Task/Notification
│   └── src/
│       ├── server.ts, routes/authRoutes.ts, middleware/authMiddleware.ts, store/userStore.ts
│       ├── projects/              # Project Module: project.{routes,controller,service,repository,types,validation}.ts
│       ├── tasks/                 # Task Module: task.{routes,controller,service,repository,types,validation}.ts
│       ├── notifications/         # Notification Module (production-complete, see Notification_Module_Guide.md)
│       ├── utils/idMapping.ts     # Shared usr-<id>/prj-<id>/tsk-<id> ↔ integer PK conversions
│       └── (board.js / board.css — untracked, NOT part of this app; see BoardModuleGuide.md §"Why board.js/css were not reused")
├── database/                      # PostgreSQL 16+ schema, 70 tables / 11 schemas, split by concern
│   ├── 00_schemas.sql … 17_seed.sql, setup.sql, README.md
└── docs/                          # ← You are here
```

## 2. Application Architecture

- **Runtime**: Vite-built single-page React app. There is no client-side router — navigation
  is a single `currentTab: string` state variable in `frontend/App.tsx`, changed by the
  `Sidebar`/`TopNav` components via an `onTabChange`/`onNavigate` callback prop. Adding a new
  screen means: add a `Sidebar` nav item (id + label + icon) and add
  `{currentTab === '<id>' && <YourView />}` inside `App.tsx`'s `<main>`.
- **State management**: One React Context, `AppContext` (`frontend/src/store/AppContext.tsx`).
  It holds every entity array (`users`, `projects`, `tasks`, `attendanceRecords`, …) as
  `useState`, seeded from `frontend/src/mock-data/fixtures.ts`, plus every mutation as a
  function on the context value (`createProject`, `updateTask`, `updateTaskStatus`, …). There
  is no Redux/Zustand — every feature view calls `useApp()` and reads/writes through these
  functions.
- **Persistence — Project/Task/Notification are real, everything else is still a client-side
  prototype.** `frontend/src/features/projects/projectRepository.ts` and
  `frontend/src/features/tasks/taskRepository.ts` are thin `fetch` wrappers over
  `/api/projects`/`/api/tasks` (Bearer token from `localStorage`). `AppContext.tsx` hydrates
  `projects`/`tasks` from these on mount (`hydrateProjects`/`hydrateTasks` effects) and every
  mutation (`createProject`, `updateTask`, `updateTaskStatus`, …) is `async`, calls the real
  API, and **only updates React state from the server's response** — a failed call returns
  `{ success: false, message }` and leaves state untouched (no optimistic update, no local
  fallback; see `docs/ProjectBoardNotification_Implementation_Notes.md`). The Notification
  Module (`frontend/src/features/notifications/notificationApiClient.ts`) follows a related but
  *different* contract: real API first, silent local fallback only if the call fails (it is not
  the source of truth for anything else, so a soft-fail is acceptable there in a way it isn't
  for Project/Task mutations). Every other module (Attendance, Break Management, Reports, AI
  Assistant, Chat, Calendar, Dashboard widgets, User Management) is still exactly what this
  document used to describe as the whole app: in-memory `useState`, resets on refresh, no
  network write path.
- **Backend**: `backend/` is an Express + TypeScript service. `authRoutes.ts`/`authMiddleware.ts`/
  `userStore.ts` handle authentication (JWT). `projects/` and `tasks/` (mounted at
  `/api/projects`/`/api/tasks`) and `notifications/` (mounted at `/api/notifications`) are real,
  Postgres-backed modules — see §5 and `docs/BoardModuleGuide.md`/`docs/Notification_Module_Guide.md`.
  Every other frontend module still has no backend counterpart.
- **Auth/session**: JWT-based (`backend/src/routes/authRoutes.ts`,
  `backend/src/middleware/authMiddleware.ts`). `LoginView`/`SignupView` call the real
  `/api/auth` endpoints; `AppContext`'s `currentRole`/`currentUser` still include a manual
  role-selector for demoing different roles without logging out, but every Project/Task API
  call carries the real JWT and the backend independently re-derives/enforces the caller's
  role server-side (see `assertCanManage`/`assertCanEditTask` in `project.service.ts`/
  `task.service.ts`) rather than trusting whatever role the frontend claims.

## 3. Module Responsibilities (frontend/src/features)

| Folder | Owns | Notes |
|---|---|---|
| `auth` | Login/Signup screens | Not wired to a real session yet |
| `dashboard` | Landing overview widgets | Reads from `AppContext`, read-only |
| `projects` | Project CRUD, approval-to-activate flow | `ProjectsView.tsx`; role gates via inline `canManage`/`canCreate`. Real backend (`/api/projects`) via `projectRepository.ts` — see `docs/ProjectBoardNotification_Implementation_Notes.md` |
| `tasks` | Task CRUD, task list/filter table | `TasksView.tsx` + `taskRules.ts` (pure permission/validation helpers, still used for client-side pre-validation) + `taskMutations.ts` (mutation builders, still used for pre-validation) + `taskRepository.ts` (real `/api/tasks` read/write, not just a Supabase read anymore) |
| `kanban` | **Project Board module** | Fully backend-integrated — every status change is `Frontend → PATCH /api/tasks/:id/status → DB update + TaskStatusHistory insert + notification publish → response → UI`; see `BoardModuleGuide.md` |
| `approvals` | Central inbox for `SystemApproval` items (project creation, controlled edits) | Independent of the board's task-status approval workflow |
| `attendance`, `calendar`, `chat`, `reports`, `activity`, `notifications`, `profile`, `ai-assistant`, `weekly-summary` | One view each, all read/write through `AppContext` | Out of scope for this branch — not touched |

## 4. Data Flow

1. `frontend/main.tsx` renders `<App />`, wrapped in `<AppProvider>` (from `AppContext.tsx`).
2. `AppProvider` seeds all entity state from `fixtures.ts`, then (async, non-blocking)
   `hydrateProjects`/`hydrateTasks`/the notification-fetch effect each try their real API —
   `GET /api/projects`, `GET /api/tasks`, `GET /api/notifications` — and replace the
   corresponding mock array with the live rows on success (console-warn + keep mock data on
   failure, e.g. no backend reachable). Every other entity array stays mock-only, seeded once.
3. Every feature view calls `const { ... } = useApp()` to read entity arrays and call mutation
   functions. For Projects/Tasks/Notifications, mutations are `async`: they call the real API
   first and only call `setX((prev) => ...)` from the server's response — never optimistically,
   never as a fallback on failure (Notifications is the one exception: it falls back to a local
   write on API failure, since it's not the system of record for anything downstream). Every
   other module's mutations are still plain synchronous `setX((prev) => ...)` state updates, no
   network call at all.
4. Cross-cutting side effects: **notifications now come from two places**. Server-owned events
   (everything a Project/Task API route triggers — created/updated/archived/status-changed/
   member-added/removed) are published by `project.service.ts`/`task.service.ts` directly,
   in-process, via `notificationService.publishEvent()` — the frontend does not call
   `dispatchNotifications` for any of these anymore (removing that call was part of this
   branch's work; leaving it in would double-publish). Every other module's notifications still
   go through `AppContext.tsx`'s `dispatchNotifications` closure exactly as before (which itself
   calls the real `/api/notifications` publish endpoint, with a local fallback on failure).
   Activity-log entries (`pushActivity(...)`) are unrelated to notifications and still pushed
   manually inside each mutation, unchanged.
5. Role-based visibility is **not centralized on the frontend** — each feature view computes
   its own role-scoping inline (e.g. `ProjectsView`'s `canManage`, `taskRules.ts`'s
   `canEditTask`), same as before. The difference for Projects/Tasks: the frontend check is now
   just a UX convenience (hide a button, show fewer options) — `project.service.ts`/
   `task.service.ts` independently re-check authorization server-side
   (`assertCanManage`/`assertCanEditTask`/`isProjectLead`) and are the actual authority; a
   frontend bug that shows a button it shouldn't still can't produce an unauthorized write.
   There is still no single `usePermissions()` hook on either side.

## 5. Storage Architecture / Database Schema Summary

- **Design system**: PostgreSQL 16+, 3NF, 70 tables across 11 schemas: `org`, `iam`, `work`,
  `collab`, `hr`, `calendar`, `reporting`, `ai`, `notify`, `config`, `audit`. Full DDL lives in
  `database/00_schemas.sql` through `database/17_seed.sql` (numbered, apply in order); see
  `database/README.md` and `database/setup.sql`.
- **Board-relevant tables** (schema `work`): `Tasks`, `TaskStatuses` (lookup:
  `Todo`/`InProgress`/`Review`/`Done`/`Blocked` + `RequiresReview` flag),
  `TaskAssignees`, `TaskStatusHistory` (`TaskId`, `FromTaskStatusId`, `ToTaskStatusId`,
  `ChangedByUserId`, `ProgressNote`, `ChangedAtUtc`) — this table is the DB-side equivalent of
  the frontend's new `Task.statusHistory[]` / `TaskStatusHistoryEntry.note` fields added for
  the board module. `ProjectMembers.MemberRoleCode` (`Owner`/`TeamLead`/`Member`/`Reviewer`/
  `Observer`) is the DB-side equivalent of `Project.teamLeadId` / `Project.memberIds` used by
  the frontend mock layer today.
- **Frontend ↔ DB id mapping**: `backend/src/utils/idMapping.ts` (`toUserPk`/`fromUserPk`/
  `toProjectPk`/`fromProjectPk`/`toTaskPk`/`fromTaskPk`, plus `*OrNull` variants) converts
  between Postgres integer PKs and the frontend's `usr-<id>` / `prj-<id>` / `tsk-<id>` string
  ids, server-side, in every Project/Task/Notification route. This is now the single shared
  home for that convention (relocated here from `backend/src/notifications/idMapping.ts` when
  the Project/Task modules needed the same conversions).
- **No frontend localStorage persistence today** — despite the README claiming
  "LocalStorage Persistence," only the Team Members module (per README) actually does this;
  most modules are in-memory only. Projects/Tasks/Notifications are the exception in the other
  direction: they persist to real Postgres via the backend, not to `localStorage` — a page
  refresh re-fetches them from `/api/projects`/`/api/tasks`/`/api/notifications` rather than
  losing them, which is the actual production-persistence path, not a `localStorage` cache.

## 6. UI Structure / Design System

- **Everything is Tailwind CSS v4** (`@import "tailwindcss"` in `frontend/index.css`) plus a
  small set of hand-written utility classes/design tokens in that same file — there is **no
  per-feature CSS file** anywhere in `frontend/src/features/*`. Every view (Dashboard,
  Projects, Tasks, Approvals, …) is styled with Tailwind utility classes directly in JSX.
  New modules should follow this convention rather than introducing a new stylesheet.
- **Theme**: dark-first "Kinetic Glass" cyberpunk glassmorphism. Key reusable tokens (all in
  `frontend/index.css`):
  - `--bg-canvas`, `--neon-cyan` (`#00f2fe`), `--neon-violet`, `--neon-magenta`, `--neon-amber`,
    `--neon-emerald` — swap automatically for `.light` mode.
  - `.glass-panel` — the base translucent card/container (blur + subtle border + shadow).
  - `.glass-panel-glow` — same but with a cyan glow border, used for modals/forms.
  - `.glass-button-neon` — the one primary-action button style used everywhere (gradient
    cyan→violet, glow on hover).
  - `.density-table` — the compact data-table style used by `TasksView`.
- **Reusable components** (`frontend/src/components/common/`):
  - `GlassCard` — mouse-tilt/glow card wrapper (`motion/react`), used for dashboard/project
    cards.
  - `StatusBadge` — pill badge that color-codes by string content (`active`/`done`→emerald,
    `in progress`/`review`/`pending`→amber, `todo`→cyan, `blocked`/`rejected`→rose,
    `urgent`/`high`→fuchsia). Works for both task status AND priority strings; the board
    module reuses this directly instead of writing new badge markup.
  - `Sidebar` / `TopNav` — layout chrome; `Sidebar` already has a `kanban` nav entry with a
    `KanbanSquare` icon (pre-existing, unused until this branch).
- **Icons**: `lucide-react` exclusively.
- **Motion**: `motion/react` (Framer Motion successor) for hover/tilt/entry animation, used
  sparingly (e.g. `GlassCard`).

## 7. Existing Coding Conventions

- Functional components, `React.FC` typing, hooks only (no class components).
- Pure business-logic helpers are extracted into a co-located `*Rules.ts` file
  (`frontend/src/features/tasks/taskRules.ts` is the canonical example: permission checks,
  validators, filters — all pure functions taking explicit params, no context/hooks). Reuse
  these instead of re-deriving the same logic (e.g. `canEditTask`, `isTaskOverdue`).
  The board module follows the same pattern (`boardAccess.ts`).
  - Mutation intents that need shaping before hitting `AppContext` live in a co-located
  `*Mutations.ts` (see `taskMutations.ts`).
  - Data-repository / external-fetch code lives in a co-located `*Repository.ts`
  (see `taskRepository.ts`).
- All cross-entity lookups are done by filtering arrays in memory (`users.find(u => u.id ===
  ...)`) — there are no indices/maps kept in state; this is fine at prototype scale.
- Optional/compat fields on shared types are added as `Partial<{...}>` intersections when a
  type is used slightly differently across modules (see `TaskModuleTask`,
  `CompatibleProject` in `taskRules.ts`) rather than mutating the canonical type — prefer this
  pattern for narrow, module-specific extensions; use additive `?:` fields directly on the
  canonical type in `types/index.ts` when the concept is genuinely shared (as was done for
  `Task.statusHistory` / `Task.reviewApproval`, since `TaskStatusHistory` already exists as a
  first-class DB table).
- Comments are used sparingly, only to explain "why" (e.g. the client-side-prototype boundary
  note above `createTask` in `AppContext.tsx`).

## 8. Important Files (quick index)

| File | Why it matters |
|---|---|
| `frontend/App.tsx` | Tab router — every screen is wired here |
| `frontend/src/store/AppContext.tsx` | All shared state + mutations |
| `frontend/src/types/index.ts` | All shared TypeScript types |
| `frontend/src/mock-data/fixtures.ts` | Seed data — realistic examples of every entity shape |
| `frontend/src/components/layout/Sidebar.tsx` | Nav item list, role-based badges |
| `frontend/index.css` | The entire design system (tokens + utility classes) |
| `frontend/src/features/tasks/taskRules.ts` | Canonical example of a permissions/validation module |
| `database/04_work_tables.sql` | Task/Project/status-history schema (source of truth for future backend work) |

## 9. Future Reference

- **Projects/Tasks/Notifications now have a real backend** (`backend/src/projects/`,
  `backend/src/tasks/`, `backend/src/notifications/`), Postgres-backed, JWT-authorized,
  status-history-audited. Approval/status-change logic for these three modules is
  server-authoritative, not a client-side prototype anymore — see
  `docs/ProjectBoardNotification_Implementation_Notes.md` for the full design decisions and
  `docs/BoardModuleGuide.md`/`docs/Notification_Module_Guide.md` for the module-specific guides.
  Every *other* module (Attendance, Break Management, Reports, AI Assistant, Chat, Calendar,
  Dashboard, User Management) is still exactly the client-side prototype this section used to
  describe for everything — that has not changed, and per this branch's explicit scope, wiring
  those up is future work, not something to infer is already done.
- `Sidebar.tsx` already anticipates modules beyond what's implemented (e.g. `kanban` nav item
  existed before the board view did) — always check `Sidebar.tsx` and `App.tsx`'s tab router
  together before assuming a module is fully wired.
- Do not introduce a second stylesheet or component library; extend `index.css` tokens and
  reuse `GlassCard`/`StatusBadge` instead.
- Known gaps left by this branch, worth knowing before extending Projects further: `Project`'s
  `milestones`/`files`/`pinnedMessagesCount` fields have no backend representation yet (pure
  frontend decoration, defaulted to empty/zero on every project that comes from the API — see
  `project.types.ts`'s `ProjectDTO` comment); rejecting a pending project proposal reuses the
  `Archived` status (there is no `Rejected` value in `work.ProjectStatuses` — see the
  Implementation Notes' "Reject-as-archive mapping" section for the reasoning and the small
  cosmetic gap it leaves after a page refresh).
