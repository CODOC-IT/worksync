-- Case-insensitive account identity constraints for server-side account provisioning.
-- Apply after 20260730_01_account_provisioning_schema.sql.

BEGIN;

-- New writes are normalized by the service. Lowercase existing values where doing so is
-- unambiguous so the stored representation and lookup behavior remain consistent.
UPDATE iam.Users SET Email = lower(btrim(Email)) WHERE Email <> lower(btrim(Email));
UPDATE iam.Users SET Username = lower(btrim(Username)) WHERE Username <> lower(btrim(Username));

CREATE UNIQUE INDEX IF NOT EXISTS UX_Users_Organization_Email_CI
    ON iam.Users (OrganizationId, lower(Email));

CREATE UNIQUE INDEX IF NOT EXISTS UX_Users_Organization_Username_CI
    ON iam.Users (OrganizationId, lower(Username));

COMMIT;
