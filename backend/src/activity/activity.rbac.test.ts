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
  assert.ok(!descriptions.includes('Other activity'), 'Team Member must not see activity from an unrelated project');
});

test('activity DTO resolves actor names from IAM when snapshots are missing or stale', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents
    (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot, actornamesnapshot)
    VALUES (1, 4, 'Created', 'Task', 'tsk-actor', '00000000-0000-0000-0000-000000000003', 'Tasks', 'Actor name', 'Team_Member', 'System')`);

  const { listActivities } = await import('./activity.service.js');
  const result = await listActivities({ page: 1, pageSize: 50 }, 'usr-4', 'Team_Member');

  assert.equal(result.items[0]?.actor.id, 'usr-4');
  assert.equal(result.items[0]?.actor.name, 'Team Member User');
  assert.equal(result.items[0]?.actor.email, 'member@test.com');
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

test('Team Member: cannot view unrelated non-restricted modules', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot) VALUES
    (1, 5, 'Checked In', 'Attendance', 'att-1', '00000000-0000-0000-0000-000000000020', 'Attendance', 'Another check-in visible', 'Team_Member'),
    (1, 5, 'Updated', 'Task', 'tsk-99', '00000000-0000-0000-0000-000000000021', 'Tasks', 'Task update visible', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);

  assert.ok(!descriptions.includes('Another check-in visible'), 'Team Member must not see unrelated attendance activity');
  assert.ok(!descriptions.includes('Task update visible'), 'Team Member must not see unrelated task activity');
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

test('HR: can view non-HR project activity (near-admin visibility)', async () => {
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, projectid, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 5, 'Updated', 'Task', 'tsk-hr-proj', 2, '00000000-0000-0000-0000-000000000085', 'Tasks', 'Project task visible to HR', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Project task visible to HR'), 'HR should see all non-Admin project activity');
});

test('HR: cannot see activity performed by Admins', async () => {
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 1, 'Permission Granted', 'Permission', 'perm-admin-hr', '00000000-0000-0000-0000-000000000086', 'Permissions', 'Admin action hidden from HR', 'Admin')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(!descriptions.includes('Admin action hidden from HR'), 'HR must not see events performed by Admins');
});

test('HR: cannot see NULL-snapshot events performed by a current Administrator', async () => {
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 1, 'Approved task review', 'Task', 'tsk-null-snap', '00000000-0000-0000-0000-000000000090', 'System', 'Admin review decision without role snapshot', NULL)`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  assert.ok(effectiveRoles.isActiveHR, 'usr-4 should be an active HR representative');

  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(!descriptions.includes('Admin review decision without role snapshot'), 'HR must not see NULL-snapshot events whose actor is currently an Administrator');
});

