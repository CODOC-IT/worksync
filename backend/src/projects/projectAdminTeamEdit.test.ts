import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { resetPoolForTesting, setPoolForTesting } from '../db/pool.js';
import { updateProjectTeamSetup } from './project.service.js';
import { changePendingSetup } from './projectApproval.service.js';
import { insertApprovalRequest, findApprovalRequestById } from './projectApproval.repository.js';

// Covers req. 2 ("Admin must be able to review and EDIT the proposed project setup before
// approving it", explicitly including "Number of teams... Team Leads, Team Members") -- the one
// real feature gap found in this PR: changePendingSetup previously only forwarded plain fields
// (title/description/dates/priority) to updateProject, which has no concept of a team structure at
// all. Same pg-mem-against-real-SQL approach as projectTeamManagement.test.ts / projectApproval.repository.test.ts.
const db = newDb();
const adapter = db.adapters.createPg();
const pool = new adapter.Pool();

before(async () => {
  setPoolForTesting(pool as unknown as Pool);
  // assertEligibleAssignee (called by updateProjectTeamSetup, same as createProject) reads
  // userStore.getAllUsers(), which only queries the DB when isDatabaseConfigured() is true --
  // same reasoning as projectTeamManagement.test.ts's before().
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

    -- Needed only so buildDTO's getProjectProgress read resolves -- stays empty.
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

    CREATE TABLE work.ProjectApprovalRequests (
      ApprovalRequestId BIGSERIAL PRIMARY KEY,
      ProjectId INT NULL,
      ProjectTitle VARCHAR(500) NOT NULL,
      RequestType VARCHAR(30) NOT NULL,
      RequestedByUserId INT NOT NULL,
      RequestedChangesJson TEXT NULL,
      Reason VARCHAR(1000) NOT NULL,
      RequestStatus VARCHAR(20) NOT NULL DEFAULT 'Pending',
      ReviewedByUserId INT NULL,
      DecisionReason VARCHAR(1000) NULL,
      CreatedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      DecidedAtUtc TIMESTAMPTZ NULL
    );

    INSERT INTO org.Organizations (OrganizationId, OrganizationCode) VALUES (1, 'ORG');

    -- 1 = Admin, 2 = proposer/owner (also Team A's original lead), 3 = Team A member,
    -- 5 = incoming Team B lead, 6 = incoming Team B member.
    INSERT INTO iam.Users (UserId, OrganizationId, Email, DisplayName) VALUES
      (1, 1, 'admin@worksync.test', 'Admin Actor'),
      (2, 1, 'proposer@worksync.test', 'Proposer Lead'),
      (3, 1, 'member-a@worksync.test', 'Team A Member'),
      (5, 1, 'lead-b@worksync.test', 'Team B Lead'),
      (6, 1, 'member-b@worksync.test', 'Team B Member');

    INSERT INTO iam.Roles (RoleId, RoleCode) VALUES
      (1, 'Administrator'), (2, 'TeamLead'), (3, 'TeamMember');
    INSERT INTO iam.UserRoles (UserId, RoleId) VALUES
      (1, 1), (2, 2), (3, 3), (5, 2), (6, 3);

    INSERT INTO notify.NotificationTypes (TypeCode, CategoryCode, DefaultPriority) VALUES
      ('project_updated', 'Project', 'Medium');

    INSERT INTO work.ProjectStatuses (ProjectStatusId, StatusCode) VALUES
      (1, 'PendingActivation'), (2, 'Active');
    INSERT INTO work.Priorities (PriorityId, PriorityCode) VALUES (1, 'Medium');

    INSERT INTO work.Projects
      (ProjectId, OrganizationId, ProjectCode, ProjectName, Description, OwnerUserId,
       ProjectStatusId, PriorityId, StartDate, EndDate, CreatedByUserId, CreationReason)
    VALUES
      (1, 1, 'PROJ-1', 'Nebula', 'A member-suggested project pending Admin approval.', 2,
       1, 1, '2026-01-01', '2026-12-31', 2, 'Please approve.'),
      (2, 1, 'PROJ-2', 'Already Active', 'An already-active project (guards updateProjectTeamSetup).', 2,
       2, 1, '2026-01-01', '2026-12-31', 2, NULL);

    INSERT INTO work.ProjectMembers (ProjectId, UserId, MemberRoleCode, AddedByUserId) VALUES
      (1, 2, 'Owner', 2),
      (1, 3, 'Member', 2);

    INSERT INTO work.ProjectTeams (TeamId, ProjectId, TeamName, Description, CreatedByUserId) VALUES
      (1, 1, 'Team A', 'The originally proposed single team.', 2);

    INSERT INTO work.TeamMembers (TeamId, ProjectId, UserId, IsLead, AddedByUserId) VALUES
      (1, 1, 2, TRUE, 2),
      (1, 1, 3, FALSE, 2);
  `);
});

after(async () => {
  resetPoolForTesting();
  delete process.env.DATABASE_URL;
  await pool.end();
});

const activeTeamRows = async () =>
  (await pool.query(
    `SELECT pt.teamname, tm.userid, tm.islead
     FROM work.projectteams pt
     JOIN work.teammembers tm ON tm.teamid = pt.teamid AND tm.leftatutc IS NULL
     WHERE pt.projectid = 1
     ORDER BY pt.teamname, tm.userid`
  )).rows;

const activeMemberRows = async () =>
  (await pool.query(
    `SELECT userid, memberrolecode FROM work.projectmembers WHERE projectid = 1 AND leftatutc IS NULL ORDER BY userid`
  )).rows;

test('changePendingSetup replaces a pending proposal\'s team structure (rename, swap lead, add a team)', async () => {
  const requestId = await insertApprovalRequest({
    projectId: 1, projectTitle: 'Nebula', requestType: 'PROJECT_CREATE',
    requestedByUserId: 2, requestedChangesJson: null, reason: 'Please approve.'
  });

  await changePendingSetup(String(requestId), {
    teams: [
      { name: 'Team Alpha', description: 'Renamed from Team A.', leadId: 'usr-2', memberIds: ['usr-2', 'usr-3'] },
      { name: 'Team Beta', description: 'A brand-new second team.', leadId: 'usr-5', memberIds: ['usr-5', 'usr-6'] }
    ]
  }, 'usr-1', 'Admin');

  const teamRows = await activeTeamRows();
  assert.deepEqual(teamRows, [
    { teamname: 'Team Alpha', userid: 2, islead: true },
    { teamname: 'Team Alpha', userid: 3, islead: false },
    { teamname: 'Team Beta', userid: 5, islead: true },
    { teamname: 'Team Beta', userid: 6, islead: false }
  ]);

  const memberRows = await activeMemberRows();
  assert.deepEqual(memberRows, [
    { userid: 2, memberrolecode: 'Owner' },
    { userid: 3, memberrolecode: 'Member' },
    { userid: 5, memberrolecode: 'TeamLead' },
    { userid: 6, memberrolecode: 'Member' }
  ]);

  // The full proposed setup (including the edited team structure) is what the Approval Inbox
  // displays as "what was changed" -- must survive the round trip.
  const persisted = await findApprovalRequestById(String(requestId));
  const persistedChanges = JSON.parse(persisted!.requestedchangesjson!);
  assert.equal(persistedChanges.teams.length, 2);
  assert.equal(persistedChanges.teams[1].name, 'Team Beta');
});

test('changePendingSetup rejects an Admin user selected as a team member, without mutating anything', async () => {
  const requestId = await insertApprovalRequest({
    projectId: 1, projectTitle: 'Nebula', requestType: 'PROJECT_CREATE',
    requestedByUserId: 2, requestedChangesJson: null, reason: 'Please approve.'
  });
  const before = await activeTeamRows();

  await assert.rejects(
    () => changePendingSetup(String(requestId), {
      teams: [{ name: 'Team Alpha', description: 'desc', leadId: 'usr-2', memberIds: ['usr-2', 'usr-1'] }]
    }, 'usr-1', 'Admin'),
    /not eligible to be assigned/
  );

  assert.deepEqual(await activeTeamRows(), before);
});

test('changePendingSetup rejects a person appearing on more than one team', async () => {
  const requestId = await insertApprovalRequest({
    projectId: 1, projectTitle: 'Nebula', requestType: 'PROJECT_CREATE',
    requestedByUserId: 2, requestedChangesJson: null, reason: 'Please approve.'
  });
  const before = await activeTeamRows();

  await assert.rejects(
    () => changePendingSetup(String(requestId), {
      teams: [
        { name: 'Team Alpha', description: 'desc', leadId: 'usr-2', memberIds: ['usr-2', 'usr-3'] },
        { name: 'Team Beta', description: 'desc', leadId: 'usr-3', memberIds: ['usr-3', 'usr-5'] }
      ]
    }, 'usr-1', 'Admin'),
    /cannot belong to more than one team/
  );

  assert.deepEqual(await activeTeamRows(), before);
});

test('changePendingSetup rejects a team with fewer than 2 people', async () => {
  const requestId = await insertApprovalRequest({
    projectId: 1, projectTitle: 'Nebula', requestType: 'PROJECT_CREATE',
    requestedByUserId: 2, requestedChangesJson: null, reason: 'Please approve.'
  });

  await assert.rejects(
    () => changePendingSetup(String(requestId), {
      teams: [{ name: 'Solo Team', description: 'desc', leadId: 'usr-2', memberIds: [] }]
    }, 'usr-1', 'Admin'),
    /at least one member besides its Team Lead/
  );
});

test('updateProjectTeamSetup rejects when the target project is already Active', async () => {
  await assert.rejects(
    () => updateProjectTeamSetup('prj-2', [
      { name: 'Team Alpha', description: 'desc', leadId: 'usr-2', memberIds: ['usr-2', 'usr-3'] }
    ], 'usr-1', 'Admin'),
    /pending activation/
  );
});

test('updateProjectTeamSetup rejects a non-Admin caller', async () => {
  await assert.rejects(
    () => updateProjectTeamSetup('prj-1', [
      { name: 'Team Alpha', description: 'desc', leadId: 'usr-2', memberIds: ['usr-2', 'usr-3'] }
    ], 'usr-2', 'Team_Lead'),
    /Only Admins/
  );
});
