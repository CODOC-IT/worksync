-- Backfills work.TaskAssignees for the 8 demo tasks seeded by 18_notify_seed.sql, which only
-- ever populated work.Tasks (to satisfy notify.* FK constraints) and never the assignee rows
-- those tasks need for the real Task Module backend (feature/backend-project-board-notification)
-- -- without this, every task's assigneeId/assigneeIds comes back empty, breaking both the
-- Kanban board's per-assignee filtering and canEditTask-style authorization. Data only -- no
-- schema change. Mirrors frontend/src/mock-data/fixtures.ts's INITIAL_TASKS assigneeId exactly.
--
-- Idempotent via WHERE NOT EXISTS, same reasoning as 20_project_members_backfill.sql --
-- work.TaskAssignees has no natural unique constraint on (TaskId, UserId) to conflict against.

DO $$
DECLARE
    assignment record;
BEGIN
    FOR assignment IN
        SELECT * FROM (VALUES
            -- (TaskId, UserId)
            (101, 4), (102, 4), (103, 5), (104, 4), (105, 7), (106, 2), (107, 5), (108, 7)
        ) AS t(taskid, userid)
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM work.TaskAssignees
            WHERE TaskId = assignment.taskid
              AND UserId = assignment.userid
              AND UnassignedAtUtc IS NULL
        ) THEN
            INSERT INTO work.TaskAssignees (TaskId, UserId, AssignedByUserId)
            VALUES (assignment.taskid, assignment.userid, assignment.userid);
        END IF;
    END LOOP;
END $$;
