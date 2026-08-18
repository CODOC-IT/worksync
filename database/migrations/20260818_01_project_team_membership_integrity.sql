-- Project membership is the access-control source of truth. A person may be assigned to a
-- project team only while they have a live work.ProjectMembers row for that same project.
--
-- This migration first repairs existing team-only memberships, then makes the relationship
-- durable for every API path and direct database write. Pending project removals intentionally
-- keep LeftAtUtc NULL, so their team membership remains active until removal is final.

BEGIN;

-- Repair historical drift. A team lead is restored as a TeamLead project member; everyone else
-- is restored as a standard Member. The TeamMembers creator is retained as the audit actor.
INSERT INTO work.projectmembers (projectid, userid, memberrolecode, addedbyuserid)
SELECT
    team_member.projectid,
    team_member.userid,
    CASE WHEN team_member.islead THEN 'TeamLead' ELSE 'Member' END,
    team_member.addedbyuserid
FROM work.teammembers AS team_member
WHERE team_member.leftatutc IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM work.projectmembers AS project_member
      WHERE project_member.projectid = team_member.projectid
        AND project_member.userid = team_member.userid
        AND project_member.leftatutc IS NULL
  );

CREATE OR REPLACE FUNCTION work.require_active_project_member_for_team_member()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.leftatutc IS NOT NULL THEN
        RETURN NEW;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM work.projectteams AS team
        WHERE team.teamid = NEW.teamid
          AND team.projectid = NEW.projectid
    ) THEN
        RAISE EXCEPTION 'Team % does not belong to project %.', NEW.teamid, NEW.projectid;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM work.projectmembers AS project_member
        WHERE project_member.projectid = NEW.projectid
          AND project_member.userid = NEW.userid
          AND project_member.leftatutc IS NULL
    ) THEN
        RAISE EXCEPTION 'User % must be an active member of project % before joining a team.',
            NEW.userid, NEW.projectid;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_teammembers_require_project_member ON work.teammembers;
CREATE TRIGGER tr_teammembers_require_project_member
BEFORE INSERT OR UPDATE OF teamid, projectid, userid, leftatutc ON work.teammembers
FOR EACH ROW
EXECUTE FUNCTION work.require_active_project_member_for_team_member();

-- Ending a project membership must end every active team membership in the same transaction,
-- including removals made outside project.repository.ts.
CREATE OR REPLACE FUNCTION work.end_team_memberships_on_project_removal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.leftatutc IS NULL AND NEW.leftatutc IS NOT NULL THEN
        UPDATE work.teammembers
        SET leftatutc = NEW.leftatutc,
            removedbyuserid = NEW.removedbyuserid
        WHERE projectid = NEW.projectid
          AND userid = NEW.userid
          AND leftatutc IS NULL;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_projectmembers_end_team_memberships ON work.projectmembers;
CREATE TRIGGER tr_projectmembers_end_team_memberships
AFTER UPDATE OF leftatutc ON work.projectmembers
FOR EACH ROW
WHEN (OLD.leftatutc IS NULL AND NEW.leftatutc IS NOT NULL)
EXECUTE FUNCTION work.end_team_memberships_on_project_removal();

COMMIT;
