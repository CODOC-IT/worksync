-- Installs the Notification Center's compact-preview / expanded-detail storage and the
-- notification types added alongside the task-edit approval and leave workflows, for databases
-- created before database/29_notify_detail_metadata.sql existed. A database installed from the
-- current one-time baseline (database/setup.sql) already has all of this.
--
-- Purely additive and safe to run more than once: two nullable columns and seven seed rows.
-- Existing notifications keep NULL DetailText/MetadataJson and simply render their compact
-- preview with no expanded body, exactly as they did before.

BEGIN;

ALTER TABLE notify.Notifications
    ADD COLUMN IF NOT EXISTS DetailText varchar(4000) NULL;

ALTER TABLE notify.Notifications
    ADD COLUMN IF NOT EXISTS MetadataJson jsonb NULL;

-- notificationService.publishEvent() refuses to publish a type that has no NotificationTypes
-- row, so these must exist before the new task-edit/leave triggers can fire.
INSERT INTO notify.NotificationTypes (TypeCode, CategoryCode, DefaultPriority, IsMandatory, DefaultEnabled)
VALUES
    ('task_edit_approval_requested', 'Approval',   'High',   FALSE, TRUE),
    ('task_edit_approval_approved',  'Task',       'High',   FALSE, TRUE),
    ('task_edit_approval_rejected',  'Task',       'High',   FALSE, TRUE),
    ('subtask_assignment_changed',   'Task',       'High',   FALSE, TRUE),
    ('leave_requested',              'Attendance', 'Normal', FALSE, TRUE),
    ('leave_approved',               'Attendance', 'Normal', FALSE, TRUE),
    ('leave_rejected',               'Attendance', 'Normal', FALSE, TRUE)
ON CONFLICT (TypeCode) DO NOTHING;

COMMIT;
