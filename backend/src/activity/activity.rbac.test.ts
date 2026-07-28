import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { DataType, newDb } from 'pg-mem';
import { setPoolForTesting, resetPoolForTesting } from '../db/pool.js';

const SCHEMA_DDL = `
  CREATE SCHEMA audit;
  CREATE SCHEMA org;
  CREATE SCHEMA iam;
  CREATE SCHEMA work;

  CREATE TABLE org.organizations (
    organizationid SERIAL PRIMARY KEY,
    organizationcode VARCHAR(30) NOT NULL
  );

  CREATE TABLE iam.users (
    userid SERIAL PRIMARY KEY,
    organizationid INT NOT NULL REFERENCES org.organizations(organizationid),
    email VARCHAR(254) NOT NULL,
    displayname VARCHAR(170) NOT NULL,
    accountstatus VARCHAR(20) NOT NULL DEFAULT 'Active'
  );

  CREATE TABLE iam.roles (
    roleid SERIAL PRIMARY KEY,
    rolecode VARCHAR(40) NOT NULL UNIQUE,
    rolename VARCHAR(80) NOT NULL,
    issystemrole BOOLEAN NOT NULL DEFAULT TRUE,
    istemporary BOOLEAN NOT NULL DEFAULT FALSE
  );

  CREATE TABLE iam.userroles (
    userroleid BIGSERIAL PRIMARY KEY,
    userid INT NOT NULL REFERENCES iam.users(userid),
    roleid SMALLINT NOT NULL REFERENCES iam.roles(roleid),
    grantedbyuserid INT NOT NULL REFERENCES iam.users(userid),
    startsatutc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    endsatutc TIMESTAMPTZ NULL,
    revokedatutc TIMESTAMPTZ NULL,
    revokedbyuserid INT NULL,
    revocationreason VARCHAR(500) NULL
  );

  CREATE TABLE iam.teamleadprojectscopes (
    userroleid BIGINT NOT NULL,
    projectid INT NOT NULL,
    cancreatetasks BOOLEAN NOT NULL DEFAULT TRUE,
    canmanagemembers BOOLEAN NOT NULL DEFAULT TRUE,
    canarchiveproject BOOLEAN NOT NULL DEFAULT FALSE,
    candeletetasks BOOLEAN NOT NULL DEFAULT FALSE,
    requiresactivation BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (userroleid, projectid)
  );

  CREATE TABLE iam.hrdepartmentscopes (
    userroleid BIGINT NOT NULL,
    departmentid INT NOT NULL,
    canexportattendance BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (userroleid, departmentid)
  );

  CREATE TABLE work.projectstatuses (
    projectstatusid SERIAL PRIMARY KEY,
    statuscode VARCHAR(30) NOT NULL UNIQUE
  );

  CREATE TABLE work.priorities (
    priorityid SERIAL PRIMARY KEY,
    prioritycode VARCHAR(20) NOT NULL UNIQUE
  );

  CREATE TABLE work.projects (
    projectid SERIAL PRIMARY KEY,
    organizationid INT NOT NULL REFERENCES org.organizations(organizationid),
    projectcode VARCHAR(30) NOT NULL,
    projectname VARCHAR(150) NOT NULL,
    owneruserid INT NOT NULL REFERENCES iam.users(userid),
    projectstatusid SMALLINT NOT NULL REFERENCES work.projectstatuses(projectstatusid),
    priorityid SMALLINT NOT NULL REFERENCES work.priorities(priorityid)
  );

  CREATE TABLE work.projectmembers (
    projectmemberid BIGSERIAL PRIMARY KEY,
    projectid INT NOT NULL REFERENCES work.projects(projectid),
    userid INT NOT NULL REFERENCES iam.users(userid),
    memberrolecode VARCHAR(30) NOT NULL DEFAULT 'Member',
    addedbyuserid INT NOT NULL REFERENCES iam.users(userid),
    joinedatutc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    leftatutc TIMESTAMPTZ NULL
  );

  CREATE TABLE work.tasks (
    taskid BIGSERIAL PRIMARY KEY,
    projectid INT NOT NULL REFERENCES work.projects(projectid),
    title VARCHAR(200) NOT NULL
  );

  CREATE TABLE work.taskassignees (
    taskassigneeid BIGSERIAL PRIMARY KEY,
    taskid BIGINT NOT NULL REFERENCES work.tasks(taskid),
    userid INT NOT NULL REFERENCES iam.users(userid),
    assignedbyuserid INT NOT NULL REFERENCES iam.users(userid),
    assignedatutc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    unassignedatutc TIMESTAMPTZ NULL
  );

  CREATE TABLE audit.auditevents (
    auditeventid BIGSERIAL PRIMARY KEY,
    organizationid INT NOT NULL,
    actoruserid INT NULL,
    actioncode VARCHAR(60) NOT NULL,
    entitytypecode VARCHAR(40) NOT NULL,
    entityidtext VARCHAR(100) NOT NULL,
    projectid INT NULL,
    taskid BIGINT NULL,
    reason VARCHAR(1000) NULL,
    correlationid UUID NOT NULL,
    ipaddress VARCHAR(45) NULL,
    occurredatutc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modulecode VARCHAR(40) NOT NULL DEFAULT 'System',
    description VARCHAR(1200) NULL,
    resultcode VARCHAR(20) NOT NULL DEFAULT 'Successful',
    sourcecode VARCHAR(20) NOT NULL DEFAULT 'API',
    isimportant BOOLEAN NOT NULL DEFAULT FALSE,
    actornamesnapshot VARCHAR(200) NULL,
    actoremailsnapshot VARCHAR(320) NULL,
    actorrolesnapshot VARCHAR(40) NULL,
    affecteduseridtext VARCHAR(100) NULL,
    affectedusernamesnapshot VARCHAR(200) NULL,
    entitynamesnapshot VARCHAR(300) NULL,
    projectnamesnapshot VARCHAR(300) NULL,
    tasknamesnapshot VARCHAR(300) NULL,
    linkroute VARCHAR(120) NULL,
    metadatajson JSONB NOT NULL DEFAULT '{}'::jsonb
  );

  CREATE TABLE audit.auditeventchanges (
    auditeventchangeid BIGSERIAL PRIMARY KEY,
    auditeventid BIGINT NOT NULL REFERENCES audit.auditevents(auditeventid),
    fieldname VARCHAR(128) NOT NULL,
    oldvalue TEXT NULL,
    newvalue TEXT NULL,
    issensitive BOOLEAN NOT NULL DEFAULT FALSE
  );
`;