test('HR: can see NULL-snapshot events performed by non-Administrators', async () => {
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 5, 'Moved task to Review', 'Task', 'tsk-null-member', '00000000-0000-0000-0000-000000000091', 'System', 'Member review move without role snapshot', NULL)`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');

  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Member review move without role snapshot'), 'HR should still see NULL-snapshot events by non-Administrators');
});

test('HR: can view auth/security events and deleted comments', async () => {
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES 
    (1, NULL, 'Login', 'User', 'failed-user@example.com', '00000000-0000-0000-0000-000000000087', 'Authentication', 'Failed login attempt for failed-user@example.com', NULL),
    (1, 5, 'Deleted', 'Comment', 'cmt-101', '00000000-0000-0000-0000-000000000088', 'Project Chats', 'User deleted a comment on Discussion', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Failed login attempt for failed-user@example.com'), 'HR should see auth/security events');
  assert.ok(descriptions.includes('User deleted a comment on Discussion'), 'HR should see deleted comments');
});

test('Action Filter: Priority Changed matches real priority changes, not creation-time values', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (auditeventid, organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES 
    (99, 1, 1, 'Priority Changed', 'Task', 'tsk-p1', '00000000-0000-0000-0000-000000000099', 'Tasks', 'Direct priority change action', 'Admin'),
    (98, 1, 1, 'Updated', 'Task', 'tsk-p2', '00000000-0000-0000-0000-000000000098', 'Tasks', 'Updated task priority via field', 'Admin'),
    (97, 1, 1, 'Created', 'Task', 'tsk-p3', '00000000-0000-0000-0000-000000000097', 'Tasks', 'Task created with initial priority', 'Admin')`);
  memDb.public.none(`INSERT INTO audit.auditeventchanges (auditeventid, fieldname, oldvalue, newvalue)
    VALUES (98, 'Priority', 'Low', 'High'), (97, 'Priority', '', 'Medium')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-1');
  const result = await findActivities({ action: 'Priority Changed', page: 1, pageSize: 50 }, effectiveRoles, 'usr-1');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Direct priority change action'), 'Should match explicit Priority Changed actioncode');
  assert.ok(descriptions.includes('Updated task priority via field'), 'Should match Priority field changes');
  assert.ok(!descriptions.includes('Task created with initial priority'), 'Creation-time priority values must not match');
});

test('Action Filter: Uploaded Attachment matches attachment-carrying events', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (auditeventid, organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot, metadatajson)
    VALUES 
    (101, 1, 4, 'Commented', 'Comment', 'cmt-att', '00000000-0000-0000-0000-000000000101', 'Project Chats', 'Comment with an uploaded file', 'Team_Member', '{"hasAttachments": true}'),
    (102, 1, 4, 'Commented', 'Comment', 'cmt-plain', '00000000-0000-0000-0000-000000000102', 'Project Chats', 'Plain comment without attachments', 'Team_Member', '{}'),
    (103, 1, 4, 'Created', 'ProjectFile', 'file-1', '00000000-0000-0000-0000-000000000103', 'Projects', 'Project file uploaded', 'Team_Member', '{}'),
    (104, 1, 4, 'Updated', 'Task', 'tsk-att', '00000000-0000-0000-0000-000000000104', 'Tasks', 'Unrelated task update', 'Team_Member', '{}')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-1');
  const result = await findActivities({ action: 'Uploaded Attachment', page: 1, pageSize: 50 }, effectiveRoles, 'usr-1');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Comment with an uploaded file'), 'Should match comments with attachment metadata');
  assert.ok(descriptions.includes('Project file uploaded'), 'Should match ProjectFile Created events');
  assert.ok(!descriptions.includes('Plain comment without attachments'), 'Should not match comments without attachments');
  assert.ok(!descriptions.includes('Unrelated task update'), 'Should not match unrelated actions');
});

test('Action Filter: Deleted Attachment matches ProjectFile deletion events', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (auditeventid, organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES 
    (111, 1, 4, 'Deleted', 'ProjectFile', 'file-2', '00000000-0000-0000-0000-000000000111', 'Projects', 'Project file deleted', 'Team_Member'),
    (112, 1, 4, 'Deleted', 'Task', 'tsk-del', '00000000-0000-0000-0000-000000000112', 'Tasks', 'Unrelated task deletion', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-1');
  const result = await findActivities({ action: 'Deleted Attachment', page: 1, pageSize: 50 }, effectiveRoles, 'usr-1');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Project file deleted'), 'Should match ProjectFile Deleted events');
  assert.ok(!descriptions.includes('Unrelated task deletion'), 'Should not match unrelated deletions');
});

test('Action Filter: Assigned/Reassigned matches split project codes', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (auditeventid, organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES 
    (121, 1, 4, 'Assigned', 'User', 'usr-5', '00000000-0000-0000-0000-000000000121', 'Projects', 'Member assigned to project', 'Team_Member'),
    (122, 1, 4, 'Reassigned', 'User', 'usr-5', '00000000-0000-0000-0000-000000000122', 'Projects', 'Member reassigned', 'Team_Member'),
    (123, 1, 4, 'Assigned/Reassigned', 'Task', 'tsk-are', '00000000-0000-0000-0000-000000000123', 'Tasks', 'Task assignee updated', 'Team_Member'),
    (124, 1, 4, 'Updated', 'Task', 'tsk-plain', '00000000-0000-0000-0000-000000000124', 'Tasks', 'Plain task update', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-1');
  const result = await findActivities({ action: 'Assigned/Reassigned', page: 1, pageSize: 50 }, effectiveRoles, 'usr-1');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Member assigned to project'), 'Should match Assigned code');
  assert.ok(descriptions.includes('Member reassigned'), 'Should match Reassigned code');
  assert.ok(descriptions.includes('Task assignee updated'), 'Should match Assigned/Reassigned code');
  assert.ok(!descriptions.includes('Plain task update'), 'Should not match unrelated updates');
});

test('Action Filter: Assigned matches task (re)assignments too', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (auditeventid, organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES 
    (131, 1, 4, 'Assigned', 'User', 'usr-5', '00000000-0000-0000-0000-000000000131', 'Projects', 'Member assigned to project', 'Team_Member'),
    (132, 1, 4, 'Assigned/Reassigned', 'Task', 'tsk-are2', '00000000-0000-0000-0000-000000000132', 'Tasks', 'Task assignee updated', 'Team_Member'),
    (133, 1, 4, 'Reassigned', 'User', 'usr-5', '00000000-0000-0000-0000-000000000133', 'Projects', 'Member removed from project', 'Team_Member'),
    (134, 1, 4, 'Updated', 'Task', 'tsk-plain2', '00000000-0000-0000-0000-000000000134', 'Tasks', 'Plain task update', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-1');
  const result = await findActivities({ action: 'Assigned', page: 1, pageSize: 50 }, effectiveRoles, 'usr-1');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Member assigned to project'), 'Should match Assigned code');
  assert.ok(descriptions.includes('Task assignee updated'), 'Should match Assigned/Reassigned task assignments');
  assert.ok(descriptions.includes('Member removed from project'), 'Should match removal-only Reassigned events');
  assert.ok(!descriptions.includes('Plain task update'), 'Should not match unrelated updates');
});

test('Action Filter: Archived matches archive events recorded as Deleted, Deleted excludes them', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (auditeventid, organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES 
    (141, 1, 1, 'Deleted', 'Project', 'prj-arch', '00000000-0000-0000-0000-000000000141', 'Projects', 'Admin archived project Alpha', 'Admin'),
    (142, 1, 1, 'Deleted', 'Project', 'prj-hard', '00000000-0000-0000-0000-000000000142', 'Projects', 'Admin permanently deleted project Beta', 'Admin'),
    (143, 1, 1, 'Archived', 'Project', 'prj-explicit', '00000000-0000-0000-0000-000000000143', 'Projects', 'Explicit archived code', 'Admin'),
    (144, 1, 1, 'Deleted', 'Task', 'tsk-del2', '00000000-0000-0000-0000-000000000144', 'Tasks', 'Task deletion', 'Admin')`);
  memDb.public.none(`INSERT INTO audit.auditeventchanges (auditeventid, fieldname, oldvalue, newvalue)
    VALUES (141, 'Status', 'Active', 'Archived'), (142, 'Status', 'Archived', 'Permanently Deleted')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-1');

  const archived = await findActivities({ action: 'Archived', page: 1, pageSize: 50 }, effectiveRoles, 'usr-1');
  const archivedDescs = archived.rows.map((r: any) => r.description);
  assert.ok(archivedDescs.includes('Admin archived project Alpha'), 'Archived filter must include archive-as-Deleted events');
  assert.ok(archivedDescs.includes('Explicit archived code'), 'Archived filter must match explicit Archived codes');
  assert.ok(!archivedDescs.includes('Admin permanently deleted project Beta'), 'Archived filter must not include permanent deletes');

  const deleted = await findActivities({ action: 'Deleted', page: 1, pageSize: 50 }, effectiveRoles, 'usr-1');
  const deletedDescs = deleted.rows.map((r: any) => r.description);
  assert.ok(deletedDescs.includes('Admin permanently deleted project Beta'), 'Deleted filter must include permanent deletes');
  assert.ok(deletedDescs.includes('Task deletion'), 'Deleted filter must include plain deletions');
  assert.ok(!deletedDescs.includes('Admin archived project Alpha'), 'Deleted filter must not include archive events');
  assert.ok(!deletedDescs.includes('Explicit archived code'), 'Deleted filter must not include explicit Archived codes');
});

test('Action Filter: Completed matches status changes to completed/done', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (auditeventid, organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES 
    (151, 1, 1, 'Completed', 'Project', 'prj-comp', '00000000-0000-0000-0000-000000000151', 'Projects', 'Explicit completed code', 'Admin'),
    (152, 1, 4, 'Status Changed', 'Task', 'tsk-done', '00000000-0000-0000-0000-000000000152', 'Tasks', 'Task moved to Done', 'Team_Member'),
    (153, 1, 4, 'Status Changed', 'Project', 'prj-projcomp', '00000000-0000-0000-0000-000000000153', 'Projects', 'Project marked Completed', 'Team_Member'),
    (154, 1, 4, 'Status Changed', 'Task', 'tsk-review', '00000000-0000-0000-0000-000000000154', 'Tasks', 'Task moved to Review', 'Team_Member')`);
  memDb.public.none(`INSERT INTO audit.auditeventchanges (auditeventid, fieldname, oldvalue, newvalue)
    VALUES (152, 'Status', 'In Progress', 'Done'), (153, 'Status', 'Active', 'Completed'), (154, 'Status', 'Todo', 'Review')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-1');
  const result = await findActivities({ action: 'Completed', page: 1, pageSize: 50 }, effectiveRoles, 'usr-1');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Explicit completed code'), 'Should match explicit Completed code');
  assert.ok(descriptions.includes('Task moved to Done'), 'Should match status change to Done');
  assert.ok(descriptions.includes('Project marked Completed'), 'Should match status change to Completed');
  assert.ok(!descriptions.includes('Task moved to Review'), 'Should not match non-completing status changes');
});

test('Important filter: matches high-impact activity (failed/blocked/destructive)', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (auditeventid, organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot, resultcode, isimportant)
    VALUES 
    (161, 1, NULL, 'Login', 'User', 'u1@test.com', '00000000-0000-0000-0000-000000000161', 'Authentication', 'Failed login attempt', NULL, 'Failed', FALSE),
    (162, 1, 1, 'Deleted', 'Task', 'tsk-del3', '00000000-0000-0000-0000-000000000162', 'Tasks', 'Task deleted', 'Admin', 'Successful', FALSE),
    (163, 1, 4, 'Updated', 'Task', 'tsk-plain3', '00000000-0000-0000-0000-000000000163', 'Tasks', 'Plain update', 'Team_Member', 'Successful', FALSE),
    (164, 1, 4, 'Checked In', 'Attendance', 'att-x', '00000000-0000-0000-0000-000000000164', 'Attendance', 'Flagged important check-in', 'Team_Member', 'Successful', TRUE)`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-1');
  const result = await findActivities({ importantOnly: true, page: 1, pageSize: 50 }, effectiveRoles, 'usr-1');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Failed login attempt'), 'Important must include Failed results');
  assert.ok(descriptions.includes('Task deleted'), 'Important must include destructive deletions');
  assert.ok(descriptions.includes('Flagged important check-in'), 'Important must include explicitly flagged events');
  assert.ok(!descriptions.includes('Plain update'), 'Important must not include ordinary updates');
});

