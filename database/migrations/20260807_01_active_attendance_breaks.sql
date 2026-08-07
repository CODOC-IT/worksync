CREATE TABLE IF NOT EXISTS public.worksync_active_attendance_breaks (
  user_id TEXT PRIMARY KEY,
  work_date DATE NOT NULL,
  break_id TEXT NOT NULL,
  break_type TEXT NOT NULL,
  started_at_utc TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

