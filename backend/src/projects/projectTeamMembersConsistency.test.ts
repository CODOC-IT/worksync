import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { resetPoolForTesting, setPoolForTesting } from '../db/pool.js';
import { recheckPendingRemovalForMember, removeMember } from './project.service.js';
import { findMembersForProject, findTeamMembersForProject, findTeamsForProject } from './project.repository.js';
import { buildTeamDTOs } from './project.mapper.js';
import { fromUserPk } from '../utils/idMapping.js';

// Confirms the fix for the confirmed TeamMembers/ProjectMembers consistency bug: removing a
// project member closed their work.ProjectMembers row but never their work.TeamMembers row, so a
// removed member kept appearing as an active team member in ProjectDTO.teams. project.repository.
// ts's removeProjectMember now closes both in the same transaction -- and only when a member is
// actually removed, never when they're merely flagged Pending Removal (see project.memberRemoval.
// test.ts for the pre-existing Pending Removal state-machine coverage this file doesn't repeat).
const db = newDb();
const adapter = db.adapters.createPg();
const pool = new adapter.Pool();

before(async () => {
  setPoolForTesting(pool as unknown as Pool);
  await pool.query(`
    CREATE SCHEMA org;
    CREATE SCHEMA iam;
    CREATE SCHEMA work;
    CREATE SCHEMA notify;

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

    -- 1 = Admin, 2 = Team A lead (Owner), 3 = Team A member (idle), 4 = Team A member (active
    -- task), 5 = Team B lead, 6 = Team B member.
    INSERT INTO iam.Users (UserId, OrganizationId, Email, DisplayName) VALUES
      (1, 1, 'admin@worksync.test', 'Admin Actor'),
      (2, 1, 'lead-a@worksync.test', 'Team A Lead'),
      (3, 1, 'idle@worksync.test', 'Idle Member'),
      (4, 1, 'busy@worksync.test', 'Busy Member'),
      (5, 1, 'lead-b@worksync.test', 'Team B Lead'),
      (6, 1, 'member-b@worksync.test', 'Team B Member');

    INSERT INTO notify.NotificationTypes (TypeCode, CategoryCode, DefaultPriority) VALUES
      ('project_member_removed', 'Project', 'Normal'),
      ('project_member_pending_removal', 'Project', 'Normal'),
      ('project_member_auto_removed', 'Project', 'Normal');

    INSERT INTO work.ProjectStatuses (ProjectStatusId, StatusCode) VALUES (1, 'Active');
    INSERT INTO work.Priorities (PriorityId, PriorityCode) VALUES (1, 'Medium');

    INSERT INTO work.Projects
      (ProjectId, OrganizationId, ProjectCode, ProjectName, Description, OwnerUserId,
       ProjectStatusId, PriorityId, StartDate, EndDate, CreatedByUserId)
    VALUES
      (1, 1, 'PROJ-1', 'Apollo', 'A multi-team project used to verify TeamMembers consistency.', 2,
       1, 1, '2026-01-01', '2026-12-31', 2);

    INSERT INTO work.ProjectMembers (ProjectId, UserId, MemberRoleCode, AddedByUserId) VALUES
      (1, 2, 'Owner', 2),
      (1, 3, 'Member', 2),
      (1, 4, 'Member', 2),
      (1, 5, 'TeamLead', 2),
      (1, 6, 'Member', 2);

    INSERT INTO work.ProjectTeams (TeamId, ProjectId, TeamName, Description, CreatedByUserId) VALUES
      (1, 1, 'Team A', 'Handles the launch checklist.', 2),
      (2, 1, 'Team B', 'Handles ground support.', 2);

    INSERT INTO work.TeamMembers (TeamId, ProjectId, UserId, IsLead, AddedByUserId) VALUES
      (1, 1, 2, TRUE, 2),
      (1, 1, 3, FALSE, 2),
      (1, 1, 4, FALSE, 2),
      (2, 1, 5, TRUE, 2),
      (2, 1, 6, FALSE, 2);

    INSERT INTO work.TaskStatuses (TaskStatusId, StatusCode, IsCompletedState) VALUES
      (1, 'ToDo', FALSE),
      (2, 'Done', TRUE);

    -- Only Member 4 (Busy Member) has an active task assignment.
    INSERT INTO work.Tasks (TaskId, ProjectId, Title, TaskStatusId) VALUES
      (1, 1, 'Ship the launch checklist', 1);
    INSERT INTO work.TaskAssignees (TaskId, UserId, AssignedByUserId) VALUES (1, 4, 2);
  `);
});

