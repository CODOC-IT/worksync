-- Notification types for the multi-team project architecture (work.ProjectTeams /
-- work.TeamMembers / work.SubtaskTransferRequests -- see
-- database/migrations/20260816_01_project_teams.sql, which creates those tables and seeds these
-- same rows for databases provisioned before the team layer existed).
--
-- This file exists so a FRESH database built from setup.sql gets them too: setup.sql runs only the
-- numbered baseline scripts and never database/migrations/, so the team types previously reached
-- migrated databases only. That gap is not cosmetic -- notification.service.ts's publishEvent()
-- resolves a TypeCode against notify.NotificationTypes and THROWS "Unknown notification type" when
-- it finds nothing, so every team workflow event (a lead change, a member move, a subtask transfer)
-- would fail on a freshly provisioned database while the rest of the app kept working.
--
-- Same TypeCode/CategoryCode/DefaultPriority values as the migration and as
-- backend/src/db/pool.ts's bootstrap list; idempotent, like every other seed script here.
--
-- Terminology note for the copy these types carry: a "Team Lead" is always a per-project, per-team
-- designation held via work.TeamMembers.IsLead -- never an account role (the only account roles are
-- Admin, HR, and Team Member). The same person can lead one project's team and be a plain member of
-- another's, so no recipient of these events may be resolved from iam.Roles alone.

INSERT INTO notify.NotificationTypes (TypeCode, CategoryCode, DefaultPriority, IsMandatory, DefaultEnabled)
VALUES
    -- Project / team membership
    ('team_member_removed_needs_reassignment', 'Project', 'High',   FALSE, TRUE),
    ('team_member_moved',                      'Project', 'High',   FALSE, TRUE),
    ('team_lead_changed',                      'Project', 'High',   FALSE, TRUE),
    -- Task / subtask team ownership
    ('admin_task_needs_team_assignment',       'Task',    'High',   FALSE, TRUE),
    ('subtask_transfer_requested',             'Task',    'High',   FALSE, TRUE),
    ('subtask_transfer_approved',              'Task',    'High',   FALSE, TRUE),
    ('subtask_transfer_rejected',              'Task',    'Normal', FALSE, TRUE)
ON CONFLICT (TypeCode) DO NOTHING;
