import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { resetPoolForTesting, setPoolForTesting } from '../db/pool.js';
import { activatePendingProject } from './project.repository.js';

const db = newDb();
const adapter = db.adapters.createPg();
const pool = new adapter.Pool();

before(async () => {
  setPoolForTesting(pool as unknown as Pool);
  await pool.query(`
    CREATE SCHEMA work;
    CREATE TABLE work.projectstatuses (
      projectstatusid SERIAL PRIMARY KEY,
      statuscode TEXT NOT NULL UNIQUE
    );
    CREATE TABLE work.priorities (
      priorityid SERIAL PRIMARY KEY,
      prioritycode TEXT NOT NULL UNIQUE
    );
    CREATE TABLE work.projects (
      projectid SERIAL PRIMARY KEY,
      organizationid INT NOT NULL DEFAULT 1,
      projectcode TEXT NOT NULL,
      projectname TEXT NOT NULL,
      description TEXT NOT NULL,
      owneruserid INT NOT NULL,
      projectstatusid INT NOT NULL,
      priorityid INT NOT NULL,
      startdate DATE NOT NULL,
      enddate DATE NOT NULL,
      createdbyuserid INT NOT NULL,
      creationreason TEXT NULL,
      archivedatutc TIMESTAMPTZ NULL,
      archivedbyuserid INT NULL,
      archivereason TEXT NULL,
      createdatutc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedatutc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      rowversion INT NOT NULL DEFAULT 1
    );
    INSERT INTO work.projectstatuses (statuscode) VALUES ('PendingActivation'), ('Active');
    INSERT INTO work.priorities (prioritycode) VALUES ('Medium');
    INSERT INTO work.projects
      (projectcode, projectname, description, owneruserid, projectstatusid, priorityid,
       startdate, enddate, createdbyuserid, creationreason)
    VALUES
      ('PRJ-1', 'Pending proposal', 'Pending proposal description', 2,
       (SELECT projectstatusid FROM work.projectstatuses WHERE statuscode = 'PendingActivation'),
       (SELECT priorityid FROM work.priorities WHERE prioritycode = 'Medium'),
       '2026-08-16', '2026-09-16', 2, 'Create this project');
  `);
});

after(async () => {
  resetPoolForTesting();
  await pool.end();
});

test('PROJECT_CREATE activation performs only PendingActivation to Active once', async () => {
  assert.equal(await activatePendingProject(1), true);
  const status = await pool.query(
    `SELECT ps.statuscode FROM work.projects p
       JOIN work.projectstatuses ps ON ps.projectstatusid = p.projectstatusid
      WHERE p.projectid = 1`
  );
  assert.equal(status.rows[0].statuscode, 'Active');
  assert.equal(await activatePendingProject(1), false);
});
