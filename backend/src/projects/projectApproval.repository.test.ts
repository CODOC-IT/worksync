import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { newDb } from 'pg-mem';
import type { Pool } from 'pg';
import { resetPoolForTesting, setPoolForTesting } from '../db/pool.js';
import {
  decideApprovalRequest,
  findApprovalRequestById,
  findApprovalRequestsForUser,
  findPendingApprovalRequests,
  insertApprovalRequest
} from './projectApproval.repository.js';

const db = newDb();
const adapter = db.adapters.createPg();
const pool = new adapter.Pool();

before(async () => {
  setPoolForTesting(pool as unknown as Pool);
  await pool.query(`
    CREATE SCHEMA work;
    CREATE TABLE work.ProjectApprovalRequests (
      ApprovalRequestId BIGSERIAL PRIMARY KEY,
      ProjectId INT NOT NULL,
      RequestType VARCHAR(30) NOT NULL,
      RequestedByUserId INT NOT NULL,
      RequestedChangesJson TEXT NULL,
      Reason VARCHAR(1000) NOT NULL,
      RequestStatus VARCHAR(20) NOT NULL DEFAULT 'Pending',
      ReviewedByUserId INT NULL,
      DecisionReason VARCHAR(1000) NULL,
      CreatedAtUtc TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      DecidedAtUtc TIMESTAMPTZ NULL
    )
  `);
});

beforeEach(async () => {
  await pool.query('DELETE FROM work.projectapprovalrequests');
});

after(async () => {
  resetPoolForTesting();
  await pool.end();
});

test('persists and loads requests through the lowercase-folded project approval table', async () => {
  const id = await insertApprovalRequest({
    projectId: 42,
    requestType: 'PROJECT_EDIT',
    requestedByUserId: 7,
    requestedChangesJson: JSON.stringify({ title: 'Updated title' }),
    reason: 'The project scope changed.'
  });

  const created = await findApprovalRequestById(id);
  assert.equal(created?.projectid, 42);
  assert.equal(created?.requesttype, 'PROJECT_EDIT');
  assert.equal(created?.requeststatus, 'Pending');

  assert.equal((await findPendingApprovalRequests()).length, 1);
  assert.equal((await findApprovalRequestsForUser(7)).length, 1);

  const decided = await decideApprovalRequest(id, 'Approved', 1, 'Approved by Admin.');
  assert.equal(decided?.requeststatus, 'Approved');
  assert.equal(decided?.reviewedbyuserid, 1);
  assert.equal((await findPendingApprovalRequests()).length, 0);
});
