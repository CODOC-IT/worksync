-- Additive enhancements to the notify schema for the Notification Center's compact-preview /
-- expanded-detail split, plus the notification types introduced alongside the task-edit approval
-- and leave workflows. Same shape as 19_notify_enhancements.sql: only ALTER TABLE ADD COLUMN and
-- INSERT ... ON CONFLICT DO NOTHING — 10_notify_tables.sql stays the source of truth for the
-- original table definitions.

-- SafePreviewText remains the *compact* one-or-two-line summary rendered in the notification
-- list. DetailText is the full body shown only once a notification is expanded (rejection
-- reasons, the exact fields a task edit changed, review comments). Splitting them at the data
-- layer — rather than truncating one long string in the UI — means the list stays scannable
-- without the backend ever having to send two different records for the same event.
ALTER TABLE notify.Notifications
    ADD COLUMN IF NOT EXISTS DetailText varchar(4000) NULL;

-- Structured context for the expanded view: project name, task/subtask title, requester or
-- approver name, changed field list, leave type/period, and so on. jsonb (not a set of typed
-- columns) because the keys are per-notification-type and adding a new event must not require a
-- migration. Read-only as far as the API is concerned — nothing queries inside it, it is only
-- ever written at publish time and rendered back verbatim.
ALTER TABLE notify.Notifications
    ADD COLUMN IF NOT EXISTS MetadataJson jsonb NULL;

-- New notification types. Same CategoryCode conventions as database/18_notify_seed.sql:
-- CategoryCode drives both role-based delivery and the deep link the Notification Center uses to
-- jump to the owning tab (see backend/src/notifications/notification.mapper.ts's
-- deriveLinkRoute), so a task-edit *request* is an Approval (it belongs in the Approvals inbox)
-- while its approved/rejected outcome is a Task event (it belongs on the task itself).
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
