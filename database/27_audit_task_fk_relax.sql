-- audit.AuditEvents is immutable, so a hard-deleted task cannot update or remove its audit rows.
-- Keep historical TaskId snapshots after project/task deletion by removing the live FK, matching
-- database/24_audit_project_fk_relax.sql's existing ProjectId treatment.
ALTER TABLE audit.AuditEvents DROP CONSTRAINT IF EXISTS FK_AuditEvents_Task;
