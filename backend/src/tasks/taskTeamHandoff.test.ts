import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { resetPoolForTesting, setPoolForTesting } from '../db/pool.js';
import { createTask } from './task.service.js';
import * as repo from './task.repository.js';

// Covers the Admin -> Team task handoff (§8 of the team workflow) end to end against real SQL and
// the real task.service.ts/task.repository.ts code.
//
// The handoff is the one create that legitimately arrives with NO assignees: an Admin targets a
// whole team, and that team's Lead — not the Admin — decides who does the work. It was unreachable
// before this branch, because `teamHandoff` is defined by having no assignees but was computed
// *after* the "At least one assignee is required" guards, so every such create was rejected before
// the branch could recognize it. These tests pin both halves of the corrected flow: the create that
// now succeeds, and the Lead's later assignment that closes it out.
const db = newDb();
const adapter = db.adapters.createPg();
const pool = new adapter.Pool();

before(async () => {
  setPoolForTesting(pool as unknown as Pool);
  // task.service.ts's HR-assignee guard reads userStore, which only queries the DB (through this
  // same swapped pool) when isDatabaseConfigured() is true — same reasoning as
  // projectTeamManagement.test.ts, whose fixture shape this mirrors.
  process.env.DATABASE_URL = 'postgres://pg-mem@localhost/worksync';
  await pool.query(`
    CREATE SCHEMA org;
    CREATE SCHEMA iam;
    CREATE SCHEMA work;
    CREATE SCHEMA notify;

    CREATE TABLE org.Organizations (
      OrganizationId SERIAL PRIMARY KEY,
      OrganizationCode VARCHAR(30) NOT NULL
    );

    CREATE TABLE org.Departments (
      DepartmentId SERIAL PRIMARY KEY,
      DepartmentName VARCHAR(100) NOT NULL
    );

    CREATE TABLE iam.Users (
      UserId SERIAL PRIMARY KEY,
      OrganizationId INT NOT NULL REFERENCES org.Organizations(OrganizationId),
      DepartmentId INT NULL,
      Email VARCHAR(254) NOT NULL,
      Username VARCHAR(80) NULL,
      DisplayName VARCHAR(170) NOT NULL,
      Designation VARCHAR(100) NULL,
      AccountStatus VARCHAR(20) NOT NULL DEFAULT 'Active',
      InvitationSentAtUtc TIMESTAMPTZ NULL,
      CreatedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      DeactivatedAtUtc TIMESTAMPTZ NULL,
      AuthUserId TEXT NULL
    );

    CREATE TABLE iam.Roles (RoleId SERIAL PRIMARY KEY, RoleCode VARCHAR(40) NOT NULL);
    CREATE TABLE iam.UserRoles (
      UserRoleId BIGSERIAL PRIMARY KEY,
      UserId INT NOT NULL REFERENCES iam.Users(UserId),
      RoleId INT NOT NULL REFERENCES iam.Roles(RoleId),
      RevokedAtUtc TIMESTAMPTZ NULL,
      EndsAtUtc TIMESTAMPTZ NULL
    );
    CREATE TABLE iam.UserCredentials (
      UserId INT PRIMARY KEY REFERENCES iam.Users(UserId),
      PasswordHash BYTEA NULL,
      PasswordAlgorithm VARCHAR(30) NULL
    );

    CREATE TABLE notify.NotificationTypes (
      NotificationTypeId SERIAL PRIMARY KEY,
      TypeCode VARCHAR(50) NOT NULL,
      CategoryCode VARCHAR(30) NOT NULL,
      DefaultPriority VARCHAR(10) NOT NULL
    );

    CREATE TABLE work.ProjectStatuses (
      ProjectStatusId SERIAL PRIMARY KEY,
      StatusCode VARCHAR(30) NOT NULL UNIQUE
    );
    CREATE TABLE work.Priorities (
      PriorityId SERIAL PRIMARY KEY,
      PriorityCode VARCHAR(20) NOT NULL UNIQUE
    );
    CREATE TABLE work.TaskStatuses (
      TaskStatusId SERIAL PRIMARY KEY,
      StatusCode VARCHAR(30) NOT NULL UNIQUE,
      IsCompletedState BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE work.Projects (
      ProjectId SERIAL PRIMARY KEY,
      OrganizationId INT NOT NULL REFERENCES org.Organizations(OrganizationId),
      ProjectCode VARCHAR(30) NOT NULL,
      ProjectName VARCHAR(150) NOT NULL,
      Description VARCHAR(2000) NOT NULL,
      OwnerUserId INT NOT NULL REFERENCES iam.Users(UserId),
      ProjectStatusId SMALLINT NOT NULL REFERENCES work.ProjectStatuses(ProjectStatusId),
      PriorityId SMALLINT NOT NULL REFERENCES work.Priorities(PriorityId),
      StartDate TEXT NOT NULL,
      EndDate TEXT NOT NULL,
      CreatedByUserId INT NOT NULL,
      CreationReason VARCHAR(1000) NULL,
      ArchivedAtUtc TIMESTAMPTZ NULL,
      ArchivedByUserId INT NULL,
      ArchiveReason VARCHAR(500) NULL,
      CreatedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      RowVersion BIGINT NOT NULL DEFAULT 1
    );

    CREATE TABLE work.ProjectMembers (
      ProjectMemberId BIGSERIAL PRIMARY KEY,
      ProjectId INT NOT NULL REFERENCES work.Projects(ProjectId),
      UserId INT NOT NULL REFERENCES iam.Users(UserId),
      MemberRoleCode VARCHAR(30) NOT NULL DEFAULT 'Member',
      AddedByUserId INT NOT NULL,
      JoinedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      LeftAtUtc TIMESTAMPTZ NULL,
      RemovedByUserId INT NULL,
      RemovalReason VARCHAR(500) NULL,
      PendingRemovalAtUtc TIMESTAMPTZ NULL,
      PendingRemovalByUserId INT NULL,
      PendingRemovalReason VARCHAR(500) NULL
    );

    CREATE TABLE work.ProjectTeams (
      TeamId BIGSERIAL PRIMARY KEY,
      ProjectId INT NOT NULL REFERENCES work.Projects(ProjectId),
      TeamName VARCHAR(150) NOT NULL,
      Description VARCHAR(2000) NOT NULL,
      CreatedByUserId INT NOT NULL
    );

    CREATE TABLE work.TeamMembers (
      TeamMemberId BIGSERIAL PRIMARY KEY,
      TeamId BIGINT NOT NULL REFERENCES work.ProjectTeams(TeamId),
      ProjectId INT NOT NULL REFERENCES work.Projects(ProjectId),
      UserId INT NOT NULL REFERENCES iam.Users(UserId),
      IsLead BOOLEAN NOT NULL DEFAULT FALSE,
      AddedByUserId INT NOT NULL,
      LeftAtUtc TIMESTAMPTZ NULL,
      RemovedByUserId INT NULL
    );

    CREATE TABLE work.Tasks (
      TaskId BIGSERIAL PRIMARY KEY,
      ProjectId INT NOT NULL REFERENCES work.Projects(ProjectId),
      ParentTaskId BIGINT NULL,
      TaskNumber INT NOT NULL,
      Title VARCHAR(200) NOT NULL,
      Description VARCHAR(4000) NOT NULL,
      TaskStatusId SMALLINT NOT NULL REFERENCES work.TaskStatuses(TaskStatusId),
      PriorityId SMALLINT NOT NULL REFERENCES work.Priorities(PriorityId),
      StartDate TEXT NULL,
      DueDate TEXT NULL,
      CreatedByUserId INT NOT NULL,
      CompletedAtUtc TIMESTAMPTZ NULL,
      CompletionSummary VARCHAR(2000) NULL,
      ArchivedAtUtc TIMESTAMPTZ NULL,
      ProjectArchivedAtUtc TIMESTAMPTZ NULL,
      TeamId BIGINT NULL,
      AssignmentStatus VARCHAR(30) NULL,
      CreatedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      RowVersion BIGINT NOT NULL DEFAULT 1
    );

    CREATE TABLE work.TaskAssignees (
      TaskAssigneeId BIGSERIAL PRIMARY KEY,
      TaskId BIGINT NOT NULL REFERENCES work.Tasks(TaskId),
      UserId INT NOT NULL REFERENCES iam.Users(UserId),
      AssignedByUserId INT NOT NULL,
      UnassignedAtUtc TIMESTAMPTZ NULL,
      UnassignedByUserId INT NULL
    );

    -- insertTaskBundle records a "Task created" row here in the same transaction as the task, so
    -- this is load-bearing for every create below, not an inert fixture.
    CREATE TABLE work.TaskStatusHistory (
      TaskStatusHistoryId BIGSERIAL PRIMARY KEY,
      TaskId BIGINT NOT NULL,
      FromTaskStatusId SMALLINT NULL,
      ToTaskStatusId SMALLINT NOT NULL,
      ChangedByUserId INT NOT NULL,
      ProgressNote VARCHAR(2000) NULL,
      WorkSummary VARCHAR(2000) NULL,
      AssistanceRequired VARCHAR(1000) NULL,
      ChangedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Only ever read by TASK_COLUMNS' haspendingeditapproval subquery; stays empty.
    CREATE TABLE work.ChangeRequestTypes (
      ChangeRequestTypeId SERIAL PRIMARY KEY,
      TypeCode VARCHAR(40) NOT NULL
    );
    CREATE TABLE work.TaskChangeRequests (
      ChangeRequestId BIGSERIAL PRIMARY KEY,
      TaskId BIGINT NOT NULL REFERENCES work.Tasks(TaskId),
      ChangeRequestTypeId INT NOT NULL REFERENCES work.ChangeRequestTypes(ChangeRequestTypeId),
      RequestStatus VARCHAR(20) NOT NULL,
      CancelledAtUtc TIMESTAMPTZ NULL,
      RequestReason VARCHAR(500) NULL
    );

    INSERT INTO org.Organizations (OrganizationId, OrganizationCode) VALUES (1, 'ORG');

    -- 1 = Admin, 2 = Backend Team's Lead, 3 = Backend Team member, 4 = Frontend Team's Lead,
    -- 5 = Frontend Team member.
    INSERT INTO iam.Users (UserId, OrganizationId, Email, DisplayName) VALUES
      (1, 1, 'admin@worksync.test', 'Admin Ahmed'),
      (2, 1, 'lead-be@worksync.test', 'Maryam Ahmed'),
      (3, 1, 'member-be@worksync.test', 'Bilal Ahmed'),
      (4, 1, 'lead-fe@worksync.test', 'Frontend Lead'),
      (5, 1, 'member-fe@worksync.test', 'Frontend Member');

    INSERT INTO notify.NotificationTypes (TypeCode, CategoryCode, DefaultPriority) VALUES
      ('admin_task_needs_team_assignment', 'Task', 'High'),
      ('task_assigned', 'Task', 'High'),
      ('task_reassigned', 'Task', 'High'),
      ('subtask_assigned', 'Task', 'High'),
      ('subtask_assignment_changed', 'Task', 'High');

    INSERT INTO work.ProjectStatuses (ProjectStatusId, StatusCode) VALUES (1, 'Active');
    INSERT INTO work.Priorities (PriorityId, PriorityCode) VALUES (1, 'Medium'), (2, 'High');
    INSERT INTO work.TaskStatuses (TaskStatusId, StatusCode, IsCompletedState) VALUES
      (1, 'Todo', FALSE), (2, 'Done', TRUE);

    INSERT INTO work.Projects
      (ProjectId, OrganizationId, ProjectCode, ProjectName, Description, OwnerUserId,
       ProjectStatusId, PriorityId, StartDate, EndDate, CreatedByUserId)
    VALUES
      (1, 1, 'PROJ-1', 'ERP Management System', 'A multi-team project.', 2,
       1, 1, '2026-01-01', '2026-12-31', 1);

    INSERT INTO work.ProjectMembers (ProjectId, UserId, MemberRoleCode, AddedByUserId) VALUES
      (1, 2, 'TeamLead', 1),
      (1, 3, 'Member', 1),
      (1, 4, 'TeamLead', 1),
      (1, 5, 'Member', 1);

    INSERT INTO work.ProjectTeams (TeamId, ProjectId, TeamName, Description, CreatedByUserId) VALUES
      (1, 1, 'Backend Team', 'Backend API development and database integration.', 1),
      (2, 1, 'Frontend Team', 'Frontend delivery.', 1);

    INSERT INTO work.TeamMembers (TeamId, ProjectId, UserId, IsLead, AddedByUserId) VALUES
      (1, 1, 2, TRUE, 1),
      (1, 1, 3, FALSE, 1),
      (2, 1, 4, TRUE, 1),
      (2, 1, 5, FALSE, 1);
  `);
});

