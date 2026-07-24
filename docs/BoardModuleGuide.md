# Project Board (Kanban) Module Guide

Everything a developer needs to extend the Project Board without re-reading the whole app.
Read `ProjectAnalysis.md` first for general architecture; this file only covers what's
specific to the board.

## 1. Purpose

A role-scoped Kanban view of tasks per project: `Todo → In Progress → Review → Done`, with
drag-and-drop status changes, a mandatory reason for every status change, and a Team
Lead/Admin approval gate between `Review` and `Done`.

## 2. Responsibilities

- Let a user pick which project's board they're looking at, scoped to what their role may see.
- Render the 4 board columns for the selected project's tasks.
- Let an authorized user drag a card (or use the status dropdown) to change its status,
  **always** via a mandatory-description modal.
- Enforce the Review → Pending Approval → Done/In-Progress approval workflow.
- Record every status change as an auditable history entry on the task.

**Out of scope** (deliberately, per module boundaries): creating/editing/deleting tasks or
their fields (title, description, assignees, due date, priority — that's the Task Creation
module, `frontend/src/features/tasks/`), creating/editing projects (Project Management
module), sending real notifications (Notification module), authentication, user management.

## 3. Files Involved

| File | Role |
|---|---|
| `frontend/src/features/kanban/KanbanView.tsx` | The board screen (was an empty stub before this branch) |
| `frontend/src/features/kanban/boardAccess.ts` | Pure, colocated permission/scoping helpers (new) |
| `frontend/src/types/index.ts` | Added `TaskStatusHistoryEntry`, `ReviewApprovalStatus`, and two optional fields on `Task` |
| `frontend/src/store/AppContext.tsx` | Extended the pre-existing (previously unused) `updateTaskStatus` action to append history + drive the approval state machine |
| `frontend/App.tsx` | Added the `currentTab === 'kanban'` and `currentTab === 'approvals'` render cases |
| `frontend/src/components/layout/Sidebar.tsx` | **Not modified** — the `kanban`/`approvals` nav entries already existed |
| `frontend/src/features/tasks/taskRules.ts` | **Not modified** — `canEditTask`, `isTaskOverdue`, `getTaskStartDate` are imported/reused as-is |
| `frontend/src/features/approvals/ApprovalsInboxView.tsx` | Implemented alongside the board by explicit request — see §17, a related but distinct approval mechanism |

## 4. Why `board.js` / `board.css` were not reused

The task brief referenced `backend/src/board.js` and `backend/src/board.css` as "the existing
board implementation to refactor." On inspection they are **untracked** (never committed)
vanilla-JS DOM-manipulation files written for a completely different app shell — they call
globals that don't exist anywhere in this repository (`DataStore`, `ActivityLog`,
`TaskFlowSession`) and target CSS selectors (`.sidebar__item`, `#mainContent`,
`#board-section`) that don't exist in this React app. They also live inside `backend/`, which
in this repo is an Express auth API with no UI-serving role. They cannot run as-is here.

Per explicit user confirmation, this branch **ports the feature behavior** they describe
(columns, card layout, drag-and-drop, mandatory-reason modal, due-date pills, toast
confirmations) into a proper React component using the app's real state layer (`AppContext`)
and design system (Tailwind + `glass-panel`/`StatusBadge`/`GlassCard`), rather than trying to
mount incompatible vanilla JS inside the React tree. The two files were left untouched in
place (not deleted, not referenced) since deleting untracked files outside this module's scope
wasn't requested.

## 5. Data Flow

```
AppContext (tasks, projects, users, currentRole, currentUser)
        │
        ▼
KanbanView.tsx
  ├─ getAccessibleProjects(role, userId, projects)   → project switcher options
  ├─ tasks.filter(projectId === selected)             → per-column task lists
  ├─ canEditTask(role, userId, project, task)          → can this card be dragged?
  ├─ canDecideReview(role, userId, project)             → show Approve/Reject?
  └─ on drop / dropdown change / Approve / Reject:
        → opens <StatusChangeModal> (mandatory textarea)
        → on submit: useApp().updateTaskStatus(taskId, newStatus, { note, reviewDecision })
              → AppContext appends a TaskStatusHistoryEntry, updates task.status /
                task.reviewApproval, calls the existing pushActivity() so the entry shows
                up in the Activity Log module for free.
```

No new global state, no new Context, no localStorage — the board is 100% derived from the
existing `AppContext` tasks/projects arrays, consistent with every other module.

## 6. Board Architecture

- `KanbanView` is a single component (plus two small local subcomponents:
  `StatusChangeModal` and `BoardCard`) — matches the file-per-view convention used by
  `ProjectsView.tsx`/`TasksView.tsx` (no per-feature CSS file; Tailwind only, per
  `ProjectAnalysis.md` §6).
- `boardAccess.ts` holds only pure functions (no React, no hooks) so they're trivially
  testable and reusable from, e.g., a future Reports view:
  - `getAccessibleProjects(role, userId, projects)`
  - `canDecideReview(role, userId, project)`
  - `BOARD_COLUMNS` (the 4-status tuple used for rendering)
