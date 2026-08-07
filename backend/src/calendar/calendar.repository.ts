import { query, withTransaction } from '../db/pool.js';

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

export const getBusinessDate = async (): Promise<string> => {
  const result = await query<{ today: string }>('SELECT CURRENT_DATE::text AS today');
  return result.rows[0].today;
};

export type HolidayAudienceType = 'Everyone' | 'Department' | 'Users';

export interface HolidayRow {
  holidayid: number;
  holidayname: string;
  holidaydate: string;
  isrecurringannual: boolean;
  audiencetype: HolidayAudienceType;
  createdbyuserid: number;
  createdatutc: Date;
}

const HOLIDAY_COLUMNS = `
  holidayid, holidayname, holidaydate::text AS holidaydate, isrecurringannual, audiencetype,
  createdbyuserid, createdatutc
`;

// Every holiday the viewer is allowed to see -- Admin/HR (an org-wide bypass, same convention as
// project.service.ts's isProjectAccessible) always get every holiday, unfiltered; everyone else
// only sees 'Everyone'-audience holidays plus whichever 'Department'/'Users' holidays their own
// department/id is targeted by. `viewerId` is only read when `bypass` is false (Admin/HR pass a
// throwaway value from the service layer).
export const findHolidays = async (viewerId: number, bypass: boolean): Promise<HolidayRow[]> => {
  const result = await query<HolidayRow>(
    `SELECT ${HOLIDAY_COLUMNS} FROM hr.holidays h
      WHERE h.organizationid = $1
        AND (
          $2::boolean
          OR h.audiencetype = 'Everyone'
          OR (h.audiencetype = 'Department' AND EXISTS (
                SELECT 1 FROM hr.holidayaudiencedepartments had
                JOIN iam.users viewer ON viewer.departmentid = had.departmentid
                WHERE had.holidayid = h.holidayid AND viewer.userid = $3
              ))
          OR (h.audiencetype = 'Users' AND EXISTS (
                SELECT 1 FROM hr.holidayaudienceusers hau
                WHERE hau.holidayid = h.holidayid AND hau.userid = $3
              ))
        )
      ORDER BY h.holidaydate`,
    [ORGANIZATION_ID, bypass, viewerId]
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

export interface HolidayAudienceRow {
  holidayid: number;
  departmentid: number;
}

export interface HolidayAudienceUserRow {
  holidayid: number;
  userid: number;
}

// Batched, mirroring project.repository.ts's findMembersForProjects/findMilestonesForProjects --
// one query for however many holidays listHolidays just returned, rather than one per holiday.
export const findAudienceDepartmentsForHolidays = async (holidayIds: number[]): Promise<HolidayAudienceRow[]> => {
  if (holidayIds.length === 0) return [];
  const result = await query<HolidayAudienceRow>(
    `SELECT holidayid, departmentid FROM hr.holidayaudiencedepartments WHERE holidayid = ANY($1)`,
    [holidayIds]
  );
  return result.rows;
};

export const findAudienceUsersForHolidays = async (holidayIds: number[]): Promise<HolidayAudienceUserRow[]> => {
  if (holidayIds.length === 0) return [];
  const result = await query<HolidayAudienceUserRow>(
    `SELECT holidayid, userid FROM hr.holidayaudienceusers WHERE holidayid = ANY($1)`,
    [holidayIds]
  );
  return result.rows;
};

export interface DepartmentOptionRow {
  departmentid: number;
  departmentname: string;
}

// Every active department in the org, for the Manage Holidays audience picker -- deliberately NOT
// accounts.service.ts's listPermittedDepartments, which scopes its result to the calling HR
// actor's own iam.HrDepartmentScopes hierarchy (built for member-provisioning authorization).
// Holiday management has never been department-scoped (assertIsHR below has no department
// dimension), so HR must be able to target any department, not just the ones they're scoped to
// manage members within.
export const findAllActiveDepartments = async (): Promise<DepartmentOptionRow[]> => {
  const result = await query<DepartmentOptionRow>(
    `SELECT departmentid, departmentname FROM org.departments
      WHERE organizationid = $1 AND isactive = TRUE
      ORDER BY departmentname`,
    [ORGANIZATION_ID]
  );
  return result.rows;
};

// Existence check for a Department-audience payload -- lets the service reject unknown
// department ids with a clean 400 instead of a raw FK-violation error.
export const findExistingDepartmentIds = async (departmentIds: number[]): Promise<number[]> => {
  if (departmentIds.length === 0) return [];
  const result = await query<{ departmentid: number }>(
    `SELECT departmentid FROM org.departments WHERE organizationid = $1 AND departmentid = ANY($2)`,
    [ORGANIZATION_ID, departmentIds]
  );
  return result.rows.map((row) => row.departmentid);
};

// Recipient resolution for the 'Everyone' audience -- every active user in the org. A direct
// query rather than userStore.getAllUsers() so it stays consistent with the department-join query
// below, which needs a real SQL join and has no userStore equivalent.
export const findActiveUserIds = async (): Promise<number[]> => {
  const result = await query<{ userid: number }>(
    `SELECT userid FROM iam.users WHERE organizationid = $1 AND accountstatus = 'Active'`,
    [ORGANIZATION_ID]
  );
  return result.rows.map((row) => row.userid);
};

// Recipient resolution for the 'Department' audience -- active users whose own DepartmentId is
// one of the holiday's selected departments. Joins the real DepartmentId FK directly rather than
// matching through userStore's display-name `department` field.
export const findActiveUserIdsForDepartments = async (departmentIds: number[]): Promise<number[]> => {
  if (departmentIds.length === 0) return [];
  const result = await query<{ userid: number }>(
    `SELECT userid FROM iam.users
      WHERE organizationid = $1 AND accountstatus = 'Active' AND departmentid = ANY($2)`,
    [ORGANIZATION_ID, departmentIds]
  );
  return result.rows.map((row) => row.userid);
};

export interface InsertHolidayInput {
  name: string;
  date: string;
  isRecurringAnnual: boolean;
  audienceType: HolidayAudienceType;
  departmentIds: number[];
  userIds: number[];
  createdByUserId: number;
}

const insertAudienceRows = async (
  runQuery: typeof query,
  holidayId: number,
  audienceType: HolidayAudienceType,
  departmentIds: number[],
  userIds: number[]
): Promise<void> => {
  if (audienceType === 'Department' && departmentIds.length > 0) {
    await runQuery(
      `INSERT INTO hr.holidayaudiencedepartments (holidayid, departmentid)
       SELECT $1, unnest($2::int[])`,
      [holidayId, departmentIds]
    );
  } else if (audienceType === 'Users' && userIds.length > 0) {
    await runQuery(
      `INSERT INTO hr.holidayaudienceusers (holidayid, userid)
       SELECT $1, unnest($2::int[])`,
      [holidayId, userIds]
    );
  }
};

// Holiday + its audience rows are written atomically (withTransaction, same helper
// project.repository.ts already uses for project + members writes) so a holiday can never persist
// with a partially-written audience.
export const insertHoliday = async (input: InsertHolidayInput): Promise<number> =>
  withTransaction(async (runQuery) => {
    const result = await runQuery<{ holidayid: number }>(
      `INSERT INTO hr.holidays (organizationid, departmentid, holidayname, holidaydate, isrecurringannual, audiencetype, createdbyuserid)
       VALUES ($1, NULL, $2, $3, $4, $5, $6)
       RETURNING holidayid`,
      [ORGANIZATION_ID, input.name, input.date, input.isRecurringAnnual, input.audienceType, input.createdByUserId]
    );
    const holidayId = result.rows[0].holidayid;
    await insertAudienceRows(runQuery, holidayId, input.audienceType, input.departmentIds, input.userIds);
    return holidayId;
  });

export interface UpdateHolidayInput {
  name?: string;
  date?: string;
  isRecurringAnnual?: boolean;
  // All three are provided together whenever the audience changes (see calendar.service.ts's
  // validateAudience) -- their presence is what signals "replace the audience", not just
  // audienceType alone.
  audienceType?: HolidayAudienceType;
  departmentIds?: number[];
  userIds?: number[];
}

export const updateHoliday = async (id: number, updates: UpdateHolidayInput): Promise<boolean> =>
  withTransaction(async (runQuery) => {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    const addSet = (column: string, value: unknown) => {
      params.push(value);
      setClauses.push(`${column} = $${params.length}`);
    };

    if (updates.name !== undefined) addSet('holidayname', updates.name);
    if (updates.date !== undefined) addSet('holidaydate', updates.date);
    if (updates.isRecurringAnnual !== undefined) addSet('isrecurringannual', updates.isRecurringAnnual);
    if (updates.audienceType !== undefined) addSet('audiencetype', updates.audienceType);

    let updatedRow = setClauses.length === 0;
    if (setClauses.length > 0) {
      params.push(id, ORGANIZATION_ID);
      const result = await runQuery(
        `UPDATE hr.holidays SET ${setClauses.join(', ')}
          WHERE holidayid = $${params.length - 1} AND organizationid = $${params.length}`,
        params
      );
      updatedRow = (result.rowCount ?? 0) > 0;
    }

    // Full replace rather than diffing -- holiday audiences are small, low-frequency edits, so
    // delete-then-reinsert inside the same transaction is simpler and equally correct.
    if (updates.audienceType !== undefined) {
      await runQuery('DELETE FROM hr.holidayaudiencedepartments WHERE holidayid = $1', [id]);
      await runQuery('DELETE FROM hr.holidayaudienceusers WHERE holidayid = $1', [id]);
      await insertAudienceRows(runQuery, id, updates.audienceType, updates.departmentIds || [], updates.userIds || []);
    }

    return updatedRow;
  });

export const deleteHoliday = async (id: number): Promise<boolean> => {
  // hr.HolidayAudienceDepartments/Users both FK HolidayId with ON DELETE CASCADE (see
  // database/28_holiday_audience.sql) -- their rows are cleaned up automatically, no explicit
  // delete needed here.
  const result = await query('DELETE FROM hr.holidays WHERE holidayid = $1 AND organizationid = $2', [
    id,
    ORGANIZATION_ID
  ]);
  return (result.rowCount ?? 0) > 0;
};
