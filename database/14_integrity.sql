-- Cross-row integrity that cannot be expressed with ordinary CHECK constraints.

CREATE FUNCTION iam.require_expiry_for_temporary_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    role_is_temporary boolean;
BEGIN
    SELECT IsTemporary
      INTO role_is_temporary
      FROM iam.Roles
     WHERE RoleId = NEW.RoleId;

    IF role_is_temporary AND NEW.EndsAtUtc IS NULL THEN
        RAISE EXCEPTION 'Temporary role assignments must have an expiry time.'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'CK_UserRoles_TemporaryExpiry';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_user_roles_require_temporary_expiry
BEFORE INSERT OR UPDATE OF RoleId, EndsAtUtc ON iam.UserRoles
FOR EACH ROW
EXECUTE FUNCTION iam.require_expiry_for_temporary_role();

CREATE FUNCTION iam.validate_temporary_scope_role()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    expected_role_code text := TG_ARGV[0];
    assigned_role_code text;
    role_is_temporary boolean;
BEGIN
    SELECT r.RoleCode, r.IsTemporary
      INTO assigned_role_code, role_is_temporary
      FROM iam.UserRoles ur
      JOIN iam.Roles r ON r.RoleId = ur.RoleId
     WHERE ur.UserRoleId = NEW.UserRoleId;

    IF assigned_role_code IS DISTINCT FROM expected_role_code
       OR role_is_temporary IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Scope requires a temporary % role assignment.', expected_role_code
            USING ERRCODE = '23514',
                  CONSTRAINT = 'CK_TemporaryScope_RoleType';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_team_lead_scope_role_type
BEFORE INSERT OR UPDATE OF UserRoleId ON iam.TeamLeadProjectScopes
FOR EACH ROW
EXECUTE FUNCTION iam.validate_temporary_scope_role('TeamLead');

CREATE TRIGGER tr_hr_scope_role_type
BEFORE INSERT OR UPDATE OF UserRoleId ON iam.HrDepartmentScopes
FOR EACH ROW
EXECUTE FUNCTION iam.validate_temporary_scope_role('HRRepresentative');

CREATE FUNCTION work.prevent_task_change_self_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS
    (
        SELECT 1
          FROM work.TaskChangeRequests request
         WHERE request.ChangeRequestId = NEW.ChangeRequestId
           AND request.RequestedByUserId = NEW.ReviewerUserId
    ) THEN
        RAISE EXCEPTION 'A task change requester cannot review their own request.'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'CK_ChangeRequestReviews_NoSelfReview';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_change_request_reviews_no_self_review
BEFORE INSERT OR UPDATE OF ChangeRequestId, ReviewerUserId ON work.ChangeRequestReviews
FOR EACH ROW
EXECUTE FUNCTION work.prevent_task_change_self_review();

CREATE FUNCTION hr.prevent_attendance_correction_self_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS
    (
        SELECT 1
          FROM hr.AttendanceCorrectionRequests request
         WHERE request.AttendanceCorrectionId = NEW.AttendanceCorrectionId
           AND request.RequestedByUserId = NEW.ReviewerUserId
    ) THEN
        RAISE EXCEPTION 'An attendance correction requester cannot review their own request.'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'CK_AttendanceCorrectionReviews_NoSelfReview';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_attendance_correction_reviews_no_self_review
BEFORE INSERT OR UPDATE OF AttendanceCorrectionId, ReviewerUserId
ON hr.AttendanceCorrectionReviews
FOR EACH ROW
EXECUTE FUNCTION hr.prevent_attendance_correction_self_review();

CREATE FUNCTION hr.prevent_leave_request_self_review()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS
    (
        SELECT 1
          FROM hr.LeaveRequests request
         WHERE request.LeaveRequestId = NEW.LeaveRequestId
           AND request.UserId = NEW.ReviewerUserId
    ) THEN
        RAISE EXCEPTION 'A leave requester cannot review their own request.'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'CK_LeaveRequestReviews_NoSelfReview';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER tr_leave_request_reviews_no_self_review
BEFORE INSERT OR UPDATE OF LeaveRequestId, ReviewerUserId ON hr.LeaveRequestReviews
FOR EACH ROW
EXECUTE FUNCTION hr.prevent_leave_request_self_review();

CREATE TRIGGER tr_organizations_row_version
BEFORE UPDATE ON org.Organizations
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_departments_row_version
BEFORE UPDATE ON org.Departments
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_teams_row_version
BEFORE UPDATE ON org.Teams
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_users_row_version
BEFORE UPDATE ON iam.Users
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_userprofiles_row_version
BEFORE UPDATE ON iam.UserProfiles
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_userroles_row_version
BEFORE UPDATE ON iam.UserRoles
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_projects_row_version
BEFORE UPDATE ON work.Projects
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_projectmilestones_row_version
BEFORE UPDATE ON work.ProjectMilestones
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_projectpolicies_row_version
BEFORE UPDATE ON work.ProjectPolicies
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_tasks_row_version
BEFORE UPDATE ON work.Tasks
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_taskchangerequests_row_version
BEFORE UPDATE ON work.TaskChangeRequests
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_comments_row_version
BEFORE UPDATE ON collab.Comments
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_attendancerecords_row_version
BEFORE UPDATE ON hr.AttendanceRecords
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_attendancecorrectionrequests_row_version
BEFORE UPDATE ON hr.AttendanceCorrectionRequests
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_leaverequests_row_version
BEFORE UPDATE ON hr.LeaveRequests
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_events_row_version
BEFORE UPDATE ON calendar.Events
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_organizationsettingvalues_row_version
BEFORE UPDATE ON config.OrganizationSettingValues
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();

CREATE TRIGGER tr_usersettingvalues_row_version
BEFORE UPDATE ON config.UserSettingValues
FOR EACH ROW
EXECUTE FUNCTION config.bump_row_version();