- Card-level edit/drag permission reuses `canEditTask` from `taskRules.ts` verbatim — the
  board treats "may drag this card" as the same permission as "may edit this task," which is
  already role-aware (Admin: always; Team Lead: only if they lead the task's *active* project;
  Team Member: only if they're an assignee on the task). This avoids a second, possibly
  divergent permission rule for the same underlying question.

## 7. Role-Based Permissions

| Role | Project visibility | Can switch projects | Can drag/change status | Can Approve/Reject Review |
|---|---|---|---|---|
| **Admin** | All projects (all "workspaces") | Yes | Yes, any task | Yes, any project |
| **Team Lead** | Only projects where `project.teamLeadId === currentUser.id` | Yes, among their own projects | Yes, any task in their project (subject to `canEditTask`'s active-project check) | Yes, only for projects they lead |
| **Team Member** | Only projects where `project.memberIds.includes(currentUser.id)` | Only among projects they belong to | Only tasks assigned to them (`canEditTask` rule) | No |

Everyone who can see a project sees **every task in it**, regardless of assignee — per the
brief, understanding project context matters more than hiding teammates' cards. Only the
*ability to change* a card is restricted.

There's no separate "workspace" entity in this app's data model (see `ProjectAnalysis.md`
§5) — a `Project` *is* the workspace unit here, so "view all workspaces" for Admin and "switch
between managed projects" for Team Lead are both satisfied by the same project switcher.

## 8. Columns

Exactly four, per the brief: `Todo`, `In Progress`, `Review`, `Done`. `Task.status` also has a
fifth value, `Blocked`, owned entirely by the Task Creation module (`blockerReason` field,
`work.TaskBlockers` table). Blocked tasks are **not shown on the board** in this iteration —
see §11 Limitations.

## 9. Task Lifecycle / Status Change Workflow

Every status change, from any source (drag-and-drop or the card's status dropdown), goes
through the same mandatory-description modal (`StatusChangeModal`) before anything is
persisted:

1. User initiates a change (drag a card to a new column, or pick a new status from the
   dropdown).
2. If the target is the same as the current status, or the user isn't authorized
   (`canEditTask` false), nothing happens (drag is rejected / dropdown reverts).
3. Otherwise `StatusChangeModal` opens showing "Move From → Move To" and a required textarea.
   The **Update Status** button is disabled/blocked until the textarea is non-empty
   (client-side) — mirrors the mandatory-reason UX from the reference `board.js`.
4. On submit, `AppContext.updateTaskStatus(taskId, newStatus, { note })` runs, which:
   - Appends a `TaskStatusHistoryEntry` (`fromStatus`, `toStatus`, `note`, `changedBy`,
     `changedByName`, `timestamp`) to `task.statusHistory`.
   - Sets `task.status = newStatus`.
   - Logs an Activity Log entry via the existing `pushActivity` helper.
   - Shows a toast-style success `notice` (matches the pattern already used by
     `TasksView`/`ProjectsView` for consistency, rather than inventing a new toast component).

## 10. Drag & Drop Workflow

Native HTML5 drag-and-drop (`draggable`, `onDragStart`/`onDragOver`/`onDrop`), matching the
interaction model in the reference `board.js` (no new dependency added):

- A card is `draggable` only if `canEditTask(...)` returns true for the current user.
- Dropping onto the **same** column is a no-op.
- Dropping onto **Todo / In Progress / Review** (from any other of those three) is allowed in
  either direction and always opens the mandatory-description modal.
- Dropping onto **Done** via drag is **blocked** with an inline notice — Done is only
  reachable through the explicit Approve action (§10 below), never a raw drag, so there's
  always an accountable "who approved this" record. Cards already in `Done` are not
  draggable at all on the board (reopening a completed task is Task-module territory —
  `Task.reopenReason` already exists for that and is intentionally left alone here).

## 11. Approval Workflow

```
Todo ⇄ In Progress ⇄ Review  →  (Team Lead / Admin decision)  →  Done
                                        │
                                        └── Reject → back to In Progress
```

- Moving **any** task into `Review` (via drag or dropdown, by any authorized role) sets
  `task.reviewApproval = 'Pending'` in the same `updateTaskStatus` call — the task visually
  stays in the `Review` column but its card shows a "Pending Team Lead Approval" badge
  (reusing `StatusBadge`, whose `pending approval` string is already color-mapped).
- While `reviewApproval === 'Pending'`, a card in the `Review` column additionally renders
  **Approve** / **Reject** buttons, visible only when `canDecideReview(role, userId, project)`
  is true (Admin, or the Team Lead who owns that project).
  - **Approve** opens the same `StatusChangeModal` (title "Approve & Move to Done", still a
    mandatory note) and, on submit, calls `updateTaskStatus(taskId, 'Done', { note,
    reviewDecision: 'Approve' })` → `reviewApproval` is cleared, `status` becomes `Done`.
  - **Reject** opens the same modal (title "Reject & Return to In Progress") and calls
    `updateTaskStatus(taskId, 'In Progress', { note, reviewDecision: 'Reject' })` →
    `reviewApproval` is cleared, `status` reverts to `In Progress`.
- Leaving `Review` by any other path (e.g. a Team Lead manually drags the card back to `Todo`)
  also clears `reviewApproval`, since the pending decision no longer applies.
- **Design decision**: a Team Lead/Admin moving *their own* task into Review still lands in
  the same "Pending Approval" state as a Team Member's submission (rather than
  auto-approving), so every `Review → Done` transition has one consistent, auditable Approve
  step regardless of who is doing it. This is a deliberate simplification — see §13 for the
  natural follow-up.

## 12. Current Limitations

- `Blocked`-status tasks are not surfaced on the board (see §8).
- No drag-to-reorder within a column (matches the reference implementation; only
  cross-column moves change anything).
- Approval/status-history state lives only in frontend memory (`AppContext`), like every
  other module in this prototype — no Postgres write path yet, even though
  `work.TaskStatusHistory` already models exactly this on the DB side.
- No real-time multi-user sync (single browser session/state).
- The board doesn't yet expose bulk actions (e.g. multi-select move).

## 13. Future Enhancements / Extension Points

- Auto-approve when a Team Lead/Admin moves their *own* project's task through Review
  themselves (currently always requires the explicit Approve click — see §11).
- Persist `TaskStatusHistoryEntry`/`reviewApproval` to `work.TaskStatusHistory` once a
  write-capable backend exists (schema is already there).
- Column-level WIP limits, swimlanes by assignee, saved board filters.
- Surface `Blocked` tasks as a collapsible fifth lane or an overlay badge once the Task module
  finalizes its blocker UX.

## 14. Expected Integration with the Notification Module

Not implemented here per the brief ("do not implement notification functionality"), but the
hook point is intentionally the same one every other module already uses:
`AppContext`'s `pushActivity(...)` call inside `updateTaskStatus` already fires for every
board status change (including Approve/Reject). A future Notification module can either (a)
subscribe to new `ActivityLogItem`s with `targetType === 'Task'`, or (b) call
`AppContext`'s existing `notifications` setter from inside `updateTaskStatus` the same way
`createProject`/`submitHRRequest` already do — e.g. notify the task's assignees when a status
changes, and notify the project's Team Lead specifically when `reviewApproval` becomes
`'Pending'`. No board-specific plumbing is required; the integration point already exists.

## 15. Expected Integration with the Task Module

The board never writes to task fields owned by the Task module (`title`, `description`,
`assigneeId(s)`, `dueDate`, `priority`, `blockerReason`, `completionSummary`,
`workSummary`, `reopenReason`) — it only calls `updateTaskStatus`, which is scoped to
`status` + `statusHistory` + `reviewApproval`. When the Task module builds its own task-detail
status-change UI, it can safely call the same `updateTaskStatus` action (that's why it was
already named/commented "Kanban & Details" in `AppContext.tsx` before this branch) — the
mandatory-description contract will apply there too for free, and `task.statusHistory` becomes
a single shared audit trail for both surfaces.

## 16. Expected Integration with the Reports Module

`task.statusHistory` is a ready-made time series for cycle-time/lead-time reporting (time
spent per column, review rejection rate, etc.) without the Reports module needing to touch the
board's own code — it can read `tasks.flatMap(t => t.statusHistory ?? [])` directly from
`AppContext`, the same way it already reads `tasks`/`projects` today.

## 17. Relationship to the Approvals Inbox (`frontend/src/features/approvals/`)

`ApprovalsInboxView.tsx` was implemented alongside the board (by explicit request, beyond the
original board-only brief) because it had the same problem as the board: the `approvals` nav
item and its pending-count badge already existed in `Sidebar.tsx`, but the view file was an
empty stub and `App.tsx` had no render case for it, so it was unreachable. It reuses the
already-existing `systemApprovals` state and `approveApprovalItem`/`rejectApprovalItem`
actions in `AppContext.tsx` — no new state was added for it.

**This is a separate approval mechanism from the board's own Review workflow (§11) — don't
conflate them:**

| | Approvals Inbox | Board's Review → Done gate |
|---|---|---|
| Data | `SystemApproval[]` (`systemApprovals`) | `Task.status` / `Task.reviewApproval` |
| Approves | Project creation, task creation, controlled field edits | A task's Review-column submission |
| Decided by | Admin (always); Team Lead (only for projects they lead; never project-creation) | Admin, or the Team Lead of that task's project |
| Where | `/approvals` screen | Inline on the board's `Review` column cards |

They happen to share the same two roles as decision-makers, which is why a Team Lead's
`canDecide` check in `ApprovalsInboxView.tsx` mirrors the same "only for projects they lead"
rule as `canDecideReview` in `boardAccess.ts` — but they are intentionally two separate,
independently callable functions (one keyed by `SystemApproval.targetId`'s owning project, the
other by `Project.teamLeadId` directly) rather than a shared abstraction, since the two
approval domains may diverge later (e.g. multi-step approval chains for one but not the
other).
