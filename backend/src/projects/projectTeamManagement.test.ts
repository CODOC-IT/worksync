import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { resetPoolForTesting, setPoolForTesting } from '../db/pool.js';
import { moveMember, replaceTeamLead } from './project.service.js';

// Covers Admin's two multi-team management actions end to end, against real SQL and the real
// project.service.ts/project.repository.ts code:
//   - replaceTeamLead: including the confirmed defect where a replacement already on a *different*
//     team of the same project used to fall through to a raw Postgres 23505 unique-violation
//     (UQ_TeamMembers_Project_User) instead of a clean ProjectValidationError.
//   - moveMember: the existing, previously-untested moveTeamMember path.
const db = newDb();
const adapter = db.adapters.createPg();
const pool = new adapter.Pool();

before(async () => {
  setPoolForTesting(pool as unknown as Pool);
  // replaceTeamLead's assertEligibleAssignee reads userStore.getAllUsers(), which only queries the
  // DB (via this same swapped pool) when isDatabaseConfigured() is true -- same reasoning as
  // project.memberRemoval.test.ts. The extra iam.Roles/iam.UserRoles/org.Departments/
  // iam.UserCredentials tables below exist only because userStore's USER_QUERY LEFT JOINs against
  // all of them; every join is LEFT, so they can stay empty.
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

    CREATE TABLE iam.Roles (
      RoleId SERIAL PRIMARY KEY,
      RoleCode VARCHAR(40) NOT NULL
    );

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

    -- Tasks/assignees are no longer inert fixtures here: replaceTeamLead reassigns the outgoing
    -- lead's open work to the incoming one, and moveMember reads what a moved member leaves behind
    -- for their previous Team Lead, so both read these tables for real.
    CREATE TABLE work.TaskStatuses (
      TaskStatusId SERIAL PRIMARY KEY,
      StatusCode VARCHAR(30) NOT NULL UNIQUE,
      IsCompletedState BOOLEAN NOT NULL DEFAULT FALSE
    );

    CREATE TABLE work.Tasks (
      TaskId BIGSERIAL PRIMARY KEY,
      ProjectId INT NOT NULL REFERENCES work.Projects(ProjectId),
      ParentTaskId BIGINT NULL,
      Title VARCHAR(200) NOT NULL,
      TaskStatusId SMALLINT NOT NULL REFERENCES work.TaskStatuses(TaskStatusId),
      ArchivedAtUtc TIMESTAMPTZ NULL
    );

    CREATE TABLE work.TaskAssignees (
      TaskAssigneeId BIGSERIAL PRIMARY KEY,
      TaskId BIGINT NOT NULL REFERENCES work.Tasks(TaskId),
      UserId INT NOT NULL REFERENCES iam.Users(UserId),
      AssignedByUserId INT NOT NULL,
      UnassignedAtUtc TIMESTAMPTZ NULL,
      UnassignedByUserId INT NULL
    );

    INSERT INTO org.Organizations (OrganizationId, OrganizationCode) VALUES (1, 'ORG');

    -- 1 = Admin, 2 = Team A lead (Owner), 3 = Team A member, 5 = Team B lead, 6 = Team B member,
    -- 99 = not a member of any project.
    INSERT INTO iam.Users (UserId, OrganizationId, Email, DisplayName) VALUES
      (1, 1, 'admin@worksync.test', 'Admin Actor'),
      (2, 1, 'lead-a@worksync.test', 'Team A Lead'),
      (3, 1, 'member-a@worksync.test', 'Team A Member'),
      (5, 1, 'lead-b@worksync.test', 'Team B Lead'),
      (6, 1, 'member-b@worksync.test', 'Team B Member'),
      (10, 1, 'lead-c@worksync.test', 'Team C Lead'),
      (99, 1, 'outsider@worksync.test', 'Outsider');

    INSERT INTO notify.NotificationTypes (TypeCode, CategoryCode, DefaultPriority) VALUES
      ('team_lead_changed', 'Project', 'High'),
      ('team_member_moved', 'Project', 'High'),
      ('team_member_removed_needs_reassignment', 'Project', 'High'),
      ('task_reassigned', 'Task', 'High');

    INSERT INTO work.ProjectStatuses (ProjectStatusId, StatusCode) VALUES (1, 'Active');
    INSERT INTO work.Priorities (PriorityId, PriorityCode) VALUES (1, 'Medium');

    INSERT INTO work.Projects
      (ProjectId, OrganizationId, ProjectCode, ProjectName, Description, OwnerUserId,
       ProjectStatusId, PriorityId, StartDate, EndDate, CreatedByUserId)
    VALUES
      (1, 1, 'PROJ-1', 'Apollo', 'A multi-team project used to verify team management.', 2,
       1, 1, '2026-01-01', '2026-12-31', 2),
      (2, 1, 'PROJ-2', 'Artemis', 'A second, independent multi-team project.', 10,
       1, 1, '2026-01-01', '2026-12-31', 10);

    INSERT INTO work.ProjectMembers (ProjectId, UserId, MemberRoleCode, AddedByUserId) VALUES
      (1, 2, 'Owner', 2),
      (1, 3, 'Member', 2),
      (1, 5, 'TeamLead', 2),
      (1, 6, 'Member', 2);

    INSERT INTO work.ProjectTeams (TeamId, ProjectId, TeamName, Description, CreatedByUserId) VALUES
      (1, 1, 'Team A', 'Handles the launch checklist.', 2),
      (2, 1, 'Team B', 'Handles ground support.', 2),
      (3, 2, 'Team C', 'The only team in project 2.', 10);

    INSERT INTO work.TeamMembers (TeamId, ProjectId, UserId, IsLead, AddedByUserId) VALUES
      (1, 1, 2, TRUE, 2),
      (1, 1, 3, FALSE, 2),
      (2, 1, 5, TRUE, 2),
      (2, 1, 6, FALSE, 2);

    INSERT INTO work.TaskStatuses (TaskStatusId, StatusCode, IsCompletedState) VALUES
      (1, 'Todo', FALSE),
      (2, 'Done', TRUE);

    -- Open work held by Team A's lead (usr-2) and by Team B's lead (usr-5), plus one already-Done
    -- task, which must NOT be swept up by a reassignment.
    INSERT INTO work.Tasks (TaskId, ProjectId, ParentTaskId, Title, TaskStatusId) VALUES
      (1, 1, NULL, 'API Integration', 1),
      (2, 1, 1,    'Wire up the auth endpoint', 1),
      (3, 1, NULL, 'Retired groundwork', 2),
      (4, 1, NULL, 'Ground support rota', 1);

    INSERT INTO work.TaskAssignees (TaskId, UserId, AssignedByUserId) VALUES
      (1, 2, 2),
      (2, 2, 2),
      (3, 2, 2),
      (4, 5, 2);
  `);
});

after(async () => {
  resetPoolForTesting();
  delete process.env.DATABASE_URL;
  await pool.end();
});

// --- replaceTeamLead --------------------------------------------------------------------------
// Ordered deliberately: tests 1-4 only ever reject (never mutate Team A's lead), so they can run
// in any order relative to each other; test 5 is last because it's the one that actually performs
// the replacement.

test('replaceTeamLead: nonexistent team is rejected', async () => {
  await assert.rejects(
    () => replaceTeamLead('prj-1', 'tm-999', 'usr-3', 'usr-1', 'Admin'),
    /Team not found in this project/
  );
});

test('replaceTeamLead: replacing the current Team Lead with themselves is rejected', async () => {
  await assert.rejects(
    () => replaceTeamLead('prj-1', 'tm-1', 'usr-2', 'usr-1', 'Admin'),
    /already the Team Lead of this team/
  );
});

test('replaceTeamLead: a non-project-member replacement is rejected', async () => {
  await assert.rejects(
    () => replaceTeamLead('prj-1', 'tm-1', 'usr-99', 'usr-1', 'Admin'),
    /must already be a member of this project/
  );
});

test('replaceTeamLead: a replacement already on a different team in the same project is rejected cleanly (not a raw DB error)', async () => {
  // usr-6 is an active member of Team B, not Team A -- this used to reach repo.replaceTeamLead and
  // throw a raw Postgres 23505 unique-violation on UQ_TeamMembers_Project_User.
  await assert.rejects(
    () => replaceTeamLead('prj-1', 'tm-1', 'usr-6', 'usr-1', 'Admin'),
    /already on a different team in this project/
  );

  // Confirm nothing was mutated by the rejected attempt.
  const teamA = await pool.query(
    `SELECT userid, islead FROM work.teammembers WHERE teamid = 1 AND leftatutc IS NULL ORDER BY userid`
  );
  assert.deepEqual(teamA.rows, [
    { userid: 2, islead: true },
    { userid: 3, islead: false }
  ]);
});

test('replaceTeamLead: a valid replacement (existing member of the same team) succeeds and leaves exactly one active lead', async () => {
  const dto = await replaceTeamLead('prj-1', 'tm-1', 'usr-3', 'usr-1', 'Admin');

  const teamA = dto.teams.find((team) => team.id === 'tm-1');
  assert.ok(teamA);
  assert.equal(teamA!.leadId, 'usr-3');
  assert.deepEqual(new Set(teamA!.memberIds), new Set(['usr-2', 'usr-3']));

  const teamMemberRows = await pool.query(
    `SELECT userid, islead FROM work.teammembers WHERE teamid = 1 AND leftatutc IS NULL ORDER BY userid`
  );
  assert.deepEqual(teamMemberRows.rows, [
    { userid: 2, islead: false },
    { userid: 3, islead: true }
  ]);
  const leadCount = await pool.query(
    `SELECT COUNT(*)::int AS count FROM work.teammembers WHERE teamid = 1 AND islead = TRUE AND leftatutc IS NULL`
  );
  assert.equal((leadCount.rows[0] as { count: number }).count, 1, 'exactly one active Team Lead must remain on the team');

  const projectMemberRoles = await pool.query(
    `SELECT userid, memberrolecode FROM work.projectmembers WHERE projectid = 1 AND userid IN (2, 3) ORDER BY userid`
  );
  assert.deepEqual(projectMemberRoles.rows, [
    { userid: 2, memberrolecode: 'Member' },
    { userid: 3, memberrolecode: 'TeamLead' }
  ]);
});

test('replaceTeamLead: the outgoing lead\'s open work is reassigned to the incoming lead, completed work is left alone', async () => {
  // Follows the replacement above (usr-2 -> usr-3 on Team A). usr-2 held tasks 1 and 2 (both open)
  // and task 3 (Done); only the first two may move, and task 3's assignment must be untouched.
  const active = await pool.query(
    `SELECT taskid, userid FROM work.taskassignees
      WHERE unassignedatutc IS NULL AND taskid IN (1, 2, 3) ORDER BY taskid, userid`
  );
  assert.deepEqual(
    active.rows,
    [{ taskid: 1, userid: 3 }, { taskid: 2, userid: 3 }, { taskid: 3, userid: 2 }],
    'open tasks move to the new lead; the completed task stays with the outgoing lead'
  );

  // The outgoing lead's assignments were closed out, not deleted -- the history of who held the
  // work has to survive the handover.
  const closed = await pool.query(
    `SELECT taskid FROM work.taskassignees
      WHERE userid = 2 AND unassignedatutc IS NOT NULL ORDER BY taskid`
  );
  assert.deepEqual(closed.rows, [{ taskid: 1 }, { taskid: 2 }]);
});

test('replaceTeamLead: another team\'s lead keeps their own work', async () => {
  // Task 4 belongs to usr-5 (Team B). Team A's lead change must not touch it -- the reassignment is
  // scoped to the outgoing lead's own assignments, not to the project at large.
  const teamBWork = await pool.query(
    `SELECT userid FROM work.taskassignees WHERE taskid = 4 AND unassignedatutc IS NULL`
  );
  assert.deepEqual(teamBWork.rows, [{ userid: 5 }]);
});

// --- moveMember --------------------------------------------------------------------------------

test('moveMember: target team must belong to the same project', async () => {
  await assert.rejects(
    () => moveMember('prj-1', 'usr-6', 'tm-3', 'usr-1', 'Admin'), // tm-3 is project 2's team
    /Target team not found in this project/
  );
});

test('moveMember: a user not currently on any team of this project is rejected', async () => {
  // usr-99 is not even a project member here, let alone on a team.
  await assert.rejects(
    () => moveMember('prj-1', 'usr-99', 'tm-1', 'usr-1', 'Admin'),
    /not currently in a team of this project/
  );
});

test('moveMember: a stale team-only member is rejected before their team assignment can change', async () => {
  // Simulates the historic data drift: the person appears in a team but has no active
  // ProjectMembers row. The service guard gives a clear error; the database migration adds the
  // permanent trigger that makes creating this state impossible in production.
  await pool.query(
    `INSERT INTO work.teammembers (teamid, projectid, userid, islead, addedbyuserid)
     VALUES (1, 1, 99, FALSE, 1)`
  );

  await assert.rejects(
    () => moveMember('prj-1', 'usr-99', 'tm-2', 'usr-1', 'Admin'),
    /must be an active project member/
  );

  const membership = await pool.query(
    `SELECT teamid FROM work.teammembers WHERE projectid = 1 AND userid = 99 AND leftatutc IS NULL`
  );
  assert.deepEqual(membership.rows, [{ teamid: 1 }], 'the rejected move must not alter team placement');

  await pool.query(`DELETE FROM work.teammembers WHERE projectid = 1 AND userid = 99`);
});

test('moveMember: moving a Team Lead strips their lead status and the destination gains a plain member', async () => {
  // usr-5 currently leads Team B; move them into Team A (already re-led by usr-3 from the test
  // above -- Team A now has usr-2 (plain member) and usr-3 (lead)).
  const dto = await moveMember('prj-1', 'usr-5', 'tm-1', 'usr-1', 'Admin');

  const teamA = dto.teams.find((team) => team.id === 'tm-1');
  assert.ok(teamA);
  assert.deepEqual(new Set(teamA!.memberIds), new Set(['usr-2', 'usr-3', 'usr-5']));
  assert.equal(teamA!.leadId, 'usr-3', 'Team A\'s lead is unaffected by the incoming member');

  const teamB = dto.teams.find((team) => team.id === 'tm-2');
  assert.ok(teamB);
  assert.deepEqual(teamB!.memberIds, ['usr-6'], 'usr-5 no longer appears in their old team');

  const movedRow = await pool.query(
    `SELECT teamid, islead FROM work.teammembers WHERE projectid = 1 AND userid = 5 AND leftatutc IS NULL`
  );
  assert.deepEqual(movedRow.rows, [{ teamid: 1, islead: false }]);

  const projectMemberRole = await pool.query(
    `SELECT memberrolecode FROM work.projectmembers WHERE projectid = 1 AND userid = 5`
  );
  assert.equal((projectMemberRole.rows[0] as { memberrolecode: string }).memberrolecode, 'Member');
});
