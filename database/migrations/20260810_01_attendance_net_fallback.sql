-- Align hr.schedule_net_minutes with the TypeScript workingSchedule.ts fallback so the
-- backend and the SQL single source of truth agree. The TS helper returns the fixed 7-hour
-- net expectation (DEFAULT_SHIFT_NET_MINUTES = 420) when no window is known; the earlier
-- version of this function instead returned 0 for a missing window, which would classify an
-- un-scheduled day as Short Hours even though everyone falls back to the 420-minute norm.
-- Safe to run more than once: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION hr.schedule_net_minutes(
    start_time TIME,
    end_time TIME,
    break_minutes INTEGER
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN hr.schedule_window_minutes(start_time, end_time) IS NULL THEN 420
        ELSE GREATEST(0,
            hr.schedule_window_minutes(start_time, end_time) -
            COALESCE(break_minutes, 0)
        )
    END
$$;