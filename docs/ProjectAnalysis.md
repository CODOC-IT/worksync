# WorkSync — Project Analysis

Snapshot of the codebase as of the `feature/task-board-kanban` branch (July 2026). This
document exists so future feature work does not need to re-explore the whole repository —
skim this first, then read the module-specific guide you need (e.g. `BoardModuleGuide.md`).

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
├── backend/                       # Express + TypeScript auth API ONLY
│   └── src/
│       ├── server.ts, routes/authRoutes.ts, middleware/authMiddleware.ts, store/userStore.ts
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
- **Persistence**: This is a **client-side prototype**. Nothing is written to `localStorage`
  by default (state resets on refresh) except attendance/theme are in-memory only. There is an
  optional, best-effort Supabase read path: `frontend/src/features/tasks/taskRepository.ts`
  calls `loadTasksFromSupabase(projects)` once on mount and — if a Supabase client is
  configured (`frontend/src/utils/supabase.ts`) — replaces the mock `tasks` array with rows
  from `work.tasks` (see §5). If Supabase isn't configured, it silently falls back to mock
  data. There is currently **no write path** to Supabase/Postgres from the frontend — all
  mutations (`createTask`, `updateTaskStatus`, etc.) only update React state in memory.
- **Backend**: `backend/` is a minimal Express + TypeScript service that implements
  authentication only (`authRoutes.ts`, `authMiddleware.ts`, `userStore.ts`). It has no
  relationship to the Kanban/Task/Project UI — those are pure frontend-state features today.
- **Auth/session**: Not wired into the SPA's `AppContext` yet. `LoginView`/`SignupView` exist
  as UI screens; `currentRole`/`currentUser` in `AppContext` are switched via a manual role
  selector for prototyping, not a real session.

## 3. Module Responsibilities (frontend/src/features)

| Folder | Owns | Notes |
|---|---|---|
| `auth` | Login/Signup screens | Not wired to a real session yet |
| `dashboard` | Landing overview widgets | Reads from `AppContext`, read-only |
| `projects` | Project CRUD, approval-to-activate flow | `ProjectsView.tsx`; role gates via inline `canManage`/`canCreate` |
| `tasks` | Task CRUD, task list/filter table | `TasksView.tsx` + `taskRules.ts` (pure permission/validation helpers) + `taskMutations.ts` (mutation builders) + `taskRepository.ts` (Supabase read) |
| `kanban` | **Project Board module** | Was an empty stub before this branch; see `BoardModuleGuide.md` |
| `approvals` | Central inbox for `SystemApproval` items (project creation, controlled edits) | Independent of the board's task-status approval workflow |
| `attendance`, `calendar`, `chat`, `reports`, `activity`, `notifications`, `profile`, `ai-assistant`, `weekly-summary` | One view each, all read/write through `AppContext` | Out of scope for this branch — not touched |

## 4. Data Flow

1. `frontend/main.tsx` renders `<App />`, wrapped in `<AppProvider>` (from `AppContext.tsx`).
2. `AppProvider` seeds all entity state from `fixtures.ts`, then (async, non-blocking) tries
   `loadTasksFromSupabase` to replace `tasks` with live data if a Supabase project is configured.
3. Every feature view calls `const { ... } = useApp()` to read entity arrays and call mutation
   functions. Mutations are plain `setX((prev) => ...)` state updates — no network calls, no
   optimistic-vs-server reconciliation.
4. Cross-cutting side effects (activity log, notifications) are pushed manually inside each
   mutation via the `pushActivity(...)` closure defined in `AppContext.tsx` — there is no
   event bus. A module that wants an activity-log entry must call `pushActivity` itself from
   inside a new `AppContext` action (see `applyBoardStatusChange` added for the board module).
5. Role-based visibility is **not centralized** — each feature view computes its own
   role-scoping inline (e.g. `ProjectsView`'s `canManage`, `taskRules.ts`'s `canEditTask`).
   There is no single `usePermissions()` hook. When adding a module, follow this same pattern:
   write small pure functions colocated with the feature (or reuse an existing one from
   `taskRules.ts` if the semantics genuinely match).

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
- **Frontend ↔ DB id mapping**: `taskRepository.ts` maps Postgres integer ids to frontend
  string ids via a `prj-<id>` / `tsk-<id>` / `usr-<id>` prefix convention
  (`frontendId()` helper). Any future write-path work should follow the same convention.
- **No frontend localStorage persistence today** — despite the README claiming
  "LocalStorage Persistence," only the Team Members module (per README) actually does this;
  most other modules including Tasks/Projects/Kanban are in-memory only for now.

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

- There is no real backend for Projects/Tasks/Kanban yet — only auth. Any "approval" or
  "status change" logic implemented in the frontend today is a **client-side prototype**;
  before production use it must be re-implemented server-side (see the comment above
  `createTask` in `AppContext.tsx` for the established pattern of calling this out).
  Postgres already has `work.TaskStatusHistory` and `RequiresReview` columns ready for this.
- `Sidebar.tsx` already anticipates modules beyond what's implemented (e.g. `kanban` nav item
  existed before the board view did) — always check `Sidebar.tsx` and `App.tsx`'s tab router
  together before assuming a module is fully wired.
- Do not introduce a second stylesheet or component library; extend `index.css` tokens and
  reuse `GlassCard`/`StatusBadge` instead.
