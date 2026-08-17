import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { resetPoolForTesting, setPoolForTesting } from '../db/pool.js';
import { addMember, removeMember } from './project.service.js';

// Confirms the new "Team Lead cannot manage other project members" restriction from this PR --
// against real SQL and the real project.service.ts code, same pg-mem approach as
// project.memberRemoval.test.ts.
//
// Deliberately scoped to project.service.ts only -- NOT project.controller.ts. Importing the
// controller transitively imports projectApproval.service.ts, which is saved as UTF-16 and
// crashes tsx/esbuild ("Unexpected �") on load; that encoding is unrelated to this PR and
// must not be changed to make a test pass. The "Team Lead cannot smuggle a membership change
// through a project edit" guarantee is instead proven one layer down, in
// project.memberRemoval.test.ts's "a Team Lead cannot remove a project member via updateProject's
// memberIds diff" test: it calls project.service.ts's updateProject() directly with a Team_Lead
// actor role (simulating the worst case of the controller's approval-gating being bypassed
// entirely) and confirms the removal still doesn't happen, because assertCanManageMembers is
// enforced inside removeMember() itself, not just at the controller layer. That is a strictly
// stronger guarantee than a controller-level test would give (it doesn't depend on the controller
// remembering to strip memberIds -- the data layer refuses the mutation regardless of how the
// request arrives), and needs no import of the encoding-broken file to prove.
//
// DATABASE_URL is deliberately NOT set here (unlike project.memberRemoval.test.ts): every
// scenario below is rejected by assertCanManageMembers before assertEligibleAssignee or any
// userStore-backed lookup would ever run, so the fuller iam schema that file needed isn't
// necessary here.
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

    -- Needed only so removeMember's isTeamLeadOfProject/findTeamMembersForProject reads resolve --
    -- stays empty, no scenario in this file uses the multi-team architecture (that's covered by
    -- projectTeamLeadAuthorization.test.ts instead), so the legacy ProjectMembers-only fallback in
    -- isTeamLeadOfProject applies throughout.
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

    -- Needed only so removeMember's findActiveTaskAssignmentsForUserInProject JOIN resolves --
    -- stays empty, nobody in this file's scenarios has any task assignments.
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

    -- 2 = Team Lead / project owner, 3 = Member A, 4 = Member B, 9 = Admin
    INSERT INTO iam.Users (UserId, OrganizationId, Email, DisplayName) VALUES
      (2, 1, 'lead@worksync.test', 'Team Lead'),
      (3, 1, 'a@worksync.test', 'Member A'),
      (4, 1, 'b@worksync.test', 'Member B'),
      (9, 1, 'admin@worksync.test', 'Admin Actor');

    INSERT INTO work.ProjectStatuses (ProjectStatusId, StatusCode) VALUES (1, 'Active');
    INSERT INTO work.Priorities (PriorityId, PriorityCode) VALUES (1, 'Medium');

    INSERT INTO work.Projects
      (ProjectId, OrganizationId, ProjectCode, ProjectName, Description, OwnerUserId,
       ProjectStatusId, PriorityId, StartDate, EndDate, CreatedByUserId)
    VALUES
      (1, 1, 'PROJ-1', 'Apollo', 'A project used to verify member-management authorization.', 2, 1, 1,
       '2026-01-01', '2026-12-31', 2);

    -- Lead is the project Owner (see project.mapper.ts's resolveTeamLeadUserId owner fallback).
    INSERT INTO work.ProjectMembers (ProjectId, UserId, MemberRoleCode, AddedByUserId) VALUES
      (1, 2, 'Owner', 2),
      (1, 3, 'Member', 2),
      (1, 4, 'Member', 2);
  `);
});

after(async () => {
  resetPoolForTesting();
  await pool.end();
});

interface MemberRow {
  userid: number;
  leftatutc: string | null;
}

const currentMemberRows = async (): Promise<MemberRow[]> => {
  const result = await pool.query(
    `SELECT userid, leftatutc FROM work.projectmembers WHERE projectid = 1 ORDER BY userid`
  );
  return result.rows as MemberRow[];
};

test('a project Team Lead cannot add a member through the dedicated endpoint', async () => {
  const before = await currentMemberRows();
  await assert.rejects(
    () => addMember('prj-1', 'usr-5', 'Member', 'usr-2', 'Team_Lead'),
    /Only Admins can add or remove project members/
  );
  // No row was added -- rejected before any mutation, not just before a response was sent.
  assert.deepEqual(await currentMemberRows(), before);
});

test('a project Team Lead cannot remove a member through the dedicated endpoint', async () => {
  const before = await currentMemberRows();
  await assert.rejects(
    () => removeMember('prj-1', 'usr-3', 'No longer needed.', 'usr-2', 'Team_Lead'),
    /Only Admins can add or remove project members/
  );
  assert.deepEqual(await currentMemberRows(), before);
});

test('an Admin can still remove a project member through the dedicated endpoint (regression check)', async () => {
  // Only removeMember is exercised here, not addMember -- addMember's assertEligibleAssignee
  // reads userStore, which needs the fuller iam schema project.memberRemoval.test.ts builds (not
  // needed by anything else in this file, and addMember's Admin path is otherwise untouched by
  // this PR). assertCanManageMembers passing for an Admin is what's under test here.
  const removed = await removeMember('prj-1', 'usr-4', 'No longer needed.', 'usr-9', 'Admin');
  assert.ok(!removed.memberIds.includes('usr-4'));
});
