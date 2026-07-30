import { query } from '../db/pool.js';

// Read-only view onto approved Leave requests, for Calendar display only. This file never
// writes to public.worksync_hr_requests and never touches the HR approval flow that owns it
// (backend/src/routes/hrRequestRoutes.ts) -- it only SELECTs, matching the precedent already set
// by project.repository.ts reading work.ProjectMembers directly for read-only display purposes.
//
// That table is created lazily by hrRequestRoutes.ts's own ensureTable() the first time an HR
// request handler runs, not by a schema migration -- so on a fresh database it may not exist yet
// when Calendar queries it. Rather than depend on (or duplicate) that bootstrap, a missing-table
// error (Postgres 42P01) is treated the same as "no approved leave yet" and simply returns [].
export interface ApprovedLeaveRow {
  id: string;
  user_id: string;
  user_name: string | null;
  request_date: string;
  details: Record<string, unknown> | string | null;
}

const UNDEFINED_TABLE = '42P01';

export const findApprovedLeave = async (): Promise<ApprovedLeaveRow[]> => {
  try {
    const result = await query<ApprovedLeaveRow>(
      `SELECT id, user_id, user_name, request_date::text AS request_date, details
         FROM public.worksync_hr_requests
        WHERE request_type = 'Leave' AND status = 'Approved'
        ORDER BY request_date`
    );
    return result.rows;
  } catch (error) {
    if ((error as { code?: string } | null)?.code === UNDEFINED_TABLE) return [];
    throw error;
  }
};
