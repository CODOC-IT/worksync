# Project Board (Kanban) Module Guide

Everything a developer needs to extend the Project Board without re-reading the whole app.
Read `ProjectAnalysis.md` first for general architecture; this file only covers what's
specific to the board.

> **Update (`feature/backend-project-board-notification`)**: The board is no longer a
> frontend-only prototype. Sections below written as "no Postgres write path yet"/"frontend
> memory only" describe the state *before* this branch — see §5 and §9 for the corrected data
> flow, §12/§13 for what moved out of "current limitations," and
> `docs/ProjectBoardNotification_Implementation_Notes.md` for the full design writeup. The
> board's UI/interaction model (columns, drag-and-drop, mandatory-reason modal, approval gate)
> is unchanged — only what happens when you drop a card changed.

> **Update (`feature/project-lead-workflow-fixes`)**: Review decisions (§11) are now
> Team-Lead-only — an Admin account no longer gets a blanket bypass on `approveTask`/`rejectTask`
> (it still does for most other Task/Project operations; this is a deliberate, narrower carve-out
> — see `task.service.ts`'s `decideReview` and `isProjectLead`'s new `{ allowAdmin: false }`
> option). "Team Lead" here has always meant *this specific project's* `ProjectMembers`
> membership row with `MemberRoleCode = 'TeamLead'` (`project.mapper.ts`'s
> `resolveTeamLeadUserId`), never the actor's account role — that per-project design predates
> this branch and did not need to change, only the Admin bypass on review decisions did.
> Rejecting a task with completed subtasks now requires a per-subtask Accept/Reject verdict, not
> just an overall comment — see the new §11a.

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
| `frontend/src/store/AppContext.tsx` | `updateTaskStatus` is now `async` and calls the real `PATCH /api/tasks/:id/status` (or `/approve`/`/reject`) endpoint — no local history/state mutation, `tasks` only updates from the server's response |
| `backend/src/tasks/task.service.ts` | `changeTaskStatus`/`approveTask`/`rejectTask` — server-side status-machine enforcement, `work.TaskStatusHistory` insert, and notification publish, all in one DB transaction |
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
  -- tasks/projects hydrated from GET /api/tasks / GET /api/projects on mount --
        │
        ▼
KanbanView.tsx
  ├─ getAccessibleProjects(role, userId, projects)   → project switcher options
  ├─ tasks.filter(projectId === selected)             → per-column task lists
  ├─ canEditTask(role, userId, project, task)          → can this card be dragged? (client-side
  │                                                       UX only -- the backend independently
  │                                                       re-derives the same rule server-side)
  ├─ canDecideReview(role, userId, project)             → show Approve/Reject? (same caveat)
  └─ on drop / dropdown change / Approve / Reject:
        → opens <StatusChangeModal> (mandatory textarea), disabled/"Saving..." while in flight
        → on submit: useApp().updateTaskStatus(taskId, newStatus, { note, reviewDecision })
              → PATCH /api/tasks/:id/status (or /approve, /reject)
              → task.service.ts: assertCanEditTask/isProjectLead (real authorization) →
                validates the transition → one DB transaction: updates work.Tasks.TaskStatusId
                + inserts work.TaskStatusHistory → publishes the notification event → responds
                with the updated task
              → AppContext replaces that one task in `tasks` with the server's response (never
                before the response arrives -- no optimistic update) → pushActivity() logs it
                locally → modal closes only on success; on failure the modal stays open with
                the real error and the note the user typed, so they can retry.
