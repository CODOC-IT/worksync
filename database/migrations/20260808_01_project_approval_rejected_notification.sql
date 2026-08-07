-- Adds the project_approval_rejected notification type, seeded for databases created before it
-- existed. notificationService.publishEvent() requires the type to already exist before
-- projectApproval.service.ts can publish it, and an existing database won't re-run the baseline
-- seed file (database/18_notify_seed.sql).
--
-- Safe to run more than once. No table changes -- DetailText/MetadataJson on notify.Notifications
-- already exist (see 20260807_01_notification_detail_metadata.sql); this is data-only.

BEGIN;

INSERT INTO notify.NotificationTypes (TypeCode, CategoryCode, DefaultPriority, IsMandatory, DefaultEnabled)
VALUES
    ('project_approval_rejected', 'Project', 'High', FALSE, TRUE)
ON CONFLICT (TypeCode) DO NOTHING;

COMMIT;