after(async () => {
  resetPoolForTesting();
  delete process.env.DATABASE_URL;
  await pool.end();
});

const baseTask = {
  projectId: 'prj-1',
  description: 'Integrate the third-party billing API.',
  priority: 'High' as const,
  startDate: '2026-02-01',
  dueDate: '2026-03-01'
};

// createTask ends by re-reading the task it just wrote through repo.findTaskById, whose SELECT
// carries three correlated subqueries against the outer `t` alias (subtask tallies and the pending-
// edit-approval EXISTS). pg-mem cannot resolve an outer alias inside those and fails the read with
// `column "t.taskid" does not exist` — the same class of emulator gap already documented on
// notification.repository.test.ts, and not something the production query gets wrong.
//
// The subject of these tests is the VALIDATION AND WRITE that happen before that read, so the read
// is allowed to fail and the assertions are made against the database directly. Anything that
// throws before the write still surfaces: `expectWritten` re-throws every error except this one.
const createTaskIgnoringFinalRead = async (
  input: Parameters<typeof createTask>[0],
  actorId: string,
  actorRole: string
): Promise<void> => {
  try {
    await createTask(input, actorId, actorRole);
  } catch (error) {
    const message = (error as Error).message || '';
    if (!/column "t\.taskid" does not exist/.test(message)) throw error;
  }
};

