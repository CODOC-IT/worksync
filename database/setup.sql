\set ON_ERROR_STOP on

BEGIN;

SET TIME ZONE 'UTC';

\ir 00_schemas.sql
\ir 01_support_functions.sql
\ir 02_org_tables.sql
\ir 03_iam_tables.sql
\ir 04_work_tables.sql
\ir 05_collab_tables.sql
\ir 06_hr_tables.sql
\ir 07_calendar_tables.sql
\ir 08_reporting_tables.sql
\ir 09_ai_tables.sql
\ir 10_notify_tables.sql
\ir 11_config_tables.sql
\ir 12_audit_tables.sql
\ir 13_foreign_keys.sql
\ir 14_integrity.sql
\ir 15_indexes.sql
\ir 16_views.sql
\ir 17_seed.sql
\ir 18_notify_seed.sql
\ir 19_notify_enhancements.sql
\ir 20_project_members_backfill.sql
\ir 21_task_assignees_backfill.sql
\ir 22_audit_enhancements.sql
\ir 23_system_actor_bootstrap.sql
\ir 24_audit_project_fk_relax.sql
\ir 25_project_approvals.sql
\ir 26_holiday_seed.sql
\ir 27_audit_task_fk_relax.sql

COMMIT;
