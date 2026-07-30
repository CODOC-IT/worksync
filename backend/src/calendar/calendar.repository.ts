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

// hr.Holidays (database/06_hr_tables.sql) is a real, versioned table -- unlike
// public.worksync_hr_requests above, it needs no missing-table fallback. Single-tenant app, same
// OrganizationId = 1 convention as project.repository.ts.
const ORGANIZATION_ID = 1;

export interface HolidayRow {
  holidayid: number;
  holidayname: string;
  holidaydate: string;
  isrecurringannual: boolean;
  createdbyuserid: number;
  createdatutc: Date;
}

const HOLIDAY_COLUMNS = `
  holidayid, holidayname, holidaydate::text AS holidaydate, isrecurringannual, createdbyuserid, createdatutc
`;

// Every holiday, for display -- Calendar shows the same set to every role (see
// calendar.service.ts's listHolidays); only create/update/delete are HR-gated.
export const findHolidays = async (): Promise<HolidayRow[]> => {
  const result = await query<HolidayRow>(
    `SELECT ${HOLIDAY_COLUMNS} FROM hr.holidays WHERE organizationid = $1 ORDER BY holidaydate`,
    [ORGANIZATION_ID]
  );
  return result.rows;
};

export const findHolidayById = async (id: number): Promise<HolidayRow | null> => {
  const result = await query<HolidayRow>(
    `SELECT ${HOLIDAY_COLUMNS} FROM hr.holidays WHERE holidayid = $1 AND organizationid = $2`,
    [id, ORGANIZATION_ID]
  );
  return result.rows[0] || null;
};

export interface InsertHolidayInput {
  name: string;
  date: string;
  isRecurringAnnual: boolean;
  createdByUserId: number;
}

export const insertHoliday = async (input: InsertHolidayInput): Promise<number> => {
  const result = await query<{ holidayid: number }>(
    `INSERT INTO hr.holidays (organizationid, departmentid, holidayname, holidaydate, isrecurringannual, createdbyuserid)
     VALUES ($1, NULL, $2, $3, $4, $5)
     RETURNING holidayid`,
    [ORGANIZATION_ID, input.name, input.date, input.isRecurringAnnual, input.createdByUserId]
  );
  return result.rows[0].holidayid;
};

export interface UpdateHolidayInput {
  name?: string;
  date?: string;
  isRecurringAnnual?: boolean;
}

export const updateHoliday = async (id: number, updates: UpdateHolidayInput): Promise<boolean> => {
  const setClauses: string[] = [];
  const params: unknown[] = [];
  const addSet = (column: string, value: unknown) => {
    params.push(value);
    setClauses.push(`${column} = $${params.length}`);
  };

  if (updates.name !== undefined) addSet('holidayname', updates.name);
  if (updates.date !== undefined) addSet('holidaydate', updates.date);
  if (updates.isRecurringAnnual !== undefined) addSet('isrecurringannual', updates.isRecurringAnnual);
  if (setClauses.length === 0) return true;

  params.push(id, ORGANIZATION_ID);
  const result = await query(
    `UPDATE hr.holidays SET ${setClauses.join(', ')}
      WHERE holidayid = $${params.length - 1} AND organizationid = $${params.length}`,
    params
  );
  return (result.rowCount ?? 0) > 0;
};

export const deleteHoliday = async (id: number): Promise<boolean> => {
  const result = await query('DELETE FROM hr.holidays WHERE holidayid = $1 AND organizationid = $2', [
    id,
    ORGANIZATION_ID
  ]);
  return (result.rowCount ?? 0) > 0;
};
