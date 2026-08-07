-- Seeds the notification types the Profile module's notification workflow needs, for databases
-- created before they existed. notificationService.publishEvent() requires the type to already
-- exist, and an existing database won't re-run the baseline seed file (database/18_notify_seed.sql).
--
-- account_change_request_approved / account_change_request_rejected replace the generic
-- 'approval' type previously used for the decision on an HR/Lead/Member's account change
-- request, so the notification can carry the reviewer's name, the field that was changed, and
-- (on rejection) the mandatory reason in a proper expanded-detail body instead of a one-line
-- preview. account_profile_updated covers an Admin's own direct username/display-name edit
-- (password/email reuse the existing, previously-unwired security_alert type — no new type
-- needed for those two).
--
-- Safe to run more than once. No table changes -- data-only.

BEGIN;

INSERT INTO notify.NotificationTypes (TypeCode, CategoryCode, DefaultPriority, IsMandatory, DefaultEnabled)
VALUES
    ('account_change_request_approved', 'System', 'Normal', FALSE, TRUE),
    ('account_change_request_rejected', 'System', 'High',   FALSE, TRUE),
    ('account_profile_updated',         'System', 'Normal', FALSE, TRUE)
ON CONFLICT (TypeCode) DO NOTHING;

COMMIT;
