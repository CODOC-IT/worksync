-- Installs holiday audience targeting (Everyone / Department / Users) in existing WorkSync
-- databases. database/28_holiday_audience.sql already installs this for databases created from
-- the current one-time baseline. Also seeds the 'holiday_created' notify.NotificationTypes row
-- (database/18_notify_seed.sql), since notificationService.publishEvent() requires the type to
-- already exist and an existing database won't re-run that baseline seed file.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'hr' AND table_name = 'holidays' AND column_name = 'audiencetype'
    ) THEN
        ALTER TABLE hr.Holidays
            ADD COLUMN AudienceType varchar(20) NOT NULL DEFAULT 'Everyone'
                CONSTRAINT CK_Holidays_AudienceType CHECK (AudienceType IN ('Everyone', 'Department', 'Users'));
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS hr.HolidayAudienceDepartments
(
    HolidayId     int NOT NULL,
    DepartmentId  int NOT NULL,
    CONSTRAINT PK_HolidayAudienceDepartments PRIMARY KEY (HolidayId, DepartmentId)
);

CREATE TABLE IF NOT EXISTS hr.HolidayAudienceUsers
(
    HolidayId  int NOT NULL,
    UserId     int NOT NULL,
    CONSTRAINT PK_HolidayAudienceUsers PRIMARY KEY (HolidayId, UserId)
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_holidayaudiencedepartments_holiday'
          AND conrelid = 'hr.holidayaudiencedepartments'::regclass
    ) THEN
        ALTER TABLE hr.HolidayAudienceDepartments
            ADD CONSTRAINT FK_HolidayAudienceDepartments_Holiday FOREIGN KEY (HolidayId)
                REFERENCES hr.Holidays(HolidayId) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_holidayaudiencedepartments_department'
          AND conrelid = 'hr.holidayaudiencedepartments'::regclass
    ) THEN
        ALTER TABLE hr.HolidayAudienceDepartments
            ADD CONSTRAINT FK_HolidayAudienceDepartments_Department FOREIGN KEY (DepartmentId)
                REFERENCES org.Departments(DepartmentId);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_holidayaudienceusers_holiday'
          AND conrelid = 'hr.holidayaudienceusers'::regclass
    ) THEN
        ALTER TABLE hr.HolidayAudienceUsers
            ADD CONSTRAINT FK_HolidayAudienceUsers_Holiday FOREIGN KEY (HolidayId)
                REFERENCES hr.Holidays(HolidayId) ON DELETE CASCADE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_holidayaudienceusers_user'
          AND conrelid = 'hr.holidayaudienceusers'::regclass
    ) THEN
        ALTER TABLE hr.HolidayAudienceUsers
            ADD CONSTRAINT FK_HolidayAudienceUsers_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS IX_HolidayAudienceDepartments_Department ON hr.HolidayAudienceDepartments(DepartmentId);
CREATE INDEX IF NOT EXISTS IX_HolidayAudienceUsers_User ON hr.HolidayAudienceUsers(UserId);

INSERT INTO notify.NotificationTypes (TypeCode, CategoryCode, DefaultPriority, IsMandatory, DefaultEnabled)
VALUES ('holiday_created', 'System', 'Normal', FALSE, TRUE)
ON CONFLICT (TypeCode) DO NOTHING;

COMMIT;