after(async () => {
  resetPoolForTesting();
  await pool.end();
});

interface TeamMemberRow {
  leftatutc: string | null;
}

const teamMembershipOf = async (userId: number): Promise<TeamMemberRow> => {
  const result = await pool.query(
    `SELECT leftatutc FROM work.teammembers WHERE projectid = 1 AND userid = $1`,
    [userId]
  );
  return result.rows[0] as TeamMemberRow;
};

interface ProjectMemberRow {
  leftatutc: string | null;
  pendingremovalatutc: string | null;
}

const projectMembershipOf = async (userId: number): Promise<ProjectMemberRow> => {
  const result = await pool.query(
    `SELECT leftatutc, pendingremovalatutc FROM work.projectmembers WHERE projectid = 1 AND userid = $1`,
    [userId]
  );
  return result.rows[0] as ProjectMemberRow;
};

test('immediate removal closes both the project membership and the active team membership', async () => {
  await removeMember('prj-1', 'usr-3', 'No longer needed.', 'usr-1', 'Admin');

  const projectMembership = await projectMembershipOf(3);
  assert.notEqual(projectMembership.leftatutc, null, 'ProjectMembers row should be closed');

  const teamMembership = await teamMembershipOf(3);
  assert.notEqual(teamMembership.leftatutc, null, 'TeamMembers row should also be closed');
});

test('Pending Removal does not prematurely close the team membership', async () => {
  await removeMember('prj-1', 'usr-4', 'No longer needed.', 'usr-1', 'Admin');

  const projectMembership = await projectMembershipOf(4);
  assert.equal(projectMembership.leftatutc, null, 'ProjectMembers row must stay active while flagged');
  assert.notEqual(projectMembership.pendingremovalatutc, null, 'member should be flagged Pending Removal');

  const teamMembership = await teamMembershipOf(4);
  assert.equal(teamMembership.leftatutc, null, 'TeamMembers row must stay active while Pending Removal is outstanding');
});

test('completing Pending Removal (active work clears) closes the team membership too', async () => {
  // Member 4's only active task reaches Done -- their previously-flagged removal can now finish.
  await pool.query(`UPDATE work.tasks SET taskstatusid = 2 WHERE taskid = 1`);
  await recheckPendingRemovalForMember('prj-1', 'usr-4', 'usr-1');

  const projectMembership = await projectMembershipOf(4);
  assert.notEqual(projectMembership.leftatutc, null, 'ProjectMembers row should now be closed');

  const teamMembership = await teamMembershipOf(4);
  assert.notEqual(teamMembership.leftatutc, null, 'TeamMembers row should now be closed too');
});

test('remaining active members still appear normally, and ProjectDTO.teams reflects only active membership', async () => {
  // Mirrors project.service.ts's buildDTO -- findMembersForProject/findTeamsForProject/
  // findTeamMembersForProject + buildTeamDTOs, without pulling in milestones/files (getProjectForUser's
  // full detail fetch), which this scenario doesn't otherwise need.
  const [members, teams, teamMembers] = await Promise.all([
    findMembersForProject(1),
    findTeamsForProject(1),
    findTeamMembersForProject(1)
  ]);

  // Members 3 and 4 were removed above; everyone else is still active.
  assert.deepEqual(new Set(members.map((m) => fromUserPk(m.userid))), new Set(['usr-2', 'usr-5', 'usr-6']));

  const teamDTOs = buildTeamDTOs(teams, teamMembers);
  const teamA = teamDTOs.find((team) => team.name === 'Team A');
  assert.ok(teamA, 'Team A should still exist');
  assert.deepEqual(new Set(teamA!.memberIds), new Set(['usr-2']), 'Team A should only list its still-active member');

  const teamB = teamDTOs.find((team) => team.name === 'Team B');
  assert.ok(teamB, 'Team B should still exist');
  assert.deepEqual(new Set(teamB!.memberIds), new Set(['usr-5', 'usr-6']), 'Team B is untouched and fully active');
});