const SEED_DML = `
  INSERT INTO org.organizations (organizationcode) VALUES ('WORKSYNC');
  INSERT INTO iam.users (organizationid, email, displayname) VALUES
    (1, 'admin@test.com', 'Admin User'),
    (1, 'lead@test.com', 'Team Lead User'),
    (1, 'hr@test.com', 'HR User'),
    (1, 'member@test.com', 'Team Member User'),
    (1, 'other@test.com', 'Other User');
  INSERT INTO iam.roles (rolecode, rolename, issystemrole, istemporary) VALUES
    ('Administrator', 'Administrator', TRUE, FALSE),
    ('TeamLead', 'Temporary Team Lead', TRUE, TRUE),
    ('HRRepresentative', 'Temporary HR Representative', TRUE, TRUE),
    ('TeamMember', 'Team Member', TRUE, FALSE);
  INSERT INTO iam.userroles (userid, roleid, grantedbyuserid) VALUES
    (1, (SELECT roleid FROM iam.roles WHERE rolecode = 'Administrator'), 1),
    (2, (SELECT roleid FROM iam.roles WHERE rolecode = 'TeamMember'), 1),
    (3, (SELECT roleid FROM iam.roles WHERE rolecode = 'TeamMember'), 1),
    (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'TeamMember'), 1),
    (5, (SELECT roleid FROM iam.roles WHERE rolecode = 'TeamMember'), 1);
  INSERT INTO work.projectstatuses (statuscode) VALUES ('Active');
  INSERT INTO work.priorities (prioritycode) VALUES ('Medium');
  INSERT INTO work.projects (organizationid, projectcode, projectname, owneruserid, projectstatusid, priorityid)
    VALUES (1, 'PROJ-A', 'Project A', 2, 1, 1),
           (1, 'PROJ-B', 'Project B', 2, 1, 1);
  INSERT INTO work.projectmembers (projectid, userid, memberrolecode, addedbyuserid)
    VALUES (1, 2, 'Owner', 2),
           (1, 4, 'Member', 2),
           (2, 2, 'Owner', 2),
           (2, 5, 'Member', 2);
  INSERT INTO work.tasks (projectid, title) VALUES (1, 'Task A-1'), (2, 'Task B-1');
`;

let memDb: ReturnType<typeof newDb>;

before(async () => {
  memDb = newDb({ autoCreateForeignKeyIndices: true });
  memDb.public.registerFunction({
    name: 'gen_random_uuid',
    args: [],
    returns: DataType.uuid,
    implementation: () => {
      const hex = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = Math.random() * 16 | 0;
        return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
      });
      return hex;
    },
    impure: true,
  });
  process.env.DATABASE_URL = 'postgres://pg-mem@localhost/test';
  memDb.public.none(SCHEMA_DDL);
  memDb.public.none(SEED_DML);
  const { Pool } = memDb.adapters.createPg();
  setPoolForTesting(new Pool());
});

