-- Holiday audience targeting: HR picks exactly one audience per holiday when creating/editing it
-- via Manage Holidays -- Everyone (default, matches every prior holiday's implicit behavior),
-- one or more Departments, or one or more specific Users. AudienceType is a discriminator column
-- (mutual exclusivity between Department/Users selections is a cross-table invariant, enforced in
-- calendar.service.ts, not something a single-table CHECK constraint can express).
--
-- Two join tables rather than reusing hr.Holidays.DepartmentId (see database/06_hr_tables.sql):
-- that column is a single nullable FK and can only ever represent one department, but "one or
-- more departments" is inherently many-to-many. It's left untouched and unused by this feature.
ALTER TABLE hr.Holidays
    ADD COLUMN AudienceType varchar(20) NOT NULL DEFAULT 'Everyone'
        CONSTRAINT CK_Holidays_AudienceType CHECK (AudienceType IN ('Everyone', 'Department', 'Users'));

CREATE TABLE hr.HolidayAudienceDepartments
(
    HolidayId     int NOT NULL,
    DepartmentId  int NOT NULL,
    CONSTRAINT PK_HolidayAudienceDepartments PRIMARY KEY (HolidayId, DepartmentId)
);

ALTER TABLE hr.HolidayAudienceDepartments
    ADD CONSTRAINT FK_HolidayAudienceDepartments_Holiday FOREIGN KEY (HolidayId)
        REFERENCES hr.Holidays(HolidayId) ON DELETE CASCADE;

-- No ON DELETE clause (defaults to RESTRICT) -- matches accounts.service.ts's deleteDepartment,
-- which already refuses to delete a department while active members are assigned to it; a
-- department still targeted by a holiday's audience should block deletion the same way, rather
-- than silently vanishing from that holiday's audience.
ALTER TABLE hr.HolidayAudienceDepartments
    ADD CONSTRAINT FK_HolidayAudienceDepartments_Department FOREIGN KEY (DepartmentId)
        REFERENCES org.Departments(DepartmentId);

CREATE TABLE hr.HolidayAudienceUsers
(
    HolidayId  int NOT NULL,
    UserId     int NOT NULL,
    CONSTRAINT PK_HolidayAudienceUsers PRIMARY KEY (HolidayId, UserId)
);

ALTER TABLE hr.HolidayAudienceUsers
    ADD CONSTRAINT FK_HolidayAudienceUsers_Holiday FOREIGN KEY (HolidayId)
        REFERENCES hr.Holidays(HolidayId) ON DELETE CASCADE;

ALTER TABLE hr.HolidayAudienceUsers
    ADD CONSTRAINT FK_HolidayAudienceUsers_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId);

CREATE INDEX IX_HolidayAudienceDepartments_Department ON hr.HolidayAudienceDepartments(DepartmentId);
CREATE INDEX IX_HolidayAudienceUsers_User ON hr.HolidayAudienceUsers(UserId);