```

No new global state, no new Context, no localStorage — the board still only reads from the
`AppContext` `tasks`/`projects` arrays, same as every other module. What changed is where those
arrays' *content* comes from (the real API, not just seed data) and where a status change is
*decided* (the backend, not a local reducer).

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
| **Admin** | All projects (all "workspaces") | Yes | Yes, any task | **No** — Admin cannot decide a review, even for a project they created |
| **Team Lead** | Only projects where `project.teamLeadId === currentUser.id` | Yes, among their own projects | Yes, any task in their project (subject to `canEditTask`'s active-project check) | Yes, only for projects they lead |
| **Team Member** | Only projects where `project.memberIds.includes(currentUser.id)` | Only among projects they belong to | Only tasks assigned to them (`canEditTask` rule) | No |
| **HR** | Read-only, no board access | — | No | No |

"projects where `project.teamLeadId === currentUser.id`" is a **per-project** fact, not an
account-role check — `teamLeadId` comes from that project's own `ProjectMembers` row
(`MemberRoleCode = 'TeamLead'`), so a `Team_Member`-role account can lead Project A while being a
plain member of Project B, and the board (and the backend) treat them accordingly on each project
independently. `canDecideReview`/`canReopenTask` in `boardAccess.ts` and `isProjectLead` in
`backend/src/projects/project.service.ts` are the single source of truth for this on the frontend
and backend respectively — never `currentUser.role === 'Team_Lead'`.

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
   - Calls `PATCH /api/tasks/:id/status` (real API, no local fallback). `task.service.ts`
     re-validates authorization and the transition itself server-side, then in one DB
     transaction: updates `work.Tasks.TaskStatusId` and inserts a `work.TaskStatusHistory` row
     (`FromTaskStatusId`, `ToTaskStatusId`, `ChangedByUserId`, `ProgressNote`, `ChangedAtUtc`),
     then publishes the corresponding notification event.
   - On success, replaces that task in `AppContext`'s `tasks` array with the server's response
     (never before it arrives) and logs an Activity Log entry via `pushActivity`.
   - On failure, `tasks` is left completely untouched, the modal stays open with the note the
     user typed and a real error message, and nothing is shown as if it had succeeded.
   - Shows a toast-style success `notice` only once the server has confirmed the change (matches
     the pattern already used by `TasksView`/`ProjectsView` for consistency, rather than
     inventing a new toast component).

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

## 11a. Partial Subtask Rejection

Rejecting a task that has completed (Done) subtasks is no longer all-or-nothing. Previously,
rejecting the parent left every subtask marked Done even though the parent itself went back to
In Progress — this was a bug (a rejected task with a "100% complete" checklist), not a feature.

- The Reject modal (`StatusChangeModal` in `KanbanView.tsx`) fetches the task's subtasks
  (`GET /api/tasks/:id`) and, for every subtask currently `Done`, requires an explicit
  **Accept** or **Reject** choice — defaulting to Accept — plus a mandatory comment on any
  subtask marked Reject. This is in addition to, not instead of, the existing mandatory overall
  review comment.
- On submit, `PATCH /api/tasks/:id/reject` carries `{ note, subtaskDecisions }`, where
  `subtaskDecisions` is one `{ subtaskId, decision, comment? }` per Done subtask.
  `task.service.ts`'s `decideReview` validates every Done subtask has a decision (Reject ones
  must have a non-empty comment) before writing anything.
- **Accepted** subtasks are left untouched — they remain `Done`.
- **Rejected** subtasks are moved `Done → In Progress` via the same `work.TaskStatusHistory`
  write every other status change uses, with the Project Lead's per-subtask comment as that
  entry's `ProgressNote` — no new table, this reuses the existing shared audit trail (see §5's
  Task Module integration note). Each rejected subtask's own assignees are notified via the
  existing `subtask_reopened` event (the same one the ordinary subtask-status-change path already
  sends), carrying that subtask's specific comment.
- The parent task's own transition (`Review → In Progress`) and its overall review comment are
  unchanged from before — that half of the workflow was already correct.
- A task with no completed subtasks (or no subtasks at all) rejects exactly as before — no
  `subtaskDecisions` needed, and the modal shows no checklist.

### Assignee overflow

A card shows at most 2 assignee names inline; beyond that, a `+N` chip appears. Hovering or
clicking the chip reveals every assigned member's full name. The popover is rendered via
`createPortal` into `document.body` with `position: fixed` coordinates computed from the
trigger's `getBoundingClientRect()` — a plain `position: absolute` tooltip would get clipped by
the board column's `overflow-y-auto` scroll container (and, separately, by the containing-block
change `.glass-panel`'s `backdrop-filter` introduces for `position: fixed` descendants), so the
portal is required for correctness, not just convenience.

## 12. Current Limitations

- `Blocked`-status tasks are not surfaced on the board (see §8).
- No drag-to-reorder within a column (matches the reference implementation; only
  cross-column moves change anything).
- No real-time multi-user sync — another user's change lands next time this browser's `tasks`
  array is re-fetched (page load / manual refresh), not via a live socket/subscription. The
  data is real and shared (Postgres), the *sync* is still pull-based.
- The board doesn't yet expose bulk actions (e.g. multi-select move).
- ~~Approval/status-history state lives only in frontend memory~~ — resolved by
  `feature/backend-project-board-notification`: every status change is persisted to
  `work.Tasks`/`work.TaskStatusHistory` via the real API (see §5/§9).

## 13. Future Enhancements / Extension Points

- Auto-approve when a Team Lead/Admin moves their *own* project's task through Review
  themselves (currently always requires the explicit Approve click — see §11).
- Column-level WIP limits, swimlanes by assignee, saved board filters.
- Surface `Blocked` tasks as a collapsible fifth lane or an overlay badge once the Task module
  finalizes its blocker UX.
- Real-time sync (websocket/SSE push instead of the current re-fetch-on-load model) so a
  second user's move shows up without a manual refresh.
- ~~Persist `TaskStatusHistoryEntry`/`reviewApproval` to `work.TaskStatusHistory` once a
  write-capable backend exists~~ — done, see §5/§9.

## 14. Expected Integration with the Notification Module

**Implemented** (this was written when the brief said "do not implement notification
functionality" — that changed once the Notification Module backend was built in PR #70 and this
branch wired Project/Task events into it). The hook point ended up being server-side, not the
frontend `pushActivity` path originally anticipated below: `task.service.ts`'s
`changeTaskStatus`/`approveTask`/`rejectTask` call `notificationService.publishEvent()` directly,
in the same DB transaction as the status/history update, for `task_status_changed`/
`task_review_requested`/`task_review_approved`/`task_review_rejected` — including notifying the
project's Team Lead specifically when a task enters `Review`, exactly as anticipated below.
`task_review_approved`/`task_review_rejected` messages read "`<Lead's display name>` approved/
rejected your review request for `<task title>`..." — always the Project Lead's resolved display
name (see `docs/Notification_Module_Guide.md`'s actor-display-name section), never a raw user id.
Rejected subtasks (§11a) additionally get their own `subtask_reopened` event per subtask. The
frontend's `dispatchNotifications` is *not* called for any of these anymore (see
`docs/ProjectBoardNotification_Implementation_Notes.md`) — the paragraph that originally lived
here describing a frontend-side `pushActivity`/`notifications`-setter hook point is superseded by
this server-side one.

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
