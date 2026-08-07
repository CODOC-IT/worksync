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

Before applying an IAM migration in production:

1. Back up `auth.users`, `iam.Users`, `iam.UserRoles`, `iam.TeamLeadProjectScopes`, and project memberships.
2. Apply through a privileged migration connection, never a browser client.
3. Run the protected reconciliation process from the provisioning rollout before enabling the
   Supabase-only authentication middleware.
