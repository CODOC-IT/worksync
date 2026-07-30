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

Before applying an IAM migration in production:

1. Back up `auth.users`, `iam.Users`, `iam.UserRoles`, `iam.TeamLeadProjectScopes`, and project memberships.
2. Apply through a privileged migration connection, never a browser client.
3. Run the protected reconciliation process from the provisioning rollout before enabling the
   Supabase-only authentication middleware.