after(() => {
  resetPoolForTesting();
});

beforeEach(() => {
  memDb.public.none(`DELETE FROM audit.auditeventchanges`);
  memDb.public.none(`DELETE FROM audit.auditevents`);
  memDb.public.none(`DELETE FROM iam.teamleadprojectscopes`);
  memDb.public.none(`DELETE FROM iam.hrdepartmentscopes`);
  memDb.public.none(`DELETE FROM iam.userroles
    WHERE roleid IN (SELECT roleid FROM iam.roles WHERE istemporary = TRUE)`);
});

test('Team Member: can view their own activity', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, projectid, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 4, 'Created', 'Task', 'tsk-1', 1, '00000000-0000-0000-0000-000000000001', 'Tasks', 'Own activity', 'Team_Member')`);
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, projectid, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 5, 'Created', 'Task', 'tsk-2', 2, '00000000-0000-0000-0000-000000000002', 'Tasks', 'Other activity', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);

  assert.ok(descriptions.includes('Own activity'), 'Team Member should see their own activity');
  assert.ok(descriptions.includes('Other activity'), 'Team Member should see activity in accessible projects');
});

test('Team Member: cannot view restricted modules', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 1, 'Modified', 'Permission', 'perm-1', '00000000-0000-0000-0000-000000000010', 'Permissions', 'Permission change', 'Admin')`);
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 1, 'Login', 'Session', 'sess-1', '00000000-0000-0000-0000-000000000011', 'Authentication', 'Login attempt', 'Admin')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const modules = result.rows.map((r: any) => r.modulecode);

  assert.ok(!modules.includes('Permissions'), 'Team Member must not see Permission module activity');
  assert.ok(!modules.includes('Authentication'), 'Team Member must not see Authentication module activity');
});

test('Team Member: can view non-restricted modules', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot) VALUES
    (1, 5, 'Checked In', 'Attendance', 'att-1', '00000000-0000-0000-0000-000000000020', 'Attendance', 'Another check-in visible', 'Team_Member'),
    (1, 5, 'Updated', 'Task', 'tsk-99', '00000000-0000-0000-0000-000000000021', 'Tasks', 'Task update visible', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);

  assert.ok(descriptions.includes('Another check-in visible'), 'Team Member should see non-restricted modules');
  assert.ok(descriptions.includes('Task update visible'), 'Team Member should see task activity');
});

