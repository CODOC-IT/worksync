-- Team-scoped discussions in Project Chats.
--
-- A discussion thread can now be scoped to one of a project's teams (the multi-team
-- architecture from 20260816_01_project_teams.sql). A team thread stores TeamId as its single
-- parent column -- exactly like a task-scoped thread stores TaskId -- and its project is derived
-- through the join work.ProjectTeams.ProjectId, never stored redundantly, so the
-- CK_DiscussionThreads_OneParent "exactly one parent" invariant keeps holding.
--
-- Additive and safe to run more than once. Existing project/task threads are untouched (their
-- TeamId stays NULL).

-- 1. The TeamId parent column (nullable, so project/task threads are unaffected).
ALTER TABLE collab.DiscussionThreads
    ADD COLUMN IF NOT EXISTS TeamId bigint NULL;

-- 2. Allow the new 'Team' thread type alongside the existing ones.
ALTER TABLE collab.DiscussionThreads
    DROP CONSTRAINT IF EXISTS CK_DiscussionThreads_Type;
ALTER TABLE collab.DiscussionThreads
    ADD CONSTRAINT CK_DiscussionThreads_Type CHECK
        (ThreadType IN ('Project','Task','Team','ChangeRequest','Attendance','AttendanceCorrection','Leave','Report'));

-- 3. Include TeamId as a parent column in the "exactly one parent" invariant.
ALTER TABLE collab.DiscussionThreads
    DROP CONSTRAINT IF EXISTS CK_DiscussionThreads_OneParent;
ALTER TABLE collab.DiscussionThreads
    ADD CONSTRAINT CK_DiscussionThreads_OneParent CHECK
        ((CASE WHEN ProjectId IS NULL THEN 0 ELSE 1 END) +
         (CASE WHEN TaskId IS NULL THEN 0 ELSE 1 END) +
         (CASE WHEN TeamId IS NULL THEN 0 ELSE 1 END) +
         (CASE WHEN ChangeRequestId IS NULL THEN 0 ELSE 1 END) +
         (CASE WHEN AttendanceRecordId IS NULL THEN 0 ELSE 1 END) +
         (CASE WHEN AttendanceCorrectionId IS NULL THEN 0 ELSE 1 END) +
         (CASE WHEN LeaveRequestId IS NULL THEN 0 ELSE 1 END) +
         (CASE WHEN ReportRunId IS NULL THEN 0 ELSE 1 END) = 1);

-- 4. Foreign key -- mirrors the NO ACTION (no ON DELETE) style of every other
--    collab.DiscussionThreads parent FK (Project/Task/...), so a referenced team cannot be
--    deleted out from under an active discussion (deleting a project cascades to its teams
--    anyway, and that path is already guarded by FK_DiscussionThreads_Project).
ALTER TABLE collab.DiscussionThreads
    ADD CONSTRAINT FK_DiscussionThreads_Team
    FOREIGN KEY (TeamId) REFERENCES work.ProjectTeams(TeamId);

CREATE INDEX IF NOT EXISTS IX_DiscussionThreads_Team
    ON collab.DiscussionThreads(TeamId);