test('Admin: My activity only restricts the feed to the viewer\'s own events', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES 
    (1, 1, 'Created', 'Project', 'prj-mine', '00000000-0000-0000-0000-000000000171', 'Projects', 'Admin own action', 'Admin'),
    (1, 5, 'Updated', 'Task', 'tsk-theirs', '00000000-0000-0000-0000-000000000172', 'Tasks', 'Other user action', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-1');
  const result = await findActivities({ myActivityOnly: true, page: 1, pageSize: 50 }, effectiveRoles, 'usr-1');
  const descriptions = result.rows.map((r: any) => r.description);
  assert.ok(descriptions.includes('Admin own action'), 'Admin should see their own events with My activity only');
  assert.ok(!descriptions.includes('Other user action'), 'Admin must not see other users with My activity only');
});

test('Activity DTO: affected-user names resolve from IAM when snapshots are missing', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (auditeventid, organizationid, actoruserid, actioncode, entitytypecode, entityidtext, affecteduseridtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (181, 1, 1, 'Assigned', 'User', 'usr-5', 'usr-5', '00000000-0000-0000-0000-000000000181', 'Projects', 'usr-1 added usr-5 to the project', 'Admin')`);

  const { listActivities } = await import('./activity.service.js');
  const result = await listActivities({ page: 1, pageSize: 50 }, 'usr-1', 'Admin');
  const item = result.items[0];
  assert.equal(item.affectedUser?.name, 'Other User', 'Affected user name should resolve from IAM');
  assert.equal(item.entityName, 'Other User', 'User entity name should resolve from IAM');
  assert.equal(item.description, 'Admin User added Other User to the project', 'Description ids should be replaced with names');
});

test('Activity feed: User entities with email entityidtext do not break the outcome filter', async () => {
  // Failed-login events store the attempted email in entityidtext (not a usr-<n> id). The
  // read-time name resolution must skip such references instead of throwing, otherwise the
  // Outcome=Failed feed fails entirely for Admin/HR.
  memDb.public.none(`INSERT INTO audit.auditevents (auditeventid, organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot, resultcode)
    VALUES 
    (191, 1, NULL, 'Login', 'User', 'failed@example.com', '00000000-0000-0000-0000-000000000191', 'Authentication', 'Failed login attempt for failed@example.com', NULL, 'Failed'),
    (192, 1, 4, 'Created', 'Project', 'prj-ok', '00000000-0000-0000-0000-000000000192', 'Projects', 'Successful project creation', 'Team_Member', 'Successful')`);

  const { listActivities } = await import('./activity.service.js');
  const result = await listActivities({ result: 'Failed', page: 1, pageSize: 50 }, 'usr-1', 'Admin');
  assert.equal(result.total, 1, 'Failed outcome should return only the failed event');
  assert.equal(result.items[0].entityName, 'failed@example.com', 'Email entity id should be kept as the entity name');
});
test('HR: loses attendance scope after temporary role expires', async () => {
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
  assert.ok(!descriptions.includes('Check-in after HR expiry'), 'Expired HR must lose visibility');
});

test('HR: revoked permission provides no HR access', async () => {
  memDb.public.none(`INSERT INTO iam.userroles
    (userid, roleid, grantedbyuserid, startsatutc, revokedatutc, revokedbyuserid, revocationreason)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1,
      CURRENT_TIMESTAMP - INTERVAL '2 hours', CURRENT_TIMESTAMP - INTERVAL '1 hour', 1, 'Revoked')`);

  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  assert.ok(!effectiveRoles.isActiveHR, 'Revoked HR must not be active');
});

test('HR: future-dated permission provides no HR access', async () => {
  memDb.public.none(`INSERT INTO iam.userroles
    (userid, roleid, grantedbyuserid, startsatutc, endsatutc)
    VALUES (4, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1,
      CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP + INTERVAL '2 hours')`);

  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');
  assert.ok(!effectiveRoles.isActiveHR, 'Future HR must not be active');
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
    (1, 5, 'Updated', 'Task', 'tsk-7', 2, '00000000-0000-0000-0000-000000000110', 'Tasks', 'Combined HR+Lead non-admin task activity', 'Team_Member'),
    (1, 4, 'Checked In', 'Attendance', 'att-40', NULL, '00000000-0000-0000-0000-000000000111', 'Attendance', 'Combined HR attendance activity', 'Team_Member'),
    (1, 1, 'Permission Revoked', 'Permission', 'perm-admin-combined', NULL, '00000000-0000-0000-0000-000000000112', 'Permissions', 'Admin action must stay hidden', 'Admin')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');
  const effectiveRoles = await getEffectiveRoles('usr-4');

  assert.ok(effectiveRoles.isActiveTeamLead, 'Should be active Team Lead');
  assert.ok(effectiveRoles.isActiveHR, 'Should be active HR');

  const result = await findActivities({ page: 1, pageSize: 50 }, effectiveRoles, 'usr-4');
  const descriptions = result.rows.map((r: any) => r.description);

  assert.ok(descriptions.includes('Combined HR+Lead non-admin task activity'), 'Combined HR+Lead should see all non-admin activity');
  assert.ok(descriptions.includes('Combined HR attendance activity'), 'Combined HR+Lead should see attendance activity');
  assert.ok(!descriptions.includes('Admin action must stay hidden'), 'Combined HR+Lead must not see Admin-performed events');
});

// ─── Notification preference change events ('Notifications' module) ────────────
// These events never carry a projectId/taskId, so the only visibility path for
// Team Lead / Team Member viewers is the "own events" predicate -- Team Leads must never see
// a Team Member's (or another Team Lead's) preference change purely by leading their project.

test('Notification preference change: member sees their own, an unrelated Team Lead does not', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 4, 'Preference Changed', 'Notification Preference', 'notification-preference-inApp', '00000000-0000-0000-0000-000000000120', 'Notifications', 'Team Member turned off in-app notifications', 'Team_Member')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');

  const memberRoles = await getEffectiveRoles('usr-4');
  const memberResult = await findActivities({ page: 1, pageSize: 50 }, memberRoles, 'usr-4');
  assert.ok(
    memberResult.rows.some((r: any) => r.description === 'Team Member turned off in-app notifications'),
    'Member should see their own preference change in their own Activity Log'
  );

  // usr-5 becomes a Team Lead scoped to Project A (where the actor, usr-4, is not even a member) --
  // leading a project must not leak an unrelated member's preference change.
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (5, (SELECT roleid FROM iam.roles WHERE rolecode = 'TeamLead'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  const tlUrId = memDb.public.one(`SELECT ur.userroleid FROM iam.userroles ur
    JOIN iam.roles r ON r.roleid = ur.roleid
    WHERE ur.userid = 5 AND r.rolecode = 'TeamLead'`).userroleid;
  memDb.public.none(`INSERT INTO iam.teamleadprojectscopes (userroleid, projectid) VALUES (${tlUrId}, 1)`);

  const leadRoles = await getEffectiveRoles('usr-5');
  const leadResult = await findActivities({ page: 1, pageSize: 50 }, leadRoles, 'usr-5');
  assert.ok(
    !leadResult.rows.some((r: any) => r.description === 'Team Member turned off in-app notifications'),
    "Team Lead must not see a Team Member's preference change"
  );
});

test('Notification preference change: HR (near-admin) and Admin both see a Team Member\'s change', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 4, 'Preference Changed', 'Notification Preference', 'notification-preference-email', '00000000-0000-0000-0000-000000000121', 'Notifications', 'Team Member disabled email notifications', 'Team_Member')`);

  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (5, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');

  const hrRoles = await getEffectiveRoles('usr-5');
  const hrResult = await findActivities({ page: 1, pageSize: 50 }, hrRoles, 'usr-5');
  assert.ok(
    hrResult.rows.some((r: any) => r.description === 'Team Member disabled email notifications'),
    "HR should see a Team Member's preference change"
  );

  const adminRoles = await getEffectiveRoles('usr-1');
  const adminResult = await findActivities({ page: 1, pageSize: 50 }, adminRoles, 'usr-1');
  assert.ok(
    adminResult.rows.some((r: any) => r.description === 'Team Member disabled email notifications'),
    "Admin should see a Team Member's preference change"
  );
});

