# Notification Module Guide

Everything a developer needs to extend or integrate with the Notification Module without
re-reading the whole app. Read `docs/ProjectAnalysis.md` first for general architecture; this
file only covers what's specific to notifications. The module implements
`nostification_Module_PRD.md` (v1.0) — read that for the full requirements this guide traces
back to.

> **Update (`feature/backend-project-board-notification`)**: §3's "Not modified" list below
> (Project Management, Task Creation, the Project Board's own UI) describes PR #70's scope at
> the time — it is no longer current for Project/Task. That follow-up branch gave Project and
> Task their own real backend modules (`backend/src/projects/`, `backend/src/tasks/`) which now
> publish their own events **server-side**, in-process, via this module's
> `notificationService.publishEvent()` (the same pattern `assistantRoutes.ts` established, listed
> in the integration-hooks table below) — the frontend `dispatchNotifications` calls §9 describes
> for Project/Task/Board triggers were removed as part of that migration (they would otherwise
> double-publish every event). Every other module's integration point (§9's Attendance/Break/
> Reports/Chat/AI hooks, all still frontend `dispatchNotifications` calls) is unchanged. See
> `docs/ProjectBoardNotification_Implementation_Notes.md` for the full detail.

> **Update (`feature/project-lead-workflow-fixes`)**: Three fixes, all scoped to Project/Task
> notification triggers:
> 1. **Project Lead assignment wording** — `project_created`/`project_member_added` now send the
>    project's Team Lead a distinct "...added you to it **as the Project Lead**." message
>    (`recipientMessages`, §7's per-recipient-message mechanism) instead of the generic member
>    wording every other recipient gets; reassigning a project's lead via `PUT /api/projects/:id`
>    sends the new lead a dedicated notice too. See `project.service.ts`'s `createProject`/
>    `addMember`/`updateProject`.
> 2. **Task review notifications** now read "`<actor>` approved/rejected your review request for
>    `<task>`..." (previously "...approved `<task>` and marked it Done."), and a rejected task's
>    individual subtasks each notify their own assignees via the existing `subtask_reopened`
>    event — see `docs/BoardModuleGuide.md`'s §11a.
> 3. **False-positive `project_member_removed` fixed** — this was never actually a notification
>    bug (§9's `project_member_added`/`removed` triggers were always correctly scoped); the root
>    cause was in `frontend/src/store/AppContext.tsx`'s `updateProject`, which diffed the
>    project's *unfiltered* previous member list (which includes the Team Lead) against a
>    *filtered* new list (Team-Member-role accounts only), making the lead look "removed" on
>    every project edit and firing a real `removeProjectMemberApi` call. Fixed by filtering both
>    sides of the diff identically.
>
> Actor display names (raw `usr-<n>` ids never appearing in notification text) and full
> DB-backed notification history (§10/§11) were already correct on `main` before this branch —
> see `backend/src/utils/actorDisplay.ts` and `notification.repository.ts`'s
> `insertNotificationWithFanout`/`findByUser` — and needed no changes here.

## 1. Purpose

Deliver role-scoped, in-app notifications (plus bottom-right toasts) whenever a tracked event
happens elsewhere in the app — a task is assigned, a review is requested, a project is
archived, a user is deactivated, and so on — following the PRD's Role-Based Access Control
rules so Admins only see system/organization events, Team Leads see everything for the
projects they lead, and Team Members see only what's directly relevant to their own work.

## 2. Architecture

```
UI                    frontend/src/features/notifications/
                       NotificationBell.tsx, NotificationsView.tsx,
                       NotificationListItem.tsx, ToastContainer.tsx
                       (call AppContext actions only — never touch state or the API directly)
        │
        ▼
Business Logic         frontend/src/features/notifications/notificationService.ts
(local fallback)       + notificationTypes.ts (taxonomy/RBAC deny-lists)
                        (pure functions: no React, no fetch, no side effects — used only when
                        the real API call below fails, see §10)
        │
        ▼
API Client              frontend/src/features/notifications/notificationApiClient.ts
                         Thin fetch wrapper over /api/notifications (Bearer JWT from
                         localStorage, same convention as features/ai-assistant's apiFetch).
        │  HTTP
        ▼
Backend                 backend/src/notifications/
                         notification.routes.ts → notification.controller.ts →
                         notification.service.ts → notification.repository.ts → Postgres
                         (Controller / Service / Repository layering — see §10)
        │
        ▼
Data Layer              PostgreSQL notify.* schema (database/10_notify_tables.sql),
                         reused as-is — this branch did not redesign it (see §11).
```

`frontend/src/store/AppContext.tsx` still holds `notifications: NotificationItem[]` React
state and the `dispatchNotifications` helper every trigger point calls — but that state is now
a **cache hydrated from the API** (fetched on mount, updated from each call's response) rather
than the system of record. Every one of AppContext's ~20+ trigger call sites is unchanged: they
still just describe *what happened* and call `dispatchNotifications`/`confirmActionSuccess`.

This mirrors the existing codebase convention (`taskRules.ts` is the same shape: pure
business-logic functions consumed by `AppContext.tsx`, never called straight from a view).

## 3. Folder Structure

```
frontend/src/features/notifications/
├── notificationTypes.ts       # NotificationType taxonomy: icon, tone, default priority per
│                               # type, plus the per-role deny-lists (RBAC safety net)
├── notificationService.ts     # NotificationService — see §7 for the full function list
├── NotificationListItem.tsx   # Shared row markup used by BOTH the bell dropdown and the
│                               # full Notification Center (so they can't visually drift).
│                               # Row text is single-line-truncated for layout; hovering (or
│                               # clicking the info icon) opens a portal-rendered popover with
│                               # the full untruncated title/message/actor/priority/timestamp
├── NotificationBell.tsx       # Bell icon + unread badge + dropdown preview (mounted in TopNav)
├── ToastContainer.tsx         # Bottom-right toast stack (mounted once in App.tsx)
├── NotificationsView.tsx      # Full Notification Center screen (search/filter/paginate/prefs)
└── notificationApiClient.ts   # Fetch wrapper over /api/notifications — see §10
```

```
backend/src/notifications/
├── notification.types.ts        # NotificationType/NotificationEvent/DTO/preferences types
│                                  # (duplicated from the frontend on purpose — separate TS
│                                  # projects, same convention as backend/src/types.ts's UserRole)
├── notification.mapper.ts       # DB row → NotificationDTO, DbPriority ↔ ApiPriority, link-route
│                                  # derivation (CategoryCode/TypeCode → 'tasks'/'kanban'/...)
├── notification.recipients.ts   # resolveAdminRecipients/resolveProjectRecipients/
│                                  # resolveTaskRecipients/resolveSingleRecipient — server-side
│                                  # equivalents of the frontend's identically-named helpers,
│                                  # built on the existing projectStore/userStore (not new state)
├── notification.repository.ts   # Repository layer — all raw SQL against notify.* (only file
│                                  # that imports backend/src/db/pool.ts's query/withTransaction)
├── notification.service.ts      # Service layer — recipient/priority/preference resolution,
│                                  # publishEvent() (the event-bus entry point every module calls)
├── notification.validation.ts   # Manual request-body validators (matches repo convention: no
│                                  # zod/joi anywhere else in the backend either)
├── notification.controller.ts   # Thin HTTP adapters — req/res only, no SQL, no business logic
├── notification.routes.ts       # Express Router, mounted at /api/notifications in server.ts
└── notification.repository.test.ts  # pg-mem-backed tests against the real notify.* DDL — §10
```

Also touched (additively — see §12 for the frontend diff shape, and §10 for the backend one):

| File | Change |
|---|---|
| `frontend/src/types/index.ts` | Extended `NotificationItem`; added `NotificationType` (now also covering Attendance/Break/Report/Chat/AI codes — see §6), `NotificationPriority`, `NotificationPreferences`, `ToastItem`/`ToastTone` |
| `frontend/src/store/AppContext.tsx` | Added `notifications`-adjacent state (`toasts`, `notificationPreferences`) + `dispatchNotifications` helper; added one `dispatchNotifications(...)` call inside each existing trigger action (see §9), now backed by the real API with a local fallback (§10) |
| `frontend/src/components/layout/TopNav.tsx` | Swapped the inline bell `<button>` for `<NotificationBell />`; removed the now-unused `onOpenNotifs` prop |
| `frontend/App.tsx` | Added the `currentTab === 'notifications'` render case (was an empty stub, unreachable — same situation Kanban/Approvals were in before their branches); mounted `<ToastContainer />` once at the app-shell level |
| `backend/src/server.ts` | Mounted `notification.routes.ts` at `/api/notifications` |
| `backend/src/routes/assistantRoutes.ts` | Minimal integration hook: calls `notification.service.publishEvent()` in-process after a saved prompt (see §9) |
| `backend/src/projects/project.service.ts`, `backend/src/tasks/task.service.ts` | (`feature/backend-project-board-notification`) Same in-process `publishEvent()` pattern as `assistantRoutes.ts`, now the real source of every Project/Task event — supersedes the frontend `dispatchNotifications` calls those triggers used to make |
| `database/18_notify_seed.sql` (new) | Seed data only — `iam.Users`/`work.Projects`/`work.Tasks` rows to satisfy `notify.*`'s FK constraints, plus every `notify.NotificationTypes` row (existing + new Attendance/Break/Report/Chat/AI codes). No `CREATE TABLE`/`ALTER TABLE` — the schema itself is untouched, per the explicit "do not redesign the schema" constraint |
| `backend/src/db/pool.ts` (new) | Shared `pg` connection pool + `withTransaction`, with a `setPoolForTesting`/`resetPoolForTesting` seam used only by `notification.repository.test.ts` |

**Not modified**: Authentication, Project Management (`ProjectsView.tsx`), Task Creation
(`TasksView.tsx`, `taskRules.ts`, `taskMutations.ts`), the Project Board's own UI
(`KanbanView.tsx`, `boardAccess.ts`), the `notify.*` Postgres schema DDL, Attendance/Break/
Reports/Activity Log/Project Chat/AI Assistant's own business logic — each of those modules
only gained the minimal trigger-point hook described in §9, never a redesign of the module
itself. `AppContext.tsx` is shared state, not a "module" — the same file every prior module
(Board, Approvals) already added its own action functions to; this branch only *adds* a
notification-dispatch call inside each existing (or, for Attendance/Break, newly
hook-equipped) action — it does not change those actions' core behavior or signatures.

## 4. Notification Lifecycle

```
1. Trigger        A user action calls an AppContext function (createTask, updateTaskStatus,
                   updateProject, deactivateUser, ...).
2. Describe        That function, after doing its normal work, calls the internal
                   `dispatchNotifications(input)` helper with a plain description of what
                   happened (type, title, message, actor, linkRoute, recipientIds).
3. Resolve          The recipientIds were already computed by one of NotificationService's
                    resolveXRecipients() helpers (§7) — this is the RBAC enforcement point.
4. Create           NotificationService.sendNotification() builds one NotificationItem per
                    recipient (createNotification()) and dispatchNotifications appends them
                    to AppContext's `notifications` array.
5. Toast (optional) If one of the new notifications belongs to the person currently viewing
                    the app AND their toast preference is on, a ToastItem is also pushed and
                    rendered by <ToastContainer /> for ~4.5s.
6. Read             Sidebar/TopNav/NotificationBell/NotificationsView all read the same
                    `notifications` array via useApp() and NotificationService's
                    getNotificationsByUser()/filterNotifications() — never a second store.
7. Mark read/clear  Clicking a notification (or "Mark all read" / the per-row clear button)
                    calls markNotificationRead / markAllNotificationsRead / clearNotification
                    on AppContext, which delegate to NotificationService's pure
                    markAsRead/markAllAsRead/clearNotification and commit the result.
```

## 5. Notification Flow (who calls what)

```
AppContext action (e.g. updateTaskStatus)
   │  built the event content + recipient list via resolveTaskRecipients/resolveAdminRecipients/...
   ▼
dispatchNotifications(input: SendNotificationInput)
   │
   ├─▶ notificationService.sendNotification(input) → NotificationItem[]
   │        └─▶ notificationService.createNotification() per recipient
   │
   ├─▶ setNotifications(prev => [...created, ...prev])
   │
   └─▶ pushToast(...) for any created item addressed to the current viewer
            └─▶ setToasts(prev => [...prev, toast])

confirmActionSuccess(title, message)   ← called separately, right after dispatchNotifications,
   │                                     by the SAME action that just ran
   └─▶ pushToast('success', title, message)
            (the actor is almost always excluded from their own event's recipientIds — nobody
            needs to be told about the action they just took — so without this the person who
            just changed a status, created a task, approved a request, etc. would get no
            feedback at all that it succeeded)

NotificationBell / NotificationsView
   │
   └─▶ notificationService.getNotificationsByUser(notifications, currentUser.id, currentRole)
          (scopes to the viewer AND applies the role deny-list defensive filter, §8)
       → notificationService.filterNotifications(...) / sortNotifications(...) / paginateNotifications(...)
```

## 6. Notification Types (taxonomy)

Full table lives in `notificationTypes.ts`'s `NOTIFICATION_TYPE_META` — one row per
`NotificationType` with its display label, icon, toast tone, and default priority. Legacy
values (`'approval' | 'task' | 'attendance' | 'mention' | 'system'`) were kept as valid union
members so pre-existing notifications (HR requests, the original "Project Approval
Requested") remain valid without reshaping.

Categories, matching PRD §7 / Step 6:

- **Task**: `task_assigned`, `task_reassigned`, `task_updated`, `task_status_changed`,
  `task_priority_changed`, `task_due_date_changed`, `task_review_requested`,
  `task_review_approved`, `task_review_rejected`, `task_completed`, `task_deleted`,
  `task_due_today`, `task_due_tomorrow`, `task_overdue`, `checklist_completed`
- **Collaboration**: `comment_added`, `mention`, `attachment_uploaded`
- **Project**: `project_created`, `project_updated`, `project_archived`, `project_restored`,
  `project_deleted`, `project_member_added`, `project_member_removed`, `approval` (system
  approval requests/decisions — project creation, controlled edits)
- **Admin/system**: `user_registered`, `user_role_changed`, `user_deactivated`,
  `workspace_created`, `workspace_deleted`, `backup_completed`, `backup_failed`,
  `security_alert`, `audit_alert`, `system_maintenance`
- **Attendance**: `attendance_check_in`, `attendance_check_out`, `attendance_late_check_in`,
  `attendance_absent`, `attendance_correction_submitted`, `attendance_correction_approved`,
  `attendance_correction_rejected`
- **Break Management**: `break_started`, `break_ended`, `break_exceeded`, `break_reminder`,
  `break_approved`, `break_rejected`
- **Reports**: `report_weekly_generated`, `report_monthly_generated`, `report_sprint_ready`,
  `report_productivity_ready`, `report_project_completion`
- **Project Chat**: `chat_reply`, `chat_new_message`, `chat_file_shared`, `chat_thread_reply`,
  `chat_announcement` (`mention`, above, predates this list and stays under Collaboration)
- **AI Assistant**: `ai_sprint_generated`, `ai_tasks_generated`, `ai_meeting_summarized`,
  `ai_deadline_suggested`, `ai_overdue_detected`, `ai_recommendation_available`

The last five groups were added for the backend integration branch (see §10) alongside the
`notify.NotificationTypes` seed rows in `database/18_notify_seed.sql` — every `NotificationType`
string is shared 1:1 with its `TypeCode` row so the mapper never has to translate codes, only
casing/vocabulary (`Normal` ↔ `Medium`, see `notification.mapper.ts`). **Per the "minimal
integration hook, not a new subsystem" rule**, not every seeded type has a live trigger yet —
see §9's "reserved" list for exactly which ones and why (mostly: the producing feature, e.g. a
Reports view or an AI sprint generator, doesn't exist in this codebase yet).

## 7. NotificationService API

`frontend/src/features/notifications/notificationService.ts` — every function is pure
(input → output, no state, no side effects), matching the module's Step 7/Step 11
requirement ("UI components should never manipulate notification data directly").

| Function | Purpose |
|---|---|
| `createNotification(input)` | Builds one `NotificationItem` (id, timestamps, priority default) |
| `sendNotification(input)` | The main entry point — builds one notification per unique recipient id. Accepts an optional `recipientMessages: Record<recipientId, string>` so the same event can read differently per recipient (e.g. the assignee reads "assigned **you**"; their Team Lead reading the same event reads "assigned **Priya**" — never "you", since it wasn't them). Falls back to the shared `message` for any recipient not in the map |
| `resolveTaskRecipients({ task, project, excludeUserId })` | Assignees + task creator + project's Team Lead, deduped, actor excluded |
| `resolveProjectRecipients({ project, includeMembers, excludeUserId })` | Team Lead (+ members), actor excluded |
| `resolveAdminRecipients(users, excludeUserId?)` | Every `Admin`-role user |
| `resolveSingleRecipient(userId, excludeUserId?)` | Trivial single-target wrapper (mentions, decisions) |
| `markAsRead(notifications, id)` | Pure transform, returns a new array |
| `markAllAsRead(notifications, userId)` | Only flips the given user's own items — `notifications` is a shared array holding every simulated user's items in this prototype |
| `clearNotification(notifications, id, requestingUserId)` | Deletes only if owned by the requester (FR-10); silent no-op otherwise |
| `getUnreadNotifications(notifications, userId)` | |
| `getNotificationsByUser(notifications, userId, role)` | Scopes to the user **and** applies the role deny-list (§8), sorted newest-first |
| `getNotificationsByProject(notifications, projectId)` | |
| `filterNotifications(notifications, filters)` | search / unreadOnly / type / priority / dateRange (Today, ThisWeek) |
| `sortNotifications(notifications, sortBy)` | newest / oldest / priority / unreadFirst (FR-23) |
| `paginateNotifications(notifications, page, pageSize=20)` | FR-13, default 20/page |

## 8. Role Permissions

Primary enforcement is **recipient targeting at creation time** — `resolveXRecipients()`
functions only ever include IDs that should legitimately receive the event (e.g.
`resolveTaskRecipients` never includes an Admin unless that Admin happens to be the task's
assignee/creator/team-lead). `getNotificationsByUser` adds a **second, defensive** layer: a
per-role deny-list (`notificationTypes.ts`'s `ADMIN_BLOCKED_TYPES` /
`TEAM_LEAD_BLOCKED_TYPES` / `TEAM_MEMBER_BLOCKED_TYPES`, checked by
`isNotificationVisibleForRole`) mirroring the PRD's §6.2/§6.4 "Notifications Not Received"
lists — so a future trigger that forgets to scope recipients correctly still can't leak
system noise to a Team Member or routine task chatter to an Admin. `mention` is never blocked
for any role — it's always targeted at one specific tagged person, so it stays personal
regardless of role.

| Role | Receives | Never receives |
|---|---|---|
| Admin | `approval`, `project_created/updated/archived/restored/deleted`, `user_*`, `workspace_*`, `backup_*`, `security_alert`, `audit_alert`, `system_maintenance` — plus `mention` if directly tagged | Routine task/board/collaboration events (assigned, status changed, comment, checklist, ...) |
| Team Lead | Everything for projects they lead: task lifecycle, review workflow, collaboration, project updates | Admin-only system/org events (`user_registered`, `workspace_*`, `backup_*`, `security_alert`, `audit_alert`, `system_maintenance`) |
| Team Member | Only what's directly about their own assigned work: assignment, status/priority/due-date changes, mentions, due reminders | Other members' tasks, unrelated projects, `project_deleted`, `approval` (Approvals Inbox), all Admin-only system/org events |

## 9. Trigger Points

| Event | Wired in | Notes |
|---|---|---|
| Task assigned | `AppContext.createTask` | |
| Task reassigned | `AppContext.updateTask` | Detected by diffing assignee ids before/after |
| Task updated / priority changed / due date changed | `AppContext.updateTask` | One specific type fires per call — priority/due-date change takes precedence over the generic "updated" notice when detected |
| Checklist completed | `AppContext.updateTask` | Fires when `subtasks` transitions from not-all-complete to all-complete |
| Task deleted | `AppContext.deleteTask` | |
| Task status changed / Review requested / Review approved / Review rejected / Task completed | `AppContext.updateTaskStatus` | Same action the Project Board module already calls; this branch only adds the notification dispatch, no board logic changed |
| Project created | `AppContext.createProject` | One shared block notifies the Team Lead **and every project member** via `resolveProjectRecipients`, regardless of whether the project is Active (Admin-created) or Pending Approval (Team-Lead-created) — previously Admin-created projects only notified the Team Lead, and Team-Lead-created projects notified nobody but Admins; members got nothing either way. `recipientMessages` personalizes per recipient: the Team Lead reads "...and assigned you as Team Lead", every other member reads "...and added you as a member". Team-Lead-created projects additionally notify Admins separately (`approval` type) for the approval request itself |
| Project approved / rejected | `AppContext.approveProject` / `rejectProject` | Notifies the original requester |
| Project updated / archived / restored | `AppContext.updateProject` | Detected via `status` transitions in/out of `'Archived'` |
| User added to / removed from project | `AppContext.updateProject` | Diffs `memberIds` before/after |
| Project deleted | `AppContext.deleteProject` | |
| Controlled edit requested / approved / rejected | `AppContext.proposeControlledEdit`, `approveApprovalItem`, `rejectApprovalItem` | `approval` type, routed to Admin + the task's Team Lead |
| Mention | `AppContext.sendChatMessage` | Simple `@Full Name` substring match against `users` — see §11 limitations |
| User deactivated | `AppContext.deactivateUser` | Notifies Admins + the affected user |
| Backup completed | `AppContext.exportBackup` | Notifies Admins including the acting Admin (self-notification doubles as an in-app success confirmation) |
| Task due tomorrow | `AppContext`'s due-date reminder scanner (`useEffect` + `setInterval`, next to `dispatchNotifications`) | Frontend-only stopgap scheduler — see below |
| Check-in / late check-in | `AppContext.checkIn` | Recipients: HR-role users (`resolveHRRecipients`, mirrors the pre-existing "Notify HR" pattern in `submitHRRequest`). "Late" = check-in time after `settings.workingHours.start` |
| Check-out | `AppContext.checkOut` | Recipients: HR |
| Break started / ended / exceeded | `AppContext.startBreak` / `endBreak` | "Exceeded" = duration over `settings.breakLimitMinutes`; recipients: HR |
| Attendance correction / leave / break-exception requested | `AppContext.submitHRRequest` | `type === 'Correction'` → `attendance_correction_submitted`; `'Leave'`/`'Break_Exception'` → the existing generic `approval` type (no dedicated Leave notification type was requested — reuses the same convention as `proposeControlledEdit`'s `approval` events) |
| Attendance correction / leave / break-exception approved or rejected | `AppContext.approveHRRequest` / `rejectHRRequest` | Notifies the original requester; type follows the same per-`HRRequest.type` mapping as submission (`break_approved`/`break_rejected` for `'Break_Exception'`) — previously these two actions sent no notification at all |
| New chat message | `AppContext.sendChatMessage` | `chat_new_message` to the rest of the project (`resolveProjectRecipients`), excluding anyone who already got the more specific `mention` notification for the same message |
| AI prompt generated | `backend/src/routes/assistantRoutes.ts`'s `POST /prompts` | Self-notification to the author confirming generation completed (AI Assistant has no team-visibility concept — saved prompts are private per user); `category === 'ProjectBreakdown'` → `ai_tasks_generated`, everything else → `ai_recommendation_available` |

**Seeded in `notify.NotificationTypes` but intentionally not wired to a trigger** (per "minimal
hook, no new subsystems" — the producing feature doesn't exist in this codebase):

- `attendance_absent` — no absence-detection scanner exists (would be new scheduling logic, not
  a notification hook).
- `report_weekly_generated`/`monthly_generated`/`sprint_ready`/`productivity_ready`/
  `project_completion` — `frontend/src/features/reports/ReportsView.tsx` and
  `frontend/src/features/weekly-summary/WeeklySummaryView.tsx` are both empty stub files with no
  "generate" action anywhere to hook into (`AppContext.updateWeeklySummaryDraft` only edits a
  draft buffer, never fires a completion event).
- `chat_reply`, `chat_file_shared`, `chat_thread_reply`, `chat_announcement` — `ChatMessage` has
  no reply/thread/announcement concept and its `attachments` field is never populated by any UI;
  building those would mean designing new Project Chat features, out of scope here.
- `ai_sprint_generated`, `ai_meeting_summarized`, `ai_deadline_suggested`, `ai_overdue_detected`
  — no sprint/meeting/deadline-suggestion/overdue-scanning feature exists in the AI Assistant
  today (it only generates prompt text for a handful of categories — see `assistantRoutes.ts`).

### Due-date reminder scanner (task_due_tomorrow)

There is no backend job runner in this prototype, so "24 hours before deadline" (FR-18) is
approximated by a `useEffect` in `AppProvider` that runs once on mount and then every hour
(`setInterval(..., 60 * 60 * 1000)`), plus whenever `tasks`/`projects` change. On each run it
scans every non-`Done` task; any task exactly one calendar day from its `dueDate` gets a
`task_due_tomorrow` notification via the normal `dispatchNotifications` → `resolveTaskRecipients`
path (assignee(s) + creator + the project's Team Lead — matching the PRD's stated "Assigned
Members + Team Lead" recipients, not the assignee alone).

A `dueReminderSentRef` (`useRef<Set<string>>`, key `${taskId}:due_tomorrow:${todayStr}`)
deduplicates so the hourly re-scan — or a task/project list change — never re-fires the same
task's reminder twice on the same calendar day. Like the rest of this prototype's state, the
dedupe set resets on page reload.

**Defined in the taxonomy but not wired to a live trigger** (no underlying feature exists yet
to call them from — adding one would be out of this module's scope):

- `comment_added`, `attachment_uploaded` — there is no Comments/Attachments mutation module in
  `AppContext` yet (`TaskComment`/`TaskAttachment` types exist but nothing creates instances).
- `task_due_today` / `task_overdue` — not yet wired, but trivial to add: the due-date reminder
  scanner above already computes `diffDays` per task each pass; a `diffDays === 0` branch
  (Due Today) or `diffDays < 0` branch (Overdue) would reuse the exact same
  dispatchNotifications/resolveTaskRecipients/dedupe-by-day pattern already in place for
  `task_due_tomorrow`.
- `user_registered`, `workspace_created/deleted`, `security_alert`, `audit_alert`,
  `system_maintenance` — no signup-to-AppContext wiring exists (Authentication was explicitly
  out of scope for this branch) and there is no workspace entity, security monitor, or
  maintenance scheduler in the app to call from.

## 10. Backend Integration (Implemented)

The Notification Module now has a real, production-shaped backend — Controller → Service →
Repository, exactly the layering `docs/ProjectAnalysis.md` prescribes for a future module:

- **`notification.repository.ts`** — the only file that writes SQL. `insertNotificationWithFanout`
  inserts one `notify.Notifications` row plus one `notify.UserNotifications` row per recipient,
  inside a single transaction (`withTransaction` from `backend/src/db/pool.ts`). `findByUser`
  builds its `WHERE` clause dynamically from filters (unreadOnly/type/priority/search/page).
  `markRead`/`clearOne` enforce ownership **in the `UPDATE ... WHERE` clause itself** (never a
  separate check-then-act), so there's no window where a caller could probe another user's
  notification (FR-24 "Secure Notification Access").
- **`notification.service.ts`** — `publishEvent(event)` is the single entry point every module
  (existing or new) calls: it resolves the `NotificationType`'s category/default priority,
  evaluates each recipient's `notify.UserNotificationPreferences` row to decide
  delivered-vs-suppressed (suppressed rows are still written, just excluded from `findByUser` —
  the event is never silently lost, per NFR-19 Auditability), and returns the created rows as
  frontend-ready `NotificationDTO[]`.
- **`notification.recipients.ts`** — server-side `resolveAdminRecipients`/
  `resolveProjectRecipients`/`resolveTaskRecipients`/`resolveSingleRecipient`, built on the
  existing `projectStore`/`userStore` (not new state) — this is recipient resolution actually
  moved server-side, which §10 of the pre-backend version of this doc called out as the one
  piece that shouldn't be trusted to the client. The frontend's identically-named
  `resolveXRecipients` helpers in `notificationService.ts` still run too (see the fallback
  path below) so a recipient list is always computed even if the API is unreachable.
- **id mapping (`idMapping.ts`)** — the frontend's prefixed string ids (`usr-4`, `prj-1`,
  `tsk-101`) are converted to/from the schema's integer primary keys at the repository
  boundary only, mirroring the exact convention `frontend/src/features/tasks/taskRepository.ts`
  already established (`frontendId()`), just in the opposite direction.

**Frontend wiring** (`notificationApiClient.ts` + `AppContext.tsx`): every notification action
now tries the real API first and falls back to the original pure, in-memory
`notificationService.ts` logic if that call fails — no backend running, no `DATABASE_URL`
configured, a network error, or (see §13) a demo-role-switched identity with no matching
backend session. This means the app is fully usable both with and without a live Postgres
instance: `dispatchNotifications`/`markNotificationRead`/`markAllNotificationsRead`/
`clearNotification`/`updateNotificationPreferences` all follow this same
"real API, local fallback" shape, and `notifications`/`notificationPreferences` state is
hydrated from `GET /notifications` and `GET /notifications/preferences` on mount (falling back
to `INITIAL_NOTIFICATIONS`/local defaults on failure). No UI component changed — the same
`NotificationItem[]`/`NotificationPreferences` shapes flow through `AppContext` either way.

### REST API

All routes are mounted at `/api/notifications` (`backend/src/notifications/notification.routes.ts`)
and require a JWT (`authenticateJWT`, applied via `router.use()`) — the notification identity
is always the verified `req.user.id`, never a client-supplied id.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/notifications` | List (filters: `unreadOnly`, `type`, `priority`, `search`, `page`, `pageSize`) |
| `GET` | `/notifications/unread` | Unread only, no pagination |
| `GET` | `/notifications/preferences` | Current user's preferences (defaults if no row yet) |
| `PUT` | `/notifications/preferences` | Partial update of one or more preference toggles |
| `POST` | `/notifications` | Publish an event (the event-bus HTTP entry point) |
| `PATCH` | `/notifications/read-all` | Mark every unread, uncleared notification read |
| `PATCH` | `/notifications/:id/read` | Mark one notification read |
| `DELETE` | `/notifications/clear` | Soft-delete (clear) every notification |
| `DELETE` | `/notifications/:id` | Soft-delete (clear) one notification |

`DELETE /clear` is registered before `DELETE /:id` deliberately — Express matches routes in
registration order, and `/:id` would otherwise swallow `/clear` as if `"clear"` were an id.

### Testing (pg-mem)

No live Postgres was available while building this branch, so
`notification.repository.test.ts` runs the repository/service layer against
[pg-mem](https://github.com/oguimbal/pg-mem), an in-memory Postgres emulator, executing the
**real** `notify.*`/`iam.*`/`work.*`/`hr.*` DDL (trimmed to the columns these tests exercise —
e.g. `SERIAL` stands in for `GENERATED BY DEFAULT AS IDENTITY`, which pg-mem doesn't fully
support) via `backend/src/db/pool.ts`'s `setPoolForTesting()` injection seam. Uses Node's
built-in `node:test` runner (`npx tsx --test backend/src/notifications/notification.repository.test.ts`),
matching this repo's only existing test file's convention (`assistantRoutes.test.ts`) — no
Jest/Vitest.

Three pg-mem-specific gotchas worth knowing if you extend these tests:

- **Don't use `db.backup()`/`.restore()` for per-test cleanup.** It looked correct in isolation
  but left the `Pool` (created once via `db.adapters.createPg()` in `before()`) out of sync with
  the restored snapshot, so rows silently accumulated across tests. Explicit
  `DELETE FROM notify.usernotifications; DELETE FROM notify.notifications; DELETE FROM
  notify.usernotificationpreferences;` in `beforeEach` is what's used instead — deterministic,
  no snapshot/connection-identity interaction to worry about.
- **A `UNIQUE` constraint on a column breaks `WHERE col = ANY($::text[])` combined with a
  `LEFT JOIN`** — pg-mem silently returns zero rows instead of the matching ones (confirmed with
  a minimal reproduction outside this suite; the same query works fine against real Postgres, or
  against the same column without `UNIQUE`). `notify.NotificationTypes.TypeCode` is `UNIQUE` in
  the real schema, so the test DDL deliberately omits that constraint — a documented test-only
  simplification, not a production behavior change.
- **`COUNT(*) FILTER (WHERE ...)` is silently ignored** — pg-mem returns the unfiltered total for
  every aggregate in the same `SELECT`, rather than erroring or applying the filter (confirmed
  with a minimal reproduction: `COUNT(*), COUNT(*) FILTER (WHERE x)` returned the same number for
  both). `notification.repository.ts`'s `getDeliveryAnalytics` uses
  `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` instead — functionally identical on real Postgres, and
  portable rather than a test-only workaround, so no test DDL simplification was needed here.
- **`CURRENT_TIMESTAMP` compared against a `timestamptz` column via `<=`/`>=` inside a
  parenthesized `OR` can throw `cannot cast type timestamp to timestamptz`** — pg-mem's type
  inference for the bare `CURRENT_TIMESTAMP` keyword doesn't always resolve to `timestamptz` the
  way real Postgres does. `now()` (a real function call, unambiguously `timestamptz`) works
  correctly in the same position — used for the `SnoozedUntilUtc` comparisons in `findByUser`/
  `findUnreadByUser`.

## 11. Database Integration (Implemented)

The Notification Module reuses the existing `notify` schema **as-is** —
`database/10_notify_tables.sql`'s `NotificationTypes`/`Notifications`/`UserNotifications`/
`UserNotificationPreferences` were already fully designed; this branch's only database change
is `database/18_notify_seed.sql` (data only, no `CREATE`/`ALTER TABLE`), which seeds:

- `iam.Users`/`work.Projects`/`work.Tasks` reference rows mirroring the frontend's mock data
  (`usr-1`..`usr-8`, `prj-1`..`prj-6`, `tsk-101`..`tsk-108`) — these exist solely to satisfy
  `notify.*`'s FK constraints (`Notifications.ActorUserId`/`ProjectId`/`TaskId` →
  `iam.Users`/`work.Projects`/`work.Tasks`), not as a live mirror of app state. Role/membership
  lookups for recipient resolution still go through the existing `projectStore`/`userStore`
  in-memory stores, not these rows.
- Every `notify.NotificationTypes` row — the pre-existing Task/Project/Approval/System codes
  plus the new Attendance/Break/Report/Chat/AI codes (§6), each with its `CategoryCode` (used
  for link-route derivation, see `notification.mapper.ts`) and `DefaultPriority`.

`NotificationDTO`'s fields map onto the schema exactly as this doc originally predicted:
`id`→`NotificationId` (prefixed `notif-`), `userId`→`RecipientUserId`, `actorId`→`ActorUserId`,
`type`→`NotificationTypes.TypeCode`, `priority`→`PriorityCode` (`Normal` ↔ `Medium`),
`createdAt`→`CreatedAtUtc`, `readAt`→`ReadAtUtc`, `projectId`/`taskId`→FKs into
`work.Projects`/`work.Tasks`. There is no `metadata` column (the schema was deliberately not
redesigned to add one) — `NotificationItem.metadata` stays a frontend-only, non-persisted field
for anything type-specific; nothing currently sets it.

## 12. Future WebSocket Integration

FR-04 wants real-time push. Today, everything is synchronous React state — a notification
"arrives" the instant `dispatchNotifications` runs, because it's the same browser tab that
triggered the event. A real multi-user deployment would need:

1. A WebSocket (or SSE) connection opened once in `AppProvider` (same lifecycle spot as the
   existing `loadTasksFromSupabase` effect).
2. On receipt of a server-pushed notification payload, call the *same*
   `setNotifications((prev) => [payload, ...prev])` / toast logic that `dispatchNotifications`
   already uses — so the delivery mechanism changes, but nothing downstream (NotificationBell,
   NotificationsView, ToastContainer) needs to know or care whether a notification arrived via
   a local action or a socket push.
3. `dispatchNotifications` itself would stop being the thing that creates notifications for
   *other* users' browsers (impossible from a single client) and instead just fire the
   `POST /notifications` from §10 — the server would be responsible for fanning that out over
   sockets to every resolved recipient who's currently connected.

## 13. Known Limitations

- **Falls back to in-memory state whenever the API is unreachable.** If there's no backend
  running, no `DATABASE_URL` configured, or a network error, every notification action falls
  back to the original pure, in-memory `notificationService.ts` logic (see §10) — which behaves
  exactly like this module did before it had a backend, including losing state on refresh. This
  is a deliberate resilience choice, not an oversight: the app must stay usable without a live
  Postgres instance (true of this sandbox throughout development).
- **The demo Role Switcher can diverge from the real authenticated identity.** `TopNav`'s Demo
  Role switcher (§14) swaps `currentUser`/`currentRole` to a different local mock profile
  without re-authenticating against the backend — it predates this module's backend and is
  unrelated to it. Since the notification API always trusts the JWT's `req.user.id` (never a
  client-supplied id, per FR-24), publishing an event while `currentUser` doesn't match the
  actual logged-in JWT identity gets rejected server-side (`actorId must match the authenticated
  user`) and silently falls back to the local path above. Real per-role testing of the backend
  path requires actually logging in as that role (`LoginView`), not the demo switcher.
- **Single-session toasts.** Toasts only ever appear for the person currently driving the one
  open browser tab — see the note in the Notification Flow (§5) and Trigger Points.
- **Mention detection is a plain substring match** (`message.includes('@Full Name')`) against
  `users`, not a proper `@`-autocomplete/tokenized mention UI. Good enough to prove the
  trigger → notification → RBAC pipeline end-to-end; a real mentions UI is Project Chat
  module territory, out of scope here.
- **Due-date reminders only cover "due tomorrow"** — `task_due_today`/`task_overdue` are
  defined in the taxonomy but not yet wired (§9); the scanner that fires `task_due_tomorrow`
  is a frontend `setInterval` approximation, not the PRD's precise 9am-scheduled server job.
- **Email channel is a preference toggle only** — `NotificationPreferences.email` exists and
  renders (disabled) in the Preferences panel, but nothing sends email; that's explicitly a
  backend concern (SMTP/Brevo, already used elsewhere in this repo for OTP — see
  `backend/src/services/emailService.ts` — would be the natural place to add it later).
- **Search only matches `title`/`message` text** (FR-11 also lists Task Name/Project
  Name/Member Name as separate search fields) — since notification copy already embeds the
  relevant task/project/actor name at creation time (e.g. "Salman Ahmed moved 'Grounding
  Context Picker...' to Review"), a plain text search covers the practical case without the
  service needing extra `projects`/`tasks`/`users` lookups just to search by name.

## 14. Developer Notes

- **Adding a new notification type**: add it to `NotificationType` in `types/index.ts`, add
  one row to `NOTIFICATION_TYPE_META` in `notificationTypes.ts` (label/icon/tone/priority),
  decide if it needs a deny-list entry in the per-role sets, then call `dispatchNotifications`
  from wherever the triggering action lives — nothing else needs to change.
- **Adding a new trigger point**: call `dispatchNotifications({ recipientIds, type, title,
  message, actorId: currentUser.id, actorName: currentUser.name, linkRoute, projectId?,
  taskId? })` from inside the relevant `AppContext` action, after its existing state update.
  Use one of the `resolveXRecipients` helpers rather than hand-rolling a recipient list, so
  the RBAC rules stay centralized in one file.
- **Testing role scoping locally**: use the "Demo Role" switcher in `TopNav` — it swaps
  `currentUser`/`currentRole` live, and the bell/Notification Center immediately re-scope via
  `getNotificationsByUser`.
- Do not import `notificationService` functions directly into a view component to build or
  mutate a `NotificationItem` — always go through an `AppContext` action, even for new code,
  so the "UI never touches notification data directly" rule (Step 7) holds for future
  contributors too.
