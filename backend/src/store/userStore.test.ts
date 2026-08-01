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
      deactivatedatutc timestamptz
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