test('Notification preference change: HR\'s own change is hidden from Team Members but visible to Admin', async () => {
  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (5, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 5, 'Preference Changed', 'Notification Preference', 'notification-preference-mentions', '00000000-0000-0000-0000-000000000122', 'Notifications', 'HR turned on mention notifications', 'HR')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');

  const memberRoles = await getEffectiveRoles('usr-4');
  const memberResult = await findActivities({ page: 1, pageSize: 50 }, memberRoles, 'usr-4');
  assert.ok(
    !memberResult.rows.some((r: any) => r.description === 'HR turned on mention notifications'),
    "Team Member must not see HR's own preference change"
  );

  const adminRoles = await getEffectiveRoles('usr-1');
  const adminResult = await findActivities({ page: 1, pageSize: 50 }, adminRoles, 'usr-1');
  assert.ok(
    adminResult.rows.some((r: any) => r.description === 'HR turned on mention notifications'),
    "Admin should see HR's own preference change"
  );
});

test('Notification preference change: Admin\'s own change is visible only to Admin', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, correlationid, modulecode, description, actorrolesnapshot)
    VALUES (1, 1, 'Preference Changed', 'Notification Preference', 'notification-preference-dueReminders', '00000000-0000-0000-0000-000000000123', 'Notifications', 'Admin turned off due reminder notifications', 'Admin')`);

  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES (5, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);

  const { findActivities } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');

  const hrRoles = await getEffectiveRoles('usr-5');
  const hrResult = await findActivities({ page: 1, pageSize: 50 }, hrRoles, 'usr-5');
  assert.ok(
    !hrResult.rows.some((r: any) => r.description === 'Admin turned off due reminder notifications'),
    "HR must not see Admin's own preference change"
  );

  const adminRoles = await getEffectiveRoles('usr-1');
  const adminResult = await findActivities({ page: 1, pageSize: 50 }, adminRoles, 'usr-1');
  assert.ok(
    adminResult.rows.some((r: any) => r.description === 'Admin turned off due reminder notifications'),
    "Admin should see their own preference change"
  );
});

test('Comment deletion activity is visible only to HR and Admin', async () => {
  memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, projectid, correlationid, modulecode, description, actorrolesnapshot)
    VALUES
      (1, 4, 'Deleted', 'Comment', 'cmt-member-delete', 1, '00000000-0000-0000-0000-000000000124', 'Project Chats', 'Team Member deleted a comment', 'Team_Member'),
      (1, 5, 'Deleted', 'Comment', 'cmt-lead-delete', 2, '00000000-0000-0000-0000-000000000125', 'Project Chats', 'Team Lead deleted a comment', 'Team_Lead')`);

  memDb.public.none(`INSERT INTO iam.userroles (userid, roleid, grantedbyuserid, startsatutc)
    VALUES
      (3, (SELECT roleid FROM iam.roles WHERE rolecode = 'HRRepresentative'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour'),
      (5, (SELECT roleid FROM iam.roles WHERE rolecode = 'TeamLead'), 1, CURRENT_TIMESTAMP - INTERVAL '1 hour')`);
  const leadRoleId = memDb.public.one(`SELECT ur.userroleid FROM iam.userroles ur
    JOIN iam.roles r ON r.roleid = ur.roleid
    WHERE ur.userid = 5 AND r.rolecode = 'TeamLead'`).userroleid;
  memDb.public.none(`INSERT INTO iam.teamleadprojectscopes (userroleid, projectid) VALUES (${leadRoleId}, 2)`);

  const { findActivities, findVisibleActivityById } = await import('./activity.repository.js');
  const { getEffectiveRoles } = await import('./activity.rbac.js');

  const memberRoles = await getEffectiveRoles('usr-4');
  const memberResult = await findActivities({ page: 1, pageSize: 50 }, memberRoles, 'usr-4');
  assert.ok(!memberResult.rows.some((r: any) => r.entityidtext === 'cmt-member-delete'), 'Member must not see their own comment deletion');

  const leadRoles = await getEffectiveRoles('usr-5');
  const leadResult = await findActivities({ page: 1, pageSize: 50 }, leadRoles, 'usr-5');
  assert.ok(!leadResult.rows.some((r: any) => r.entityidtext === 'cmt-lead-delete'), 'Team Lead must not see their own comment deletion');
  const leadDeletionId = memDb.public.one(
    "SELECT auditeventid::text AS id FROM audit.auditevents WHERE entityidtext = 'cmt-lead-delete'"
  ).id;
  const leadDirect = await findVisibleActivityById(leadDeletionId, 'usr-5', leadRoles);
  assert.equal(leadDirect, null, 'Team Lead must not retrieve a comment deletion by direct activity ID');

  const hrRoles = await getEffectiveRoles('usr-3');
  const hrResult = await findActivities({ page: 1, pageSize: 50 }, hrRoles, 'usr-3');
  assert.ok(hrResult.rows.some((r: any) => r.entityidtext === 'cmt-member-delete'), 'HR should see comment deletion activity');

  const adminRoles = await getEffectiveRoles('usr-1');
  const adminResult = await findActivities({ page: 1, pageSize: 50 }, adminRoles, 'usr-1');
  assert.ok(adminResult.rows.some((r: any) => r.entityidtext === 'cmt-member-delete'), 'Admin should see comment deletion activity');
});