// --- The handoff create (§8) --------------------------------------------------------------------

test('an Admin can create a task for a whole team, with no individual assignee', async () => {
  // The exact shape that was previously rejected outright by "At least one assignee is required",
  // before the handoff branch could ever be reached. Reaching the write at all is the assertion.
  await createTaskIgnoringFinalRead(
    { ...baseTask, title: 'API Integration', teamId: 'tm-1', assigneeIds: [] },
    'usr-1',
    'Admin'
  );

  const row = await pool.query(
    `SELECT teamid, assignmentstatus FROM work.tasks WHERE title = 'API Integration'`
  );
  assert.deepEqual(
    row.rows,
    [{ teamid: 1, assignmentstatus: 'NeedsTeamAssignment' }],
    'the task is owned by the targeted team and flagged as awaiting that team\'s assignment'
  );
});

test('a task an Admin targets at a team has no assignee rows at all', async () => {
  const assignees = await pool.query(
    `SELECT ta.userid FROM work.taskassignees ta
       JOIN work.tasks t ON t.taskid = ta.taskid
      WHERE t.title = 'API Integration'`
  );
  assert.deepEqual(assignees.rows, [], 'the Admin must not be able to pick the individual (§8)');
});

// --- The guards that must still hold ------------------------------------------------------------

