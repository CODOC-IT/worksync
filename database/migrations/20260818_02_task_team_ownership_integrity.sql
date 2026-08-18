-- A team-owned task must retain a valid owning team.  Task assignees then derive from that
-- ownership: active ProjectMembers who are active TeamMembers of the task's exact team.
-- Legacy tasks without TeamId remain supported by the existing project-lead workflow.

BEGIN;

-- Subtasks created before TeamId was consistently inherited should follow their parent's team.
UPDATE work.tasks AS child
SET teamid = parent.teamid,
    assignmentstatus = COALESCE(child.assignmentstatus, parent.assignmentstatus)
FROM work.tasks AS parent
WHERE child.parenttaskid = parent.taskid
  AND child.teamid IS NULL
  AND parent.teamid IS NOT NULL;

-- Existing team tasks predate the AssignmentStatus transition in some environments. Infer the
-- correct state once from their active assignees before enforcing the state/team pairing.
UPDATE work.tasks AS task
SET assignmentstatus = CASE
    WHEN EXISTS (
        SELECT 1 FROM work.taskassignees AS assignee
        WHERE assignee.taskid = task.taskid AND assignee.unassignedatutc IS NULL
    ) THEN 'Assigned'
    ELSE 'NeedsTeamAssignment'
END
WHERE task.teamid IS NOT NULL
  AND task.assignmentstatus IS NULL;

UPDATE work.tasks
SET assignmentstatus = NULL
WHERE teamid IS NULL
  AND assignmentstatus IS NOT NULL;

-- A composite key makes it impossible for a task to reference a team from another project.
DO $$
BEGIN
    ALTER TABLE work.projectteams
        ADD CONSTRAINT uq_projectteams_project_team UNIQUE (projectid, teamid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE work.tasks
        ADD CONSTRAINT fk_tasks_project_team
        FOREIGN KEY (projectid, teamid)
        REFERENCES work.projectteams (projectid, teamid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE work.tasks
        ADD CONSTRAINT ck_tasks_team_assignment_integrity CHECK (
            (teamid IS NULL AND assignmentstatus IS NULL)
            OR (teamid IS NOT NULL AND assignmentstatus IN ('NeedsTeamAssignment', 'Assigned'))
        );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Once a task has been handed to a team, it cannot become an unowned task again. The approved
-- subtask transfer workflow may change TeamId to another valid team, which the composite FK
-- verifies belongs to the same project.
CREATE OR REPLACE FUNCTION work.prevent_task_team_ownership_removal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.teamid IS NOT NULL AND NEW.teamid IS NULL THEN
        RAISE EXCEPTION 'A team-owned task cannot lose its owning team.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_tasks_prevent_team_ownership_removal ON work.tasks;
CREATE TRIGGER tr_tasks_prevent_team_ownership_removal
BEFORE UPDATE OF teamid ON work.tasks
FOR EACH ROW
EXECUTE FUNCTION work.prevent_task_team_ownership_removal();

CREATE OR REPLACE FUNCTION work.require_valid_task_assignee()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    task_project_id integer;
    task_team_id bigint;
BEGIN
    SELECT projectid, teamid
    INTO task_project_id, task_team_id
    FROM work.tasks
    WHERE taskid = NEW.taskid;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task % does not exist.', NEW.taskid;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM work.projectmembers AS member
        WHERE member.projectid = task_project_id
          AND member.userid = NEW.userid
          AND member.leftatutc IS NULL
    ) THEN
        RAISE EXCEPTION 'Task assignee % must be an active member of project %.', NEW.userid, task_project_id;
    END IF;

    IF task_team_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM work.teammembers AS member
        WHERE member.projectid = task_project_id
          AND member.teamid = task_team_id
          AND member.userid = NEW.userid
          AND member.leftatutc IS NULL
    ) THEN
        RAISE EXCEPTION 'Task assignee % must belong to task team %.', NEW.userid, task_team_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_taskassignees_require_task_membership ON work.taskassignees;
CREATE TRIGGER tr_taskassignees_require_task_membership
BEFORE INSERT OR UPDATE OF taskid, userid ON work.taskassignees
FOR EACH ROW
EXECUTE FUNCTION work.require_valid_task_assignee();

COMMIT;
