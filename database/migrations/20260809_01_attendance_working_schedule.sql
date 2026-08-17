-- Attendance Working Schedule configuration support.

-- 1) Allow overnight schedules.
-- The previous CHECK required EndTime > StartTime, which made a shift that crosses
-- midnight (16:00 -> 00:00) impossible to store. A working-day row now only requires
-- that the shift does not start and end at the same wall-clock time; EndTime <
-- StartTime is interpreted as "crosses midnight into the next calendar day".
ALTER TABLE hr.WorkScheduleDays
    DROP CONSTRAINT IF EXISTS CK_WorkScheduleDays_Times;

ALTER TABLE hr.WorkScheduleDays
    ADD CONSTRAINT CK_WorkScheduleDays_Times CHECK (
        (IsWorkingDay IS FALSE AND StartTime IS NULL AND EndTime IS NULL) OR
        (IsWorkingDay IS TRUE AND StartTime IS NOT NULL AND EndTime IS NOT NULL
         AND EndTime IS DISTINCT FROM StartTime)
    );

-- 2) Single source of truth for schedule-window duration (minutes).
--    Overnight-aware: EndTime > StartTime  -> End - Start
--                     EndTime < StartTime  -> 1440 - Start + End
--                     EndTime = StartTime  -> 0 (invalid, rejected by validation)
CREATE OR REPLACE FUNCTION hr.schedule_window_minutes(start_time TIME, end_time TIME)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN start_time IS NULL OR end_time IS NULL THEN NULL
        WHEN (EXTRACT(HOUR FROM end_time) * 60 + EXTRACT(MINUTE FROM end_time)) >
             (EXTRACT(HOUR FROM start_time) * 60 + EXTRACT(MINUTE FROM start_time))
            THEN (EXTRACT(HOUR FROM end_time) * 60 + EXTRACT(MINUTE FROM end_time))
               - (EXTRACT(HOUR FROM start_time) * 60 + EXTRACT(MINUTE FROM start_time))
        WHEN (EXTRACT(HOUR FROM end_time) * 60 + EXTRACT(MINUTE FROM end_time)) <
             (EXTRACT(HOUR FROM start_time) * 60 + EXTRACT(MINUTE FROM start_time))
            THEN 1440 + (EXTRACT(HOUR FROM end_time) * 60 + EXTRACT(MINUTE FROM end_time))
               - (EXTRACT(HOUR FROM start_time) * 60 + EXTRACT(MINUTE FROM start_time))
        ELSE 0
    END::INTEGER
$$;

-- 3) Net expected working minutes for a schedule day = window - break allowance.
CREATE OR REPLACE FUNCTION hr.schedule_net_minutes(
    start_time TIME,
    end_time TIME,
    break_minutes INTEGER
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT GREATEST(0,
        COALESCE(hr.schedule_window_minutes(start_time, end_time), 0) -
        COALESCE(break_minutes, 0)
    )
$$;

-- 4) Seed one default working schedule per organization: 16:00 -> 00:00 PKT,
--    60-minute break, Monday-Friday working days. This is the value Administrators
--    later tune with the schedule configuration endpoint. Idempotent: an existing
--    default schedule for an organization is left untouched.
INSERT INTO hr.WorkSchedules
    (OrganizationId, ScheduleName, EffectiveFrom, GraceMinutes, IsDefault, CreatedByUserId, CreatedAtUtc)
SELECT o.OrganizationId, 'Default Attendance Work Schedule', CURRENT_DATE, 0, TRUE,
       COALESCE((
           SELECT UserId FROM iam.Users
            WHERE OrganizationId = o.OrganizationId
              AND Email = 'system@worksync.internal'
            LIMIT 1
       ), o.OrganizationId * 1000 + 1),
       CURRENT_TIMESTAMP
FROM org.Organizations o
WHERE o.IsActive
  AND NOT EXISTS (
      SELECT 1 FROM hr.WorkSchedules ws
       WHERE ws.OrganizationId = o.OrganizationId AND ws.IsDefault
  );

INSERT INTO hr.WorkScheduleDays
    (WorkScheduleId, IsoWeekday, IsWorkingDay, StartTime, EndTime, BreakMinutes)
SELECT ws.WorkScheduleId, wd, (wd <= 5),
       CASE WHEN wd <= 5 THEN TIME '16:00' ELSE NULL END,
       CASE WHEN wd <= 5 THEN TIME '00:00' ELSE NULL END,
       60
FROM hr.WorkSchedules ws
CROSS JOIN generate_series(1, 7) AS wd
WHERE ws.IsDefault
  AND NOT EXISTS (
      SELECT 1 FROM hr.WorkScheduleDays wsd
       WHERE wsd.WorkScheduleId = ws.WorkScheduleId AND wsd.IsoWeekday = wd
  );