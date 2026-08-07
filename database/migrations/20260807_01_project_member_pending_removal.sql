-- Installs the "Pending Removal" member workflow (Issue #6) in existing WorkSync databases.
-- database/04_work_tables.sql already installs the ProjectMembers columns below for databases
-- created from the current one-time baseline; database/18_notify_seed.sql already seeds the two
-- new notify.NotificationTypes rows there too. An existing database won't re-run either baseline
-- file, so both are repeated here, additive and safe to run more than once.

BEGIN;

ALTER TABLE work.ProjectMembers ADD COLUMN IF NOT EXISTS PendingRemovalAtUtc timestamptz(0) NULL;
ALTER TABLE work.ProjectMembers ADD COLUMN IF NOT EXISTS PendingRemovalByUserId INT NULL;
ALTER TABLE work.ProjectMembers ADD COLUMN IF NOT EXISTS PendingRemovalReason varchar(500) NULL;

ALTER TABLE work.ProjectMembers DROP CONSTRAINT IF EXISTS CK_ProjectMembers_PendingRemoval;
ALTER TABLE work.ProjectMembers ADD CONSTRAINT CK_ProjectMembers_PendingRemoval CHECK
        ((PendingRemovalAtUtc IS NULL AND PendingRemovalByUserId IS NULL) OR
         (PendingRemovalAtUtc IS NOT NULL AND PendingRemovalByUserId IS NOT NULL));

ALTER TABLE work.ProjectMembers DROP CONSTRAINT IF EXISTS FK_ProjectMembers_PendingRemovalBy;
ALTER TABLE work.ProjectMembers
    ADD CONSTRAINT FK_ProjectMembers_PendingRemovalBy FOREIGN KEY (PendingRemovalByUserId)
        REFERENCES iam.Users(UserId);

INSERT INTO notify.NotificationTypes (TypeCode, CategoryCode, DefaultPriority, IsMandatory, DefaultEnabled)
VALUES
    ('project_member_pending_removal', 'Project', 'Normal', FALSE, TRUE),
    ('project_member_auto_removed',    'Project', 'Normal', FALSE, TRUE)
ON CONFLICT (TypeCode) DO NOTHING;

COMMIT;
