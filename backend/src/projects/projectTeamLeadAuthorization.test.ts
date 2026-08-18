import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { resetPoolForTesting, setPoolForTesting } from '../db/pool.js';
import { isProjectLead, removeMember, addMilestone } from './project.service.js';

// Confirms the fix for the confirmed multi-team Team Lead authorization bug: resolveTeamLeadUserId
// only ever resolved ONE 'TeamLead' ProjectMembers row, so isProjectLead()/assertCanManage()
// silently rejected every team lead on a multi-team project except the first one found. Both now
// go through project.mapper.ts's isTeamLeadOfProject (a `.some()` over every 'TeamLead' row),
// which recognizes all of them while remaining identical to the old behavior for a project with 0
// or 1 'TeamLead' rows (single-lead/legacy projects).
//
// Deliberately scoped to project.service.ts only, same reason as projectMemberAuthorization.
// test.ts: importing project.controller.ts transitively imports projectApproval.service.ts, which
// this suite doesn't need.
const db = newDb();
const adapter = db.adapters.createPg();
const pool = new adapter.Pool();

before(async () => {
  setPoolForTesting(pool as unknown as Pool);
  await pool.query(`
    CREATE SCHEMA org;
    CREATE SCHEMA iam;
    CREATE SCHEMA work;

    CREATE TABLE org.Organizations (
      OrganizationId SERIAL PRIMARY KEY,
      OrganizationCode VARCHAR(30) NOT NULL
    );

    CREATE TABLE iam.Users (
      UserId SERIAL PRIMARY KEY,
      OrganizationId INT NOT NULL REFERENCES org.Organizations(OrganizationId),
      Email VARCHAR(254) NOT NULL,
      DisplayName VARCHAR(170) NOT NULL,
      AccountStatus VARCHAR(20) NOT NULL DEFAULT 'Active'
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
      CreatedByUserId INT NOT NULL,
      CreatedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      RowVersion BIGINT NOT NULL DEFAULT 1
    );

    CREATE TABLE work.TeamMembers (
      TeamMemberId BIGSERIAL PRIMARY KEY,
      TeamId BIGINT NOT NULL REFERENCES work.ProjectTeams(TeamId),
      ProjectId INT NOT NULL REFERENCES work.Projects(ProjectId),
      UserId INT NOT NULL REFERENCES iam.Users(UserId),
      IsLead BOOLEAN NOT NULL DEFAULT FALSE,
      AddedByUserId INT NOT NULL,
      JoinedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      LeftAtUtc TIMESTAMPTZ NULL,
      RemovedByUserId INT NULL
    );

    CREATE TABLE work.ProjectMilestones (
      MilestoneId BIGSERIAL PRIMARY KEY,
      ProjectId INT NOT NULL REFERENCES work.Projects(ProjectId),
      MilestoneName VARCHAR(150) NOT NULL,
      Description VARCHAR(1000) NULL,
      DueDate TEXT NOT NULL,
      CompletedAtUtc TIMESTAMPTZ NULL,
      CreatedByUserId INT NOT NULL,
      CreatedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UpdatedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      RowVersion BIGINT NOT NULL DEFAULT 1
    );

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
      UnassignedAtUtc TIMESTAMPTZ NULL
    );

    INSERT INTO org.Organizations (OrganizationId, OrganizationCode) VALUES (1, 'ORG');

    -- 1 = Admin, 2 = Team A lead, 3 = Team A member, 5 = Team B lead, 9 = HR.
    INSERT INTO iam.Users (UserId, OrganizationId, Email, DisplayName) VALUES
      (1, 1, 'admin@worksync.test', 'Admin Actor'),
      (2, 1, 'lead-a@worksync.test', 'Team A Lead'),
      (3, 1, 'member-a@worksync.test', 'Team A Member'),
      (5, 1, 'lead-b@worksync.test', 'Team B Lead'),
      (9, 1, 'hr@worksync.test', 'HR Actor');

    INSERT INTO work.ProjectStatuses (ProjectStatusId, StatusCode) VALUES (1, 'Active');
    INSERT INTO work.Priorities (PriorityId, PriorityCode) VALUES (1, 'Medium');

    -- Project 1: multi-team, two teams, two different Team Leads (usr-2 owns/created it and leads
    -- Team A; usr-5 leads Team B and holds a *second* 'TeamLead' ProjectMembers row).
    INSERT INTO work.Projects
      (ProjectId, OrganizationId, ProjectCode, ProjectName, Description, OwnerUserId,
       ProjectStatusId, PriorityId, StartDate, EndDate, CreatedByUserId)
    VALUES
      (1, 1, 'PROJ-1', 'Apollo', 'A multi-team project used to verify Team Lead recognition.', 2,
       1, 1, '2026-01-01', '2026-12-31', 2);

    INSERT INTO work.ProjectMembers (ProjectId, UserId, MemberRoleCode, AddedByUserId) VALUES
      (1, 2, 'Owner', 2),
      (1, 3, 'Member', 2),
      (1, 5, 'TeamLead', 2);

    INSERT INTO work.ProjectTeams (TeamId, ProjectId, TeamName, Description, CreatedByUserId) VALUES
      (1, 1, 'Team A', 'Handles the launch checklist.', 2),
      (2, 1, 'Team B', 'Handles ground support.', 2);

    INSERT INTO work.TeamMembers (TeamId, ProjectId, UserId, IsLead, AddedByUserId) VALUES
      (1, 1, 2, TRUE, 2),
      (1, 1, 3, FALSE, 2),
      (2, 1, 5, TRUE, 2);

    -- Project 2: single-team/legacy shape -- no explicit 'TeamLead' row at all, lead resolved via
    -- the Owner fallback (regression coverage for existing single-lead behavior).
    INSERT INTO work.Projects
      (ProjectId, OrganizationId, ProjectCode, ProjectName, Description, OwnerUserId,
       ProjectStatusId, PriorityId, StartDate, EndDate, CreatedByUserId)
    VALUES
      (2, 1, 'PROJ-2', 'Artemis', 'A single-lead legacy project used for regression coverage.', 2,
       1, 1, '2026-01-01', '2026-12-31', 2);

    INSERT INTO work.ProjectMembers (ProjectId, UserId, MemberRoleCode, AddedByUserId) VALUES
      (2, 2, 'Owner', 2),
      (2, 3, 'Member', 2);
  `);
});

