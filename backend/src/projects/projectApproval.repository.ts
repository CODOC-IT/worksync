import { query, withTransaction } from '../db/pool.js';
import { ProjectApprovalRequestRow, ProjectApprovalRequestType } from './projectApproval.types.js';

// Repository = data access only for work.ProjectApprovalRequests (database/25_project_approvals.sql).
// No authorization decisions here -- those belong to projectApproval.service.ts, matching every
// other module's layering (project.repository.ts, notification.repository.ts, ...).

const COLUMNS = `
  approvalrequestid, projectid, requesttype, requestedbyuserid, requestedchangesjson,
  reason, requeststatus, reviewedbyuserid, decisionreason, createdatutc, decidedatutc
`;

export interface InsertApprovalRequestInput {
  projectId: number;
  requestType: ProjectApprovalRequestType;
  requestedByUserId: number;
  requestedChangesJson: string | null;
  reason: string;
}

export const insertApprovalRequest = async (input: InsertApprovalRequestInput): Promise<string> => {
  const result = await query<{ approvalrequestid: string }>(
    `INSERT INTO work.projectapprovalrequests
       (projectid, requesttype, requestedbyuserid, requestedchangesjson, reason)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING approvalrequestid`,
    [input.projectId, input.requestType, input.requestedByUserId, input.requestedChangesJson, input.reason]
  );
  return result.rows[0].approvalrequestid;
};

export const findApprovalRequestById = async (id: string): Promise<ProjectApprovalRequestRow | null> => {
  const result = await query<ProjectApprovalRequestRow>(
    `SELECT ${COLUMNS} FROM work.projectapprovalrequests WHERE approvalrequestid = $1`,
    [id]
  );
  return result.rows[0] || null;
};

// Admin's Approval Inbox: every Pending request, across all projects -- Admin is the sole
// approver for this workflow (see projectApproval.service.ts's authorization checks).
export const findPendingApprovalRequests = async (): Promise<ProjectApprovalRequestRow[]> => {
  const result = await query<ProjectApprovalRequestRow>(
    `SELECT ${COLUMNS} FROM work.projectapprovalrequests
      WHERE requeststatus = 'Pending'
      ORDER BY createdatutc DESC, approvalrequestid DESC`
  );
  return result.rows;
};

// A Team Lead's own submitted requests (any status), so they can see what they've asked for and
// its outcome -- mirrors GET /api/hr-requests' "requesters retain read access to their own
// history" convention (backend/src/routes/hrRequestRoutes.ts).
export const findApprovalRequestsForUser = async (userId: number): Promise<ProjectApprovalRequestRow[]> => {
  const result = await query<ProjectApprovalRequestRow>(
    `SELECT ${COLUMNS} FROM work.projectapprovalrequests
      WHERE requestedbyuserid = $1
      ORDER BY createdatutc DESC`,
    [userId]
  );
  return result.rows;
};

// Locks the row before deciding, matching hrRequestRoutes.ts's decideRequest -- prevents two
// concurrent approve/reject calls (or a double-click) from both succeeding. Returns null if the
// row is missing or was no longer Pending by the time the lock was acquired (already decided, or
// -- for an approved PROJECT_PERMANENT_DELETE -- already cascade-deleted along with its project;
// projectApproval.service.ts handles that specific case).
export const decideApprovalRequest = async (
  id: string,
  decision: 'Approved' | 'Rejected',
  reviewedByUserId: number,
  decisionReason: string | null
): Promise<ProjectApprovalRequestRow | null> =>
  withTransaction(async (runQuery) => {
    const locked = await runQuery<ProjectApprovalRequestRow>(
      `SELECT ${COLUMNS} FROM work.projectapprovalrequests WHERE approvalrequestid = $1 FOR UPDATE`,
      [id]
    );
    const row = locked.rows[0];
    if (!row || row.requeststatus !== 'Pending') return null;

    const updated = await runQuery<ProjectApprovalRequestRow>(
      `UPDATE work.projectapprovalrequests
          SET requeststatus = $1, reviewedbyuserid = $2, decisionreason = $3, decidedatutc = CURRENT_TIMESTAMP
        WHERE approvalrequestid = $4
        RETURNING ${COLUMNS}`,
      [decision, reviewedByUserId, decisionReason, id]
    );
    return updated.rows[0] || null;
  });
