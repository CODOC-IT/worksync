-- Backfills work.ProjectMembers for the 6 demo projects seeded by 18_notify_seed.sql, which
-- only ever populated work.Projects (to satisfy notify.* FK constraints) and never the
-- membership rows those projects need for real role-based access (Project Module backend,
-- feature/backend-project-board-notification). Data only — no schema change. Mirrors
-- frontend/src/mock-data/fixtures.ts's INITIAL_PROJECTS teamLeadId/memberIds exactly, so the
-- real API's role-scoped visibility matches what every existing demo user already expects to
-- see.
--
-- Idempotent via WHERE NOT EXISTS rather than ON CONFLICT: work.ProjectMembers has no natural
-- unique constraint on (ProjectId, UserId) to conflict against (a user could theoretically
-- rejoin a project they left, hence no such constraint in the original schema) — the app-level
-- rule enforced by project.repository.ts is "no existing row with LeftAtUtc IS NULL", which
-- this mirrors.

DO $$
DECLARE
    membership record;
BEGIN
    FOR membership IN
        SELECT * FROM (VALUES
            -- (ProjectId, UserId, RoleCode)
            (1, 1, 'Owner'),    (1, 2, 'TeamLead'), (1, 4, 'Member'), (1, 5, 'Member'), (1, 7, 'Member'),
            (2, 1, 'Owner'),    (2, 6, 'TeamLead'), (2, 5, 'Member'), (2, 4, 'Member'),
            (3, 3, 'Owner'),    (3, 2, 'TeamLead'), (3, 4, 'Member'), (3, 8, 'Member'),
            (4, 2, 'Owner'),    (4, 7, 'Member'),
            (5, 1, 'Owner'),    (5, 2, 'TeamLead'), (5, 7, 'Member'),
            (6, 1, 'Owner'),    (6, 2, 'TeamLead'), (6, 4, 'Member')
        ) AS t(projectid, userid, rolecode)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM work.ProjectMembers
            WHERE ProjectId = membership.projectid
              AND UserId = membership.userid
              AND LeftAtUtc IS NULL
        ) THEN
            INSERT INTO work.ProjectMembers (ProjectId, UserId, MemberRoleCode, AddedByUserId)
            VALUES (membership.projectid, membership.userid, membership.rolecode, membership.userid);
        END IF;
    END LOOP;
END $$;
