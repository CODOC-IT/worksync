import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { resetPoolForTesting, setPoolForTesting } from '../db/pool.js';

let pool: Pool;

before(async () => {
  process.env.DATABASE_URL = 'postgres://pg-mem@localhost/worksync';

  const memoryDb = newDb();
  memoryDb.public.none(`
    CREATE SCHEMA iam;
    CREATE SCHEMA org;

    CREATE TABLE org.departments (
      departmentid integer PRIMARY KEY,
      departmentname text NOT NULL
    );

    CREATE TABLE iam.users (
      userid serial PRIMARY KEY,
      organizationid integer NOT NULL,
       departmentid integer,
       email text NOT NULL UNIQUE,
       username text,
       displayname text NOT NULL,
       designation text,
       accountstatus text NOT NULL,
       invitationsentatutc timestamptz,
       createdatutc timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deactivatedatutc timestamptz,
      authuserid uuid
    );

    CREATE TABLE iam.roles (
      roleid serial PRIMARY KEY,
      rolecode text NOT NULL
    );

    CREATE TABLE iam.userroles (
      userroleid serial PRIMARY KEY,
      userid integer NOT NULL,
      roleid integer NOT NULL,
      revokedatutc timestamptz,
      endsatutc timestamptz
    );

    CREATE TABLE iam.usercredentials (
      userid integer PRIMARY KEY,
      passwordhash bytea,
      passwordalgorithm text
    );

    INSERT INTO org.departments (departmentid, departmentname)
    VALUES (1, 'Engineering');

    INSERT INTO iam.roles (roleid, rolecode)
    VALUES (1, 'TeamMember');

    INSERT INTO iam.users
      (userid, organizationid, departmentid, email, displayname, designation, accountstatus)
    VALUES
      (101, 1, 1, 'database.user@example.com', 'Database User', 'Engineer', 'Active');

    INSERT INTO iam.userroles (userid, roleid)
    VALUES (101, 1);
  `);

  const adapter = memoryDb.adapters.createPg();
  pool = new adapter.Pool() as unknown as Pool;
  setPoolForTesting(pool);
});

after(async () => {
  resetPoolForTesting();
  delete process.env.DATABASE_URL;
  await pool.end();
});

test('configured database replaces fallback users without backfilling them', async () => {
  const { userStore } = await import('./userStore.js');

  await userStore.syncUsersToDb();

  const loadedUsers = await userStore.getAllUsers();
  assert.deepEqual(loadedUsers.map((user) => user.email), ['database.user@example.com']);

  const result = await pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM iam.users');
  assert.equal(result.rows[0].count, 1);
});

// Documents a real hazard authRoutes.ts's profile self-edit routes tripped on:
// updateDisplayName/updateUsername/updateEmail all locate the SAME cached UserRecord via their
// own internal findById() and mutate the changed field on it in place (`user.name = name`, not a
// replacement object) -- so a caller holding an earlier findById() reference sees the field
// change out from under them the moment the update call resolves, not just future lookups. A
// caller that wants the "previous" value for an activity-log entry or notification (e.g. "changed
// from X to Y") MUST copy the primitive string into its own local BEFORE calling the update
// method; reading it off the held reference afterward silently returns the new value, producing
// "changed from Y to Y". This test pins that behavior down so it can't regress unnoticed, and so
// the next call site that reaches for `previousUser.name` after an update call has something to
// grep for.
test('updateDisplayName mutates the cached record in place -- callers must snapshot the old value first', async () => {
  const { userStore } = await import('./userStore.js');
  await userStore.syncUsersToDb();

  const heldReference = userStore.findById('usr-101');
  assert.equal(heldReference?.name, 'Database User');
  const snapshotBeforeUpdate = heldReference?.name;

  await userStore.updateDisplayName('usr-101', 'Renamed User');

  assert.equal(heldReference?.name, 'Renamed User', 'the reference held before the call sees the new value, not the old one');
  assert.equal(snapshotBeforeUpdate, 'Database User', 'a primitive copied out beforehand is unaffected by the later mutation');

  await userStore.updateDisplayName('usr-101', 'Database User'); // restore for later tests in this file
});

test('syncUsersToDb reloads users created after the initial cache warmup', async () => {
  const { userStore } = await import('./userStore.js');

  await pool.query(
    `INSERT INTO iam.users
       (userid, organizationid, departmentid, email, username, displayname, designation, accountstatus)
     VALUES (102, 1, 1, 'new.supabase.user@example.com', 'new.user', 'New Supabase User', 'Designer', 'Active')`
  );
  await pool.query('INSERT INTO iam.userroles (userid, roleid) VALUES (102, 1)');

  await userStore.syncUsersToDb();

  const loadedUsers = await userStore.getAllUsers();
  assert.deepEqual(
    loadedUsers.map((user) => user.email),
    ['database.user@example.com', 'new.supabase.user@example.com']
  );
});
