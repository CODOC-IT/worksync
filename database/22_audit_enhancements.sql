-- Additive audit-trail fields used by the Activity Log API. Snapshots deliberately preserve
-- readable context after a related user/project/task is renamed or archived.

ALTER TABLE audit.AuditEvents
    ADD COLUMN IF NOT EXISTS ModuleCode varchar(40) NOT NULL DEFAULT 'System',
    ADD COLUMN IF NOT EXISTS Description varchar(1200) NULL,
    ADD COLUMN IF NOT EXISTS ResultCode varchar(20) NOT NULL DEFAULT 'Successful',
    ADD COLUMN IF NOT EXISTS SourceCode varchar(20) NOT NULL DEFAULT 'API',
    ADD COLUMN IF NOT EXISTS IsImportant boolean NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ActorNameSnapshot varchar(200) NULL,
    ADD COLUMN IF NOT EXISTS ActorEmailSnapshot varchar(320) NULL,
    ADD COLUMN IF NOT EXISTS ActorRoleSnapshot varchar(40) NULL,
    ADD COLUMN IF NOT EXISTS AffectedUserIdText varchar(100) NULL,
    ADD COLUMN IF NOT EXISTS AffectedUserNameSnapshot varchar(200) NULL,
    ADD COLUMN IF NOT EXISTS EntityNameSnapshot varchar(300) NULL,
    ADD COLUMN IF NOT EXISTS ProjectNameSnapshot varchar(300) NULL,
    ADD COLUMN IF NOT EXISTS TaskNameSnapshot varchar(300) NULL,
    ADD COLUMN IF NOT EXISTS LinkRoute varchar(120) NULL,
    ADD COLUMN IF NOT EXISTS MetadataJson jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_auditevents_result') THEN
        ALTER TABLE audit.AuditEvents ADD CONSTRAINT CK_AuditEvents_Result
            CHECK (ResultCode IN ('Successful', 'Failed', 'Blocked'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_auditevents_source') THEN
        ALTER TABLE audit.AuditEvents ADD CONSTRAINT CK_AuditEvents_Source
            CHECK (SourceCode IN ('Web', 'API', 'System'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS IX_AuditEvents_FilterFeed
    ON audit.AuditEvents (OrganizationId, OccurredAtUtc DESC, ModuleCode, ActionCode, ResultCode);

CREATE INDEX IF NOT EXISTS IX_AuditEvents_ActorFeed
    ON audit.AuditEvents (ActorUserId, OccurredAtUtc DESC);

CREATE OR REPLACE FUNCTION audit.reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'Audit records are immutable';
END;
$$;

DROP TRIGGER IF EXISTS tr_audit_events_immutable ON audit.AuditEvents;
CREATE TRIGGER tr_audit_events_immutable
BEFORE UPDATE OR DELETE ON audit.AuditEvents
FOR EACH ROW EXECUTE FUNCTION audit.reject_audit_mutation();

DROP TRIGGER IF EXISTS tr_audit_event_changes_immutable ON audit.AuditEventChanges;
CREATE TRIGGER tr_audit_event_changes_immutable
BEFORE UPDATE OR DELETE ON audit.AuditEventChanges
FOR EACH ROW EXECUTE FUNCTION audit.reject_audit_mutation();
