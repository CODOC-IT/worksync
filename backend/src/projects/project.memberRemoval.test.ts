import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { resetPoolForTesting, setPoolForTesting } from '../db/pool.js';
import { updateProject } from './project.service.js';

// Confirms the fix for Issue #6 (updateProject's member-removal bypass) end to end, against real
// SQL and the real project.service.ts/project.repository.ts code -- not just the isolated pure
// logic already covered by projectWorkflow.rules.test.ts. Trimmed to the columns this scenario
// actually exercises, same approach as discussion.repository.test.ts/notification.repository.
// test.ts.
//
// notify.NotificationTypes is seeded only so publishEvent() doesn't throw "Unknown notification
// type" and spam this suite's output -- actual delivery (notify.Notifications/UserNotifications)
// is NOT exercised or asserted on here. notification.repository.test.ts already documents a
// pg-mem-specific bug where publishEvent's recipient filter (`= ANY($::int[])` against
// iam.Users.UserId, a PK/unique column) silently returns zero rows; every publishEvent() call in
// this test therefore resolves to "no deliverable recipients" and returns early with no rows
// written, same as it would with the table absent -- just without an error to log. This test's
// job is the membership state machine (who got removed/flagged and in what order), not
// notification delivery.
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
      AccountStatus VARCHAR(20) NOT NULL DEFAULT 'Active',
      DeactivatedAtUtc TIMESTAMPTZ NULL
    );

    CREATE SCHEMA notify;

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
      -- TEXT, not DATE: pg-mem cannot execute project.repository.ts's real "startdate::text"
      -- read-side cast against a genuine DATE column (verified -- "cannot cast type date to
      -- text"). Test-only simplification, matching the DDL trims already documented in
      -- discussion.repository.test.ts / notification.repository.test.ts.
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

    -- 1 = Admin actor, 2 = Team Lead / project owner, 3 = Member A, 4 = Member B, 5 = Member C
    INSERT INTO iam.Users (UserId, OrganizationId, Email, DisplayName) VALUES
      (1, 1, 'admin@worksync.test', 'Admin Actor'),
      (2, 1, 'lead@worksync.test', 'Team Lead'),
      (3, 1, 'a@worksync.test', 'Member A'),
      (4, 1, 'b@worksync.test', 'Member B'),
      (5, 1, 'c@worksync.test', 'Member C');

    INSERT INTO notify.NotificationTypes (TypeCode, CategoryCode, DefaultPriority) VALUES
      ('project_updated', 'Project', 'Low'),
      ('project_member_removed', 'Project', 'Normal'),
      ('project_member_pending_removal', 'Project', 'Normal');

    INSERT INTO work.ProjectStatuses (ProjectStatusId, StatusCode) VALUES (1, 'Active');
    INSERT INTO work.Priorities (PriorityId, PriorityCode) VALUES (1, 'Medium');

    INSERT INTO work.Projects
      (ProjectId, OrganizationId, ProjectCode, ProjectName, Description, OwnerUserId,
       ProjectStatusId, PriorityId, StartDate, EndDate, CreatedByUserId)
    VALUES
      (1, 1, 'PROJ-1', 'Apollo', 'A project used to verify member removal.', 2, 1, 1,
       '2026-01-01', '2026-12-31', 2);

    -- Lead is the project Owner (see project.mapper.ts's resolveTeamLeadUserId owner fallback --
    -- no separate 'TeamLead' row is needed). A/B/C are plain Members.
    INSERT INTO work.ProjectMembers (ProjectId, UserId, MemberRoleCode, AddedByUserId) VALUES
      (1, 2, 'Owner', 2),
      (1, 3, 'Member', 2),
      (1, 4, 'Member', 2),
      (1, 5, 'Member', 2);

    INSERT INTO work.TaskStatuses (TaskStatusId, StatusCode, IsCompletedState) VALUES
      (1, 'ToDo', FALSE),
      (2, 'Done', TRUE);

    -- Only Member B has an active (not-Done, not-archived) task assignment in this project.
    INSERT INTO work.Tasks (TaskId, ProjectId, Title, TaskStatusId) VALUES
      (1, 1, 'Ship the launch checklist', 1);
    INSERT INTO work.TaskAssignees (TaskId, UserId, AssignedByUserId) VALUES (1, 4, 2);
  `);
});

after(async () => {
  resetPoolForTesting();
  await pool.end();
});

test('removing A (idle), B (active task), and C (idle) in one project edit processes each independently', async () => {
  const dto = await updateProject('prj-1', { memberIds: ['usr-2'] }, 'usr-1', 'Admin');

  // The PUT response (this DTO) reflects the outcome of all three members in one pass: A and C
  // are gone, B is still a member (not yet removed) but flagged, the Lead is untouched.
  assert.deepEqual(new Set(dto.memberIds), new Set(['usr-2', 'usr-4']));
  assert.deepEqual(dto.pendingRemovalMemberIds, ['usr-4']);

  interface MemberRow {
    userid: number;
    leftatutc: string | null;
    pendingremovalatutc: string | null;
    pendingremovalbyuserid: number | null;
  }
  const rows = await pool.query(
    `SELECT userid, leftatutc, pendingremovalatutc, pendingremovalbyuserid
     FROM work.projectmembers WHERE projectid = 1 ORDER BY userid`
  );
  const byUser = new Map<number, MemberRow>(
    (rows.rows as MemberRow[]).map((r): [number, MemberRow] => [r.userid, r])
  );
  const memberOf = (userId: number): MemberRow => {
    const row = byUser.get(userId);
    if (!row) throw new Error(`expected a work.projectmembers row for user ${userId}`);
    return row;
  };

  // Member A: no active tasks -- removed immediately, never flagged.
  assert.notEqual(memberOf(3).leftatutc, null, 'Member A should have been hard-removed');
  assert.equal(memberOf(3).pendingremovalatutc, null, 'Member A should never be flagged Pending Removal');

  // Member B: has an active task assignment -- flagged Pending Removal, NOT removed, and by the
  // actor (usr-1) who requested the edit.
  assert.equal(memberOf(4).leftatutc, null, 'Member B must not be removed while still assigned active work');
  assert.notEqual(memberOf(4).pendingremovalatutc, null, 'Member B should be flagged Pending Removal');
  assert.equal(memberOf(4).pendingremovalbyuserid, 1);

  // Member C: no active tasks -- removed immediately, same as A. B being mid-loop and only
  // flagged (not removed, no throw) did not stop C -- the member after B in processing order --
  // from being reached and correctly hard-removed.
  assert.notEqual(memberOf(5).leftatutc, null, 'Member C should have been hard-removed');
  assert.equal(memberOf(5).pendingremovalatutc, null, 'Member C should never be flagged Pending Removal');

  // Team Lead / owner: untouched throughout.
  assert.equal(memberOf(2).leftatutc, null);
  assert.equal(memberOf(2).pendingremovalatutc, null);
});
