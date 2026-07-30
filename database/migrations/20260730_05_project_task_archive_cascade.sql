-- Existing-database rollout for project-driven task archiving.
--
-- ArchivedAtUtc remains the task's own soft-delete marker. ProjectArchivedAtUtc is separate so
-- restoring a project restores only tasks archived by that project and never resurrects tasks
-- that were explicitly deleted beforehand.
ALTER TABLE work.Tasks
    ADD COLUMN IF NOT EXISTS ProjectArchivedAtUtc timestamptz(0) NULL;

UPDATE work.Tasks t
SET ProjectArchivedAtUtc = p.ArchivedAtUtc,
    UpdatedAtUtc = CURRENT_TIMESTAMP,
    RowVersion = t.RowVersion + 1
FROM work.Projects p
WHERE p.ProjectId = t.ProjectId
  AND p.ArchivedAtUtc IS NOT NULL
  AND t.ArchivedAtUtc IS NULL
  AND t.ProjectArchivedAtUtc IS NULL;

CREATE INDEX IF NOT EXISTS IX_Tasks_ProjectArchive
    ON work.Tasks(ProjectId, ProjectArchivedAtUtc)
    WHERE ArchivedAtUtc IS NULL;

-- Audit rows are immutable snapshots. Retain their historical TaskId values after a task is
-- removed with its permanently-deleted project, matching the existing ProjectId policy.
ALTER TABLE audit.AuditEvents DROP CONSTRAINT IF EXISTS FK_AuditEvents_Task;
