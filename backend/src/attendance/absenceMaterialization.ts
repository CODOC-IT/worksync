import { query } from '../db/pool.js';
import { DEFAULT_BUSINESS_TIME_ZONE } from './businessTime.js';

export const materializeAbsences = async (from: string, to: string): Promise<void> => {
  await query(
    `DELETE FROM hr.attendancerecords ar
      USING iam.users u, org.organizations o
      WHERE ar.userid = u.userid
        AND o.organizationid = u.organizationid
        AND ar.sourcecode = 'System'
        AND ar.workdate BETWEEN $1::date AND $2::date
        AND (
          ar.workdate < (u.createdatutc AT TIME ZONE COALESCE(o.timezoneid, '${DEFAULT_BUSINESS_TIME_ZONE}'))::date
          OR (u.deactivatedatutc IS NOT NULL
              AND ar.workdate >= (u.deactivatedatutc AT TIME ZONE COALESCE(o.timezoneid, '${DEFAULT_BUSINESS_TIME_ZONE}'))::date)
          OR EXISTS (
            SELECT 1 FROM iam.userroles ur JOIN iam.roles r ON r.roleid = ur.roleid
             WHERE ur.userid = u.userid AND r.rolecode = 'Administrator'
               AND ur.startsatutc < ar.workdate + interval '1 day'
               AND (ur.endsatutc IS NULL OR ur.endsatutc > ar.workdate)
          )
        )`,
    [from, to]
  );
  await query(
    `INSERT INTO hr.attendancerecords
       (userid, workdate, workscheduleid, attendancestatusid, scheduledstarttime,
        scheduledendtime, workingminutes, sourcecode, updatedatutc)
     SELECT u.userid, day.workdate, schedule.workscheduleid,
            (SELECT attendancestatusid FROM hr.attendancestatuses WHERE statuscode = 'Absent'),
            wsd.starttime, wsd.endtime, 0, 'System', CURRENT_TIMESTAMP
       FROM iam.users u
       JOIN org.organizations o ON o.organizationid = u.organizationid
       LEFT JOIN iam.userprofiles profile ON profile.userid = u.userid
       CROSS JOIN LATERAL generate_series(
         GREATEST(
           $1::date,
           (u.createdatutc AT TIME ZONE COALESCE(profile.timezoneid, o.timezoneid, '${DEFAULT_BUSINESS_TIME_ZONE}'))::date,
           COALESCE((
             SELECT MIN((ur_start.startsatutc AT TIME ZONE COALESCE(profile.timezoneid, o.timezoneid, '${DEFAULT_BUSINESS_TIME_ZONE}'))::date)
               FROM iam.userroles ur_start
               JOIN iam.roles r_start ON r_start.roleid = ur_start.roleid
              WHERE ur_start.userid = u.userid
                AND r_start.rolecode <> 'Administrator'
           ), (u.createdatutc AT TIME ZONE COALESCE(profile.timezoneid, o.timezoneid, '${DEFAULT_BUSINESS_TIME_ZONE}'))::date)
         ),
         LEAST(
           $2::date,
           (CURRENT_TIMESTAMP AT TIME ZONE COALESCE(profile.timezoneid, o.timezoneid, '${DEFAULT_BUSINESS_TIME_ZONE}'))::date - 1,
           COALESCE(
             (u.deactivatedatutc AT TIME ZONE COALESCE(profile.timezoneid, o.timezoneid, '${DEFAULT_BUSINESS_TIME_ZONE}'))::date - 1,
             $2::date
           )
         ),
          interval '1 day'
        ) AS day(workdate)
       LEFT JOIN LATERAL (
         SELECT ws.workscheduleid
           FROM hr.workschedules ws
           LEFT JOIN hr.userworkscheduleassignments uwa
             ON uwa.workscheduleid = ws.workscheduleid AND uwa.userid = u.userid
            AND uwa.effectivefrom <= day.workdate
            AND (uwa.effectiveto IS NULL OR uwa.effectiveto >= day.workdate)
          WHERE ws.organizationid = u.organizationid
            AND ws.effectivefrom <= day.workdate
            AND (ws.effectiveto IS NULL OR ws.effectiveto >= day.workdate)
            AND (uwa.userid IS NOT NULL OR ws.isdefault)
          ORDER BY (uwa.userid IS NOT NULL) DESC, ws.effectivefrom DESC
          LIMIT 1
       ) schedule ON TRUE
       LEFT JOIN hr.workscheduledays wsd
         ON wsd.workscheduleid = schedule.workscheduleid
        AND wsd.isoweekday = EXTRACT(ISODOW FROM day.workdate)
      WHERE COALESCE(wsd.isworkingday, EXTRACT(ISODOW FROM day.workdate) < 6)
        AND NOT EXISTS (
          SELECT 1 FROM iam.userroles ur JOIN iam.roles r ON r.roleid = ur.roleid
           WHERE ur.userid = u.userid AND r.rolecode = 'Administrator'
             AND ur.revokedatutc IS NULL AND ur.startsatutc < day.workdate + interval '1 day'
             AND (ur.endsatutc IS NULL OR ur.endsatutc > day.workdate)
        )
        AND EXISTS (
          SELECT 1 FROM iam.userroles ur JOIN iam.roles r ON r.roleid = ur.roleid
           WHERE ur.userid = u.userid AND r.rolecode <> 'Administrator'
             AND ur.startsatutc < day.workdate + interval '1 day'
             AND (ur.endsatutc IS NULL OR ur.endsatutc > day.workdate)
             AND (ur.revokedatutc IS NULL OR ur.revokedatutc > day.workdate)
        )
        AND NOT EXISTS (
          SELECT 1 FROM hr.holidays h
           WHERE h.organizationid = u.organizationid
             AND (h.departmentid IS NULL OR h.departmentid = u.departmentid)
             AND (h.holidaydate = day.workdate OR
                  (h.isrecurringannual AND to_char(h.holidaydate, 'MM-DD') = to_char(day.workdate, 'MM-DD')))
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.worksync_hr_requests wr
           WHERE wr.user_id = 'usr-' || u.userid AND wr.request_date = day.workdate
             AND wr.request_type = 'Leave' AND wr.status = 'Approved'
        )
     ON CONFLICT (userid, workdate) DO NOTHING`,
    [from, to]
  );
};