test('a non-Admin still cannot create a task with no assignee', async () => {
  // The relaxation is scoped to the Admin handoff only — a Team Lead creating for their own team
  // must still name someone, exactly as before.
  await assert.rejects(
    () => createTask(
      { ...baseTask, title: 'Lead task with nobody', teamId: 'tm-1', assigneeIds: [] },
      'usr-2',
      'Team_Lead'
    ),
    /At least one assignee is required/
  );
});

test('an Admin still cannot create an untargeted task with no assignee', async () => {
  // No teamId means this is not a handoff, so the original guard applies unchanged.
  await assert.rejects(
    () => createTask({ ...baseTask, title: 'Nobody at all', assigneeIds: [] }, 'usr-1', 'Admin'),
    /At least one assignee is required/
  );
});

test('an Admin creating for named assignees is unaffected and lands in their team', async () => {
  await createTaskIgnoringFinalRead(
    { ...baseTask, title: 'Directly assigned task', assigneeIds: ['usr-3'] },
    'usr-1',
    'Admin'
  );

  const row = await pool.query(
    `SELECT teamid, assignmentstatus FROM work.tasks WHERE title = 'Directly assigned task'`
  );
  assert.deepEqual(
    row.rows,
    [{ teamid: 1, assignmentstatus: 'Assigned' }],
    'a directly assigned task is Assigned from the start, never NeedsTeamAssignment'
  );

  const assignees = await pool.query(
    `SELECT ta.userid FROM work.taskassignees ta
       JOIN work.tasks t ON t.taskid = ta.taskid
      WHERE t.title = 'Directly assigned task' AND ta.unassignedatutc IS NULL`
  );
  assert.deepEqual(assignees.rows, [{ userid: 3 }], 'the named assignee is still written as before');
});