test('PDF export paginates long activity rows without producing an invalid document', async () => {
  for (let index = 0; index < 40; index++) {
    const suffix = String(index + 200).padStart(12, '0');
    memDb.public.none(`INSERT INTO audit.auditevents (organizationid, actoruserid, actioncode, entitytypecode, entityidtext, projectid, correlationid, modulecode, description, actorrolesnapshot)
      VALUES (1, 1, 'Updated', 'Task', 'tsk-pdf-${index}', 1, '00000000-0000-0000-0000-${suffix}', 'Tasks', 'A detailed audit record that must wrap cleanly inside the PDF table cell without overlapping the footer or creating an orphaned row on the next page.', 'Admin')`);
  }

  const { exportPdf } = await import('./activity.service.js');
  const exported = await exportPdf({ page: 1, pageSize: 100, sort: 'newest' }, 'usr-1', 'Admin');
  const pdfText = exported.content.toString('latin1');
  const pageCount = (pdfText.match(/\/Type \/Page\b/g) || []).length;

  assert.ok(exported.content.subarray(0, 4).equals(Buffer.from('%PDF')), 'Export must be a valid PDF document');
  assert.equal(exported.exportedCount, 40);
  assert.ok(pageCount >= 2, 'Long rows should continue onto a subsequent page');
  assert.ok(pageCount <= 4, `Rows should use each page efficiently without excessive page breaks (generated ${pageCount} pages)`);
});