test('Team Member: cannot retrieve restricted record by direct ID', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (auditeventid, organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (999, 1, 1, 'Permission Granted', 'Permission', 'perm-99', '00000000-0000-0000-0000-000000000030', 'Permissions', 'Admin permission grant', 'Admin')`);

  const { findVisibleActivityById } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  const row = await findVisibleActivityById('999', 'usr-4', effectiveRoles);
  assert.equal(row, null, 'Team Member must not retrieve restricted activity by direct ID');
});

test('Team Lead (temporary grant): can view activity for their led project', async () => {
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'TeamLead'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  const tlUrId = memDb.public.one(`SELECT ur.userroleid FROM iam.userroles ur
    JOIN iam.roles r ON r.roleid = ur.roleid
    WHERE ur.userid = 4 AND r.rolecode = 'TeamLead'`).userroleid;
  memDb.public.none(`INSERT INTO iam.teamleadprojectscopes (userroleid, projectid) VALUES (${tlUrId}, 2)`);
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, projectid, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 5, 'Updated', 'Task', 'tsk-3', 2, '00000000-0000-0000-0000-000000000040', 'Tasks', 'Project B task update', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  assert.ok(effectiveRoles.isActiveTeamLead, 'usr-4 should be an active Team Lead');

  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Project B task update'), 'Team Lead should see activity for their led project');
});

test('Team Lead: lead scope grants visibility in led project, not elsewhere', async () => {
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'TeamLead'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  const tlUrId = memDb.public.one(`SELECT ur.userroleid FROM iam.userroles ur
    JOIN iam.roles r ON r.roleid = ur.roleid
    WHERE ur.userid = 4 AND r.rolecode = 'TeamLead'`).userroleid;
  memDb.public.none(`INSERT INTO iam.teamleadprojectscopes (userroleid, projectid) VALUES (${tlUrId}, 2)`);
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, projectid, correlationid, modulecode, description, actorrolesnapshot) VALUES
    (1, 5, 'Modified', 'Permission', 'perm-led', 2, '00000000-0000-0000-0000-000000000050', 'Permissions', 'Led project perm change', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  assert.ok(effectiveRoles.isActiveTeamLead, 'usr-4 should be an active Team Lead');

  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Led project perm change'), 'Team Lead scope should grant visibility in led project even for restricted modules');
});

test('Team Lead: loses visibility after temporary role expires', async () => {
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc, endsatutc)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'TeamLead'), 1, CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 5, 'Permission Revoked', 'Permission', 'perm-exp', '00000000-0000-0000-0000-000000000060', 'Permissions', 'Expired lead perm change', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  assert.ok(!effectiveRoles.isActiveTeamLead, 'Expired Team Lead should not be active');

  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(!descriptions.includes('Expired lead perm change'), 'Team Lead must lose visibility after role expiry');
});

test('HR: can view attendance activity', async () => {
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 5, 'Checked In', 'Attendance', 'att-10', '00000000-0000-0000-0000-000000000070', 'Attendance', 'Member check-in visible to HR', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  assert.ok(effectiveRoles.isActiveHR, 'usr-4 should be an active HR representative');

  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Member check-in visible to HR'), 'HR should see attendance activity');
});

test('HR: cannot access unrelated project activity through HR permission', async () => {
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, projectid, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 5, 'Updated', 'Task', 'tsk-6', 2, '00000000-0000-0000-0000-000000000080', 'Tasks', 'Project task not in HR scope', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(!descriptions.includes('Project task not in HR scope'), 'HR must not see unrelated project activity through HR permission');
});

test('HR: loses active role after expiry, but Attendance stays visible as non-restricted module', async () => {
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc, endsatutc)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1, CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 5, 'Checked In', 'Attendance', 'att-20', '00000000-0000-0000-0000-000000000090', 'Attendance', 'Check-in after HR expiry', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  assert.ok(!effectiveRoles.isActiveHR, 'Expired HR should not be active');

  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Check-in after HR expiry'), 'Attendance is non-restricted, visible to Team Members');
});

test('Admin: can view all activity categories', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot) VALUES
    (1, 1, 'Created', 'Project', 'prj-99', '00000000-0000-0000-0000-000000000100', 'Projects', 'Admin project creation', 'Admin'),
    (1, 5, 'Checked In', 'Attendance', 'att-30', '00000000-0000-0000-0000-000000000101', 'Attendance', 'Admin sees attendance', 'Team_Member'),
    (1, 1, 'Permission Granted', 'Permission', 'perm-50', '00000000-0000-0000-0000-000000000102', 'Permissions', 'Admin sees permissions', 'Admin')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-1');
  assert.equal(effectiveRoles.permanentRole, 'Admin', 'Admin user must have Admin role');

  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-1');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Admin project creation'), 'Admin should see project activity');
  assert.ok(descriptions.includes('Admin sees attendance'), 'Admin should see attendance activity');
  assert.ok(descriptions.includes('Admin sees permissions'), 'Admin should see permission activity');
});

test('Revoked Team Lead: immediately loses elevated access', async () => {
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc, revokedatutc, revokedbyuserid, revocationreason)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'TeamLead'), 1, CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour', 1, 'Revoked for testing')`);

  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  assert.ok(!effectiveRoles.isActiveTeamLead, 'Revoked Team Lead must not be active');
});

test('Overlapping Team Lead and HR: combined scopes without unrestricted access', async () => {
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'TeamLead'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  const tlUrId = memDb.public.one(`SELECT userroleid FROM iam.userroles WHERE userid = 4 AND roleid = (SELECT roleid FROM iam.roles WHERE rolecode = 'TeamLead')`).userroleid;

  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);

  memDb.public.none(`INSERT INTO iam.teamleadprojectscopes (userroleid, projectid) VALUES (${tlUrId}, 2)`);

  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, projectid, correlationid, modulecode, description, actorrolesnapshot) VALUES
    (1, 5, 'Updated', 'Task', 'tsk-7', 2, '00000000-0000-0000-0000-000000000110', 'Tasks', 'Combined lead project activity', 'Team_Member'),
    (1, 4, 'Checked In', 'Attendance', 'att-40', NULL, '00000000-0000-0000-0000-000000000111', 'Attendance', 'Combined HR attendance activity', 'Team_Member'),
    (1, 5, 'Permission Revoked', 'Permission', 'perm-unrelated', NULL, '00000000-0000-0000-0000-000000000112', 'Permissions', 'Restricted unrelated activity', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');

  assert.ok(effectiveRoles.isActiveTeamLead, 'Should be active Team Lead');
  assert.ok(effectiveRoles.isActiveHR, 'Should be active HR');

  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);

  assert.ok(descriptions.includes('Combined lead project activity'), 'Combined roles should see led project activity');
  assert.ok(descriptions.includes('Combined HR attendance activity'), 'Combined roles should see HR attendance activity');
  assert.ok(!descriptions.includes('Restricted unrelated activity'), 'Combined roles must not see restricted unrelated activity');
});
