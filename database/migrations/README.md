# Versioned database migrations

These migrations are for existing WorkSync databases. Apply them in filename order after the
one-time baseline schema in `database/setup.sql` has been installed.

`20260730_01_account_provisioning_schema.sql` is additive and safe to run more than once. It
does not delete IAM users, project memberships, role history, or legacy bcrypt credentials.
It expects a Supabase Postgres database because it references `auth.users`.

`20260730_02_account_credentials_invitations.sql` normalizes stored account identifiers and
enforces organization-scoped, case-insensitive uniqueness for email and username. Resolve any
pre-existing case-only duplicates before applying it.

`20260730_03_permanent_account_passwords.sql` activates accounts created by the Admin/HR
provisioning workflow and removes the retired first-login password-change flag from their
Supabase Auth metadata. It does not change or re-hash any password.

`20260730_04_project_approval_requests.sql` installs the persistent project-management approval
table in existing environments. It uses the same lowercase-folded PostgreSQL identifiers as the
repository and safely adopts an early quoted `"work"."ProjectApprovalRequests"` table if present.

`20260730_05_project_task_archive_cascade.sql` adds a project-driven task archive marker,
backfills tasks under already-archived projects, and preserves immutable audit snapshots when a
project and its tasks are permanently deleted.

`20260806_01_holiday_audience.sql` adds holiday audience targeting (Everyone / Department /
Users): an `AudienceType` column on `hr.Holidays`, the `hr.HolidayAudienceDepartments` and
`hr.HolidayAudienceUsers` join tables, and seeds the `holiday_created` notification type. Safe to
run more than once; existing holidays default to `AudienceType = 'Everyone'`, matching their prior
unfiltered visibility.

`20260807_01_notification_detail_metadata.sql` adds `DetailText` and `MetadataJson` to
`notify.Notifications` (the expanded-detail half of the Notification Center's compact-preview /
expanded-detail split) and seeds the `task_edit_approval_requested`/`_approved`/`_rejected`,
`subtask_assignment_changed`, and `leave_requested`/`_approved`/`_rejected` notification types.
Safe to run more than once; existing notifications keep NULL detail/metadata and render exactly
as before.

`20260807_02_rejected_project_creation_cleanup.sql` preserves project-approval decisions and
their `DecisionReason` when a rejected project-creation proposal is permanently deleted. It also
repairs the approval request type constraint in environments created before `PROJECT_CREATE` was
added to the workflow.

`20260807_01_project_member_pending_removal.sql` adds `PendingRemovalAtUtc`/
`PendingRemovalByUserId`/`PendingRemovalReason` columns to `work.ProjectMembers` (a member with
active task/subtask assignments is flagged instead of removed) and seeds the
`project_member_pending_removal`/`project_member_auto_removed` notification types. Additive and
safe to run more than once; existing members default to not pending removal.

`20260808_01_project_approval_rejected_notification.sql` seeds the `project_approval_rejected`
notification type, used when an Admin rejects a Team Lead's project approval request (creation,
edit, archive, restore, delete, or permanent delete) — the notification carries the Admin's
`DecisionReason` exactly as persisted on `work.ProjectApprovalRequests`. Data-only, safe to run
more than once.

`20260808_01_ai_prompt_library.sql` installs the AI Assistant prompt library: `ai.PromptLibraries`
and `ai.PromptVersions` give saved prompts (and their version history) durable Postgres storage
instead of the backend's in-memory `PromptStore`, which lost every saved prompt on backend
restart / serverless recycle. Safe to run more than once; there is no data to backfill because
nothing was ever persisted before.

`20260809_01_attendance_working_schedule.sql` enables Admin-configurable attendance working
schedules. It relaxes `CK_WorkScheduleDays_Times` so a working day may cross midnight (e.g.
16:00 -> 00:00) with `EndTime < StartTime`, adds the overnight-aware helpers
`hr.schedule_window_minutes` / `hr.schedule_net_minutes` as the SQL single source of truth for
schedule math, and seeds one default 8-hour (16:00 -> 00:00, 60-minute break, 7-hour net,
Mon-Fri) `IsDefault` `hr.WorkSchedules` per active organization. Idempotent: an existing
default schedule is left untouched.

`20260810_01_attendance_net_fallback.sql` aligns `hr.schedule_net_minutes` with the TypeScript
`workingSchedule.ts` fallback so a missing window yields the fixed 7-hour (420-minute) net
expectation instead of 0 (which would otherwise classify un-scheduled days as Short Hours).
`CREATE OR REPLACE` only; safe to run more than once.

`20260816_01_project_teams.sql` installs the multi-team project architecture: `work.ProjectTeams`
(a team within a project, with a unique-per-project name and a required description),
`work.TeamMembers` (a person's membership in one team of a project, with a `UNIQUE(ProjectId,
UserId)` enforcing the "one person, one team per project" invariant, `IsLead` marking the team's
lead, and a partial unique index guaranteeing at most one lead per team), and a nullable
`work.Tasks.TeamId` plus `AssignmentStatus` (`NeedsTeamAssignment` for an Admin-created task the
team lead has yet to assign, `Assigned` otherwise). Also seeds the `team_member_moved`,
`team_lead_changed`, `team_member_removed_needs_reassignment`, `admin_task_needs_team_assignment`,
and `subtask_transfer_*` notification types. Additive and safe to run more than once; existing
projects simply have no team rows and keep working through the single project-lead model.

`20260817_01_team_chat_threads.sql` extends Project Chats so a discussion can be scoped to a
project team: it adds a nullable `collab.DiscussionThreads.TeamId` parent column (a team thread
stores `TeamId` only and derives its project through `work.ProjectTeams.ProjectId`, mirroring how
task-scoped threads store `TaskId` only), widens `CK_DiscussionThreads_Type` with the new `Team`
thread type, includes `TeamId` in the "exactly one parent" constraint, and adds the team foreign
key. Existing project/task threads are untouched (`TeamId` stays NULL). Safe to run more than once.

Before applying an IAM migration in production:

1. Back up `auth.users`, `iam.Users`, `iam.UserRoles`, `iam.TeamLeadProjectScopes`, and project memberships.
2. Apply through a privileged migration connection, never a browser client.
3. Run the protected reconciliation process from the provisioning rollout before enabling the
   Supabase-only authentication middleware.
