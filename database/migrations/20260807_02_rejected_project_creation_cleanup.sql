-- Keep a rejected creation's decision record (especially DecisionReason) after deleting its
-- project. The live proposal is removed immediately; the retained row supports notifications
-- and requester history without creating an archived project or archive notification.
BEGIN;

ALTER TABLE work.projectapprovalrequests
    ADD COLUMN IF NOT EXISTS projecttitle varchar(500);

UPDATE work.projectapprovalrequests request
SET projecttitle = project.projectname
FROM work.projects project
WHERE request.projectid = project.projectid
  AND request.projecttitle IS NULL;

ALTER TABLE work.projectapprovalrequests
    ALTER COLUMN projecttitle SET NOT NULL;

ALTER TABLE work.projectapprovalrequests
    ALTER COLUMN projectid DROP NOT NULL;

ALTER TABLE work.projectapprovalrequests
    DROP CONSTRAINT IF EXISTS fk_projectapprovalrequests_project;
ALTER TABLE work.projectapprovalrequests
    ADD CONSTRAINT fk_projectapprovalrequests_project FOREIGN KEY (projectid)
        REFERENCES work.projects(projectid) ON DELETE SET NULL;

ALTER TABLE work.projectapprovalrequests
    DROP CONSTRAINT IF EXISTS ck_projectapprovalrequests_type;
ALTER TABLE work.projectapprovalrequests
    ADD CONSTRAINT ck_projectapprovalrequests_type CHECK
        (requesttype IN ('PROJECT_CREATE','PROJECT_EDIT','PROJECT_ARCHIVE','PROJECT_DELETE','PROJECT_RESTORE','PROJECT_PERMANENT_DELETE'));

COMMIT;
