-- Seeds hr.Holidays with the holiday set previously hardcoded in
-- frontend/src/features/calendar/pakistanHolidays.ts, now that hr.Holidays (via
-- backend/src/calendar/calendar.*) is the single source of truth for Calendar's holiday display.
-- Fixed-date holidays get IsRecurringAnnual = TRUE (one representative row; the Calendar module
-- re-derives month/day and repeats it across every displayed year, exactly like the old static
-- file's getPakistanHolidays() did). Islamic/Hindu lunar-calendar holidays get
-- IsRecurringAnnual = FALSE, one dated row per year, matching the old per-year table -- HR adds a
-- new row each year going forward instead of a code deploy.
--
-- Idempotent: ON CONFLICT against UQ_Holidays_ScopeDateName (safe to re-run).
INSERT INTO hr.Holidays (OrganizationId, DepartmentId, HolidayName, HolidayDate, IsRecurringAnnual, CreatedByUserId)
SELECT 1, NULL, v.holiday_name, v.holiday_date::date, v.is_recurring, sys.UserId
FROM (
    VALUES
        -- Fixed-date, recurring every year (month/day only matters; year is a representative anchor)
        ('Kashmir Day', '2026-02-05', TRUE),
        ('Pakistan Day', '2026-03-23', TRUE),
        ('Labour Day', '2026-05-01', TRUE),
        ('Independence Day', '2026-08-14', TRUE),
        ('Quaid-e-Azam Day', '2026-12-25', TRUE),
        ('Christmas Day', '2026-12-25', TRUE),

        -- Islamic/Hindu lunar-calendar holidays, one dated row per year (not recurring)
        ('Eid-ul-Fitr', '2024-04-10', FALSE),
        ('Eid-ul-Adha', '2024-06-17', FALSE),
        ('Ashura', '2024-07-17', FALSE),
        ('Holi', '2024-03-25', FALSE),
        ('Diwali', '2024-11-01', FALSE),

        ('Eid-ul-Fitr', '2025-03-31', FALSE),
        ('Eid-ul-Adha', '2025-06-07', FALSE),
        ('Ashura', '2025-07-06', FALSE),
        ('Holi', '2025-03-14', FALSE),
        ('Diwali', '2025-10-20', FALSE),

        ('Eid-ul-Fitr', '2026-03-20', FALSE),
        ('Eid-ul-Adha', '2026-05-27', FALSE),
        ('Ashura', '2026-06-26', FALSE),
        ('Holi', '2026-03-03', FALSE),
        ('Diwali', '2026-11-08', FALSE),

        ('Eid-ul-Fitr', '2027-03-10', FALSE),
        ('Eid-ul-Adha', '2027-05-17', FALSE),
        ('Ashura', '2027-06-16', FALSE),
        ('Holi', '2027-03-22', FALSE),
        ('Diwali', '2027-10-29', FALSE),

        ('Eid-ul-Fitr', '2028-02-27', FALSE),
        ('Eid-ul-Adha', '2028-05-05', FALSE),
        ('Ashura', '2028-06-04', FALSE),
        ('Holi', '2028-03-11', FALSE),
        ('Diwali', '2028-10-17', FALSE),

        ('Eid-ul-Fitr', '2029-02-15', FALSE),
        ('Eid-ul-Adha', '2029-04-24', FALSE),
        ('Ashura', '2029-05-24', FALSE),
        ('Holi', '2029-02-28', FALSE),
        ('Diwali', '2029-11-05', FALSE)
) AS v(holiday_name, holiday_date, is_recurring)
CROSS JOIN (
    SELECT UserId FROM iam.Users WHERE OrganizationId = 1 AND Email = 'system@worksync.internal'
) AS sys
ON CONFLICT (OrganizationId, DepartmentId, HolidayDate, HolidayName) DO NOTHING;