after(async () => {
  resetPoolForTesting();
  await pool.end();
});

test('first Team Lead in a multi-team project is recognized', async () => {
  assert.equal(await isProjectLead('prj-1', 'usr-2', 'Team_Lead'), true);
});

test('second Team Lead of a different team in the same project is also recognized', async () => {
  assert.equal(await isProjectLead('prj-1', 'usr-5', 'Team_Lead'), true);
});

test('a normal project member is not recognized as a Team Lead', async () => {
  assert.equal(await isProjectLead('prj-1', 'usr-3', 'Team_Member'), false);
});

test('a stale team-only lead is not authorized as a Project Team Lead', async () => {
  await pool.query(
    `INSERT INTO iam.users (userid, organizationid, email, displayname)
     VALUES (6, 1, 'stale-lead@worksync.test', 'Stale Team Lead')`
  );
  await pool.query(
    `INSERT INTO work.teammembers (teamid, projectid, userid, islead, addedbyuserid)
     VALUES (2, 1, 6, TRUE, 2)`
  );

  assert.equal(await isProjectLead('prj-1', 'usr-6', 'Team_Lead'), false);

  await pool.query(`DELETE FROM work.teammembers WHERE projectid = 1 AND userid = 6`);
  await pool.query(`DELETE FROM iam.users WHERE userid = 6`);
});

test('Admin is recognized regardless of membership (unchanged)', async () => {
  assert.equal(await isProjectLead('prj-1', 'usr-1', 'Admin'), true);
});

test('existing single-lead/legacy project behavior is unchanged (Owner fallback)', async () => {
  assert.equal(await isProjectLead('prj-2', 'usr-2', 'Team_Lead'), true);
  assert.equal(await isProjectLead('prj-2', 'usr-3', 'Team_Member'), false);
});

test('assertCanManage (via addMilestone) recognizes both of a multi-team project\'s Team Leads', async () => {
  const first = await addMilestone(
    'prj-1', { title: 'Team A kickoff', dueDate: '2026-02-01' }, 'usr-2', 'Team_Lead'
  );
  assert.equal(first.title, 'Team A kickoff');

  const second = await addMilestone(
    'prj-1', { title: 'Team B kickoff', dueDate: '2026-02-02' }, 'usr-5', 'Team_Lead'
  );
  assert.equal(second.title, 'Team B kickoff');

  await assert.rejects(
    () => addMilestone('prj-1', { title: 'Should fail', dueDate: '2026-02-03' }, 'usr-3', 'Team_Member'),
    /You can only manage projects you lead/
  );
});

test('removing a project member who leads any team is blocked, not just the first team\'s lead', async () => {
  // usr-2 (Team A's lead) is already covered by the pre-existing single-lead test suite; this
  // confirms usr-5 (Team B's lead, the *second* 'TeamLead' row) is protected too.
  await assert.rejects(
    () => removeMember('prj-1', 'usr-5', 'No longer needed.', 'usr-1', 'Admin'),
    /The current Team Lead cannot be removed/
  );
});