test('assignees from outside the task\'s team are still rejected (§11)', async () => {
  // usr-5 is on the Frontend Team; the task's team is resolved from the first assignee, so mixing
  // teams must fail rather than silently splitting a task across two teams.
  await assert.rejects(
    () => createTask(
      { ...baseTask, title: 'Cross-team task', assigneeIds: ['usr-3', 'usr-5'] },
      'usr-1',
      'Admin'
    ),
    /must belong to the task's team/
  );
});

// --- The Team Lead closing the handoff ----------------------------------------------------------

// The Team Lead's side of the handoff is exercised at the repository level rather than through
// task.service.ts's updateTask, for the same findTaskById reason as above — updateTask both reads
// the task first (to authorize) and re-reads it after. repo.updateTask is where the state change
// being verified actually lives, so testing it directly loses nothing that matters here.

const taskIdByTitle = async (title: string): Promise<number> => {
  const found = await pool.query(`SELECT taskid FROM work.tasks WHERE title = $1`, [title]);
  assert.equal(found.rows.length, 1, `expected exactly one task titled "${title}"`);
  return (found.rows[0] as { taskid: number }).taskid;
};

test('the receiving Team Lead assigning the task clears NeedsTeamAssignment', async () => {
  const taskId = await taskIdByTitle('API Integration');
  const before = await pool.query(`SELECT assignmentstatus FROM work.tasks WHERE taskid = $1`, [taskId]);
  assert.equal(
    (before.rows[0] as { assignmentstatus: string }).assignmentstatus,
    'NeedsTeamAssignment',
    'precondition: the handed-off task starts out awaiting its team\'s assignment'
  );

  await repo.updateTask(taskId, {}, [3], 2); // Maryam (the Backend Lead) assigns Bilal

  const after = await pool.query(`SELECT assignmentstatus FROM work.tasks WHERE taskid = $1`, [taskId]);
  assert.equal(
    (after.rows[0] as { assignmentstatus: string }).assignmentstatus,
    'Assigned',
    'nothing cleared this flag before, so a handed-off task stayed "awaiting assignment" forever'
  );

  const assignees = await pool.query(
    `SELECT userid FROM work.taskassignees WHERE taskid = $1 AND unassignedatutc IS NULL`,
    [taskId]
  );
  assert.deepEqual(assignees.rows, [{ userid: 3 }]);
});

test('an ordinary reassignment does not resurrect or alter AssignmentStatus', async () => {
  const taskId = await taskIdByTitle('Directly assigned task');

  await repo.updateTask(taskId, {}, [2], 2);

  const after = await pool.query(`SELECT assignmentstatus FROM work.tasks WHERE taskid = $1`, [taskId]);
  assert.equal(
    (after.rows[0] as { assignmentstatus: string }).assignmentstatus,
    'Assigned',
    'the write is scoped to the NeedsTeamAssignment state and must not touch anything else'
  );
});

test('an update that changes no assignees leaves AssignmentStatus untouched', async () => {
  const taskId = await taskIdByTitle('API Integration');

  await repo.updateTask(taskId, { title: 'API Integration' }, undefined, 2);

  const after = await pool.query(`SELECT assignmentstatus FROM work.tasks WHERE taskid = $1`, [taskId]);
  assert.equal((after.rows[0] as { assignmentstatus: string }).assignmentstatus, 'Assigned');
});
