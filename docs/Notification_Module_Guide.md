# Notification Module Guide

Everything a developer needs to extend or integrate with the Notification Module without
re-reading the whole app. Read `docs/ProjectAnalysis.md` first for general architecture; this
file only covers what's specific to notifications. The module implements
`nostification_Module_PRD.md` (v1.0) — read that for the full requirements this guide traces
back to.

## 1. Purpose

Deliver role-scoped, in-app notifications (plus bottom-right toasts) whenever a tracked event
happens elsewhere in the app — a task is assigned, a review is requested, a project is
archived, a user is deactivated, and so on — following the PRD's Role-Based Access Control
rules so Admins only see system/organization events, Team Leads see everything for the
projects they lead, and Team Members see only what's directly relevant to their own work.

## 2. Architecture

Three layers, kept strictly separate per the PRD's extensibility/maintainability goals:

```
UI                    frontend/src/features/notifications/
                       NotificationBell.tsx, NotificationsView.tsx,
                       NotificationListItem.tsx, ToastContainer.tsx
                       (call AppContext actions only — never touch state directly)
        │
        ▼
Business Logic         frontend/src/features/notifications/notificationService.ts
(NotificationService)  + notificationTypes.ts (taxonomy/RBAC deny-lists)
                        (pure functions: no React, no fetch, no side effects)
        │
        ▼
Data Layer              frontend/src/store/AppContext.tsx
                         `notifications: NotificationItem[]` state + the `dispatchNotifications`
                         helper every trigger point calls. This is today's in-memory
                         "database" — see §10 for what a real backend/DB replaces here.
```

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
└── NotificationsView.tsx      # Full Notification Center screen (search/filter/paginate/prefs)
```

Also touched (additively — see §12 for the exact diff shape):

| File | Change |
|---|---|
| `frontend/src/types/index.ts` | Extended `NotificationItem`; added `NotificationType`, `NotificationPriority`, `NotificationPreferences`, `ToastItem`/`ToastTone` |
| `frontend/src/store/AppContext.tsx` | Added `notifications`-adjacent state (`toasts`, `notificationPreferences`) + `dispatchNotifications` helper; added one `dispatchNotifications(...)` call inside each existing trigger action (see §9) |
| `frontend/src/components/layout/TopNav.tsx` | Swapped the inline bell `<button>` for `<NotificationBell />`; removed the now-unused `onOpenNotifs` prop |
| `frontend/App.tsx` | Added the `currentTab === 'notifications'` render case (was an empty stub, unreachable — same situation Kanban/Approvals were in before their branches); mounted `<ToastContainer />` once at the app-shell level |

**Not modified**: Authentication, Project Management (`ProjectsView.tsx`), Task Creation
(`TasksView.tsx`, `taskRules.ts`, `taskMutations.ts`), the Project Board's own UI
(`KanbanView.tsx`, `boardAccess.ts`). `AppContext.tsx` is shared state, not a "module" — the
same file every prior module (Board, Approvals) already added its own action functions to;
this branch only *adds* a notification-dispatch call inside each existing action, it does not
change any of those actions' existing behavior or signatures.

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
| Project created | `AppContext.createProject` | Admin-created → notifies the Team Lead **and every project member** via `resolveProjectRecipients` (previously only the Team Lead was notified, as "assigned you as Team Lead" — members added to a brand-new project got nothing). The Team Lead's copy is personalized via `recipientMessages` to also say "and assigned you as Team Lead"; everyone else just reads "created the new project". Team-Lead-created (needs approval) → notifies Admins (`approval` type) |
| Project approved / rejected | `AppContext.approveProject` / `rejectProject` | Notifies the original requester |
| Project updated / archived / restored | `AppContext.updateProject` | Detected via `status` transitions in/out of `'Archived'` |
| User added to / removed from project | `AppContext.updateProject` | Diffs `memberIds` before/after |
| Project deleted | `AppContext.deleteProject` | |
| Controlled edit requested / approved / rejected | `AppContext.proposeControlledEdit`, `approveApprovalItem`, `rejectApprovalItem` | `approval` type, routed to Admin + the task's Team Lead |
| Mention | `AppContext.sendChatMessage` | Simple `@Full Name` substring match against `users` — see §11 limitations |
| User deactivated | `AppContext.deactivateUser` | Notifies Admins + the affected user |
| Backup completed | `AppContext.exportBackup` | Notifies Admins including the acting Admin (self-notification doubles as an in-app success confirmation) |
| Task due tomorrow | `AppContext`'s due-date reminder scanner (`useEffect` + `setInterval`, next to `dispatchNotifications`) | Frontend-only stopgap scheduler — see below |

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

## 10. Future Backend Integration

Nothing here writes to a server or database (Step 4 constraint) — but every layer was shaped
so that becomes a drop-in swap:

- `notificationService.sendNotification()` today returns `NotificationItem[]` synchronously.
  A backend-connected version would be `async sendNotification(input): Promise<NotificationItem[]>`
  wrapping `POST /notifications`; `dispatchNotifications` in `AppContext.tsx` is the **only**
  caller, so only that one function needs to become `await`-aware — no UI component changes.
- `markAsRead` / `markAllAsRead` / `clearNotification` map 1:1 onto
  `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`, `DELETE /notifications/:id`.
- `getNotificationsByUser` / `filterNotifications` / `paginateNotifications` map onto a single
  `GET /notifications?userId=&type=&priority=&unreadOnly=&page=` — the filter/pagination
  parameter shapes were designed to translate directly into query params.
- Recipient resolution (`resolveTaskRecipients` etc.) is the one piece that should **move
  server-side** in production (never trust the client to compute who's allowed to see what) —
  it would become authorization logic inside the API route instead of a pure frontend
  function, matching the same "client-side prototype boundary" pattern already called out
  above `AppContext.createTask`.

## 11. Future Database Integration

`NotificationItem`'s fields were chosen to map cleanly onto a normalized `notify` schema (the
PRD's own FR-02 field list): `id`→`NotificationId`, `userId`→`RecipientUserId`,
`actorId`→`ActorUserId`, `type`→`NotificationTypeCode` (lookup table, same pattern as
`work.TaskStatuses`), `priority`→`PriorityCode`, `createdAt`→`CreatedAtUtc`,
`readAt`→`ReadAtUtc`, `projectId`/`taskId`→FKs into `work.Projects`/`work.Tasks`,
`metadata`→a `jsonb` column for anything type-specific that doesn't deserve its own column.
`database/00_schemas.sql` already reserves a `notify` schema (see
`docs/ProjectAnalysis.md` §5) for exactly this, though no tables exist in it yet — this
module's job was the frontend contract, not the migration.

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

- **In-memory only.** Like every other module in this prototype, `notifications` lives in
  `AppContext` React state — a refresh loses everything (including read/unread state) back to
  `INITIAL_NOTIFICATIONS`. See §10/§11 for the intended production path.
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
