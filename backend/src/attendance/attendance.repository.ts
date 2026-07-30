import { query } from '../db/pool.js';

export const upsertAttendanceRecord = async (
  userPk: number,
  workDate: string,
  checkInUtc: string,
  statusCode: string
): Promise<number> => {
  const result = await query<{ attendancerecordid: number }>(
    `INSERT INTO hr.attendancerecords
       (userid, workdate, attendancestatusid, actualcheckinatutc, workingminutes, sourcecode, updatedatutc)
     VALUES ($1, $2::date,
       (SELECT attendancestatusid FROM hr.attendancestatuses WHERE statuscode = $3),
       $4::timestamptz, 0, 'SelfService', CURRENT_TIMESTAMP)
     ON CONFLICT (userid, workdate) DO UPDATE SET
       actualcheckinatutc = COALESCE(EXCLUDED.actualcheckinatutc, hr.attendancerecords.actualcheckinatutc),
       attendancestatusid = CASE WHEN EXCLUDED.actualcheckinatutc IS NOT NULL
         THEN (SELECT attendancestatusid FROM hr.attendancestatuses WHERE statuscode = $3)
         ELSE hr.attendancerecords.attendancestatusid END,
       updatedatutc = CURRENT_TIMESTAMP
     RETURNING attendancerecordid`,
    [userPk, workDate, statusCode, checkInUtc]
  );
  return result.rows[0]?.attendancerecordid;
};

export const updateAttendanceCheckOut = async (
  attendanceRecordId: number,
  checkOutUtc: string
): Promise<void> => {
  await query(
    `UPDATE hr.attendancerecords
     SET actualcheckoutatutc = $2::timestamptz,
         workingminutes = GREATEST(0, EXTRACT(EPOCH FROM ($2::timestamptz - actualcheckinatutc)) / 60)::int,
         updatedatutc = CURRENT_TIMESTAMP
     WHERE attendancerecordid = $1`,
    [attendanceRecordId, checkOutUtc]
  );
};

export const insertAttendancePunch = async (
  attendanceRecordId: number,
  punchType: 'CheckIn' | 'CheckOut',
  punchedAtUtc: string,
  recordedByUserPk: number
): Promise<void> => {
  await query(
    `INSERT INTO hr.attendancepunches
       (attendancerecordid, punchtype, punchedatutc, recordedbyuserid, sourcecode)
     VALUES ($1, $2, $3::timestamptz, $4, 'SelfService')`,
    [attendanceRecordId, punchType, punchedAtUtc, recordedByUserPk]
  );
};
