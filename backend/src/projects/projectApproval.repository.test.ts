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

test('Team Lead project edit request persists and appears in Admin inbox newest first', async () => {
  const olderId = await insertApprovalRequest({
    projectId: 42,
    requestType: 'PROJECT_EDIT',
    requestedByUserId: 7,
    requestedChangesJson: JSON.stringify({ title: 'First proposal' }),
    reason: 'First scope update'
  });
  const newerId = await insertApprovalRequest({
    projectId: 42,
    requestType: 'PROJECT_EDIT',
    requestedByUserId: 7,
    requestedChangesJson: JSON.stringify({ title: 'Latest proposal' }),
    reason: 'Latest scope update'
  });
  await pool.query(
    `UPDATE work.projectapprovalrequests
        SET createdatutc = CASE approvalrequestid
          WHEN $1 THEN '2026-08-01T00:00:00Z'::timestamptz
          WHEN $2 THEN '2026-08-02T00:00:00Z'::timestamptz
        END`,
    [olderId, newerId]
  );

  const pending = await findPendingApprovalRequests();
  assert.deepEqual(pending.map((item) => item.approvalrequestid), [newerId, olderId]);
  assert.deepEqual(JSON.parse(pending[0].requestedchangesjson || '{}'), { title: 'Latest proposal' });
});

test('rejection persists the required reason for request history and notifications', async () => {
  const id = await insertApprovalRequest({
    projectId: 42,
    requestType: 'PROJECT_EDIT',
    requestedByUserId: 7,
    requestedChangesJson: JSON.stringify({ title: 'Rejected proposal' }),
    reason: 'Requested scope update'
  });
  const decided = await decideApprovalRequest(id, 'Rejected', 1, 'The approved scope must remain unchanged.');
  assert.equal(decided?.requeststatus, 'Rejected');
  assert.equal(decided?.decisionreason, 'The approved scope must remain unchanged.');
  assert.equal((await findApprovalRequestsForUser(7))[0].decisionreason, 'The approved scope must remain unchanged.');
});
