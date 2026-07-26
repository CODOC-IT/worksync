-- Additive enhancements to the notify schema for: snooze ("remind me later") and email
-- delivery tracking (digest/critical-immediate email — see docs/Notification_Module_Guide.md
-- Section 10). Both are ALTER TABLE ADD COLUMN, never a redefinition of an existing column or
-- constraint — 10_notify_tables.sql stays the source of truth for the original shape.

-- Set by PATCH /notifications/:id/snooze. While in the future, findByUser excludes this row from
-- the default (non-snoozed) view — the same "hide without deleting" shape as ClearedAtUtc, just
-- time-bound instead of permanent.
ALTER TABLE notify.UserNotifications
    ADD COLUMN IF NOT EXISTS SnoozedUntilUtc timestamptz(0) NULL;

-- Set once an email has actually been sent for this recipient's copy of the notification, either
-- immediately (Critical priority) or by the periodic digest job (High priority). NULL means "not
-- yet emailed", not "will never be emailed" — see notification.email.ts.
ALTER TABLE notify.UserNotifications
    ADD COLUMN IF NOT EXISTS EmailedAtUtc timestamptz(0) NULL;
