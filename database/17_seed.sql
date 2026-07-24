-- Stable lookup rows required by the application.
-- This baseline is intentionally not rerunnable.

INSERT INTO work.ProjectStatuses (StatusCode, StatusName, SortOrder, IsActiveState, IsTerminalState)
VALUES
    ('Draft', 'Draft', 10, FALSE, FALSE),
    ('PendingActivation', 'Pending Activation', 20, FALSE, FALSE),
    ('Active', 'Active', 30, TRUE, FALSE),
    ('OnHold', 'On Hold', 40, TRUE, FALSE),
    ('Completed', 'Completed', 50, FALSE, TRUE),
    ('Archived', 'Archived', 60, FALSE, TRUE);

INSERT INTO work.TaskStatuses (StatusCode, StatusName, SortOrder, IsCompletedState, RequiresBlocker, RequiresReview)
VALUES
    ('Todo', 'To Do', 10, FALSE, FALSE, FALSE),
    ('InProgress', 'In Progress', 20, FALSE, FALSE, FALSE),
    ('Review', 'Review', 30, FALSE, FALSE, TRUE),
    ('Blocked', 'Blocked', 40, FALSE, TRUE, FALSE),
    ('Done', 'Done', 50, TRUE, FALSE, TRUE);

INSERT INTO work.Priorities (PriorityCode, PriorityName, SortOrder)
VALUES
    ('Low', 'Low', 10),
    ('Medium', 'Medium', 20),
    ('High', 'High', 30),
    ('Critical', 'Critical', 40);

INSERT INTO hr.AttendanceStatuses (StatusCode, StatusName, CountsAsPresent)
VALUES
    ('Present', 'Present', TRUE),
    ('Late', 'Late', TRUE),
    ('Absent', 'Absent', FALSE),
    ('Leave', 'On Leave', FALSE),
    ('Holiday', 'Holiday', FALSE),
    ('Remote', 'Remote', TRUE);

INSERT INTO iam.Roles (RoleCode, RoleName, IsSystemRole, IsTemporary, Description)
VALUES
    ('Administrator', 'Administrator', TRUE, FALSE, 'Organization-wide administration'),
    ('TeamMember', 'Team Member', TRUE, FALSE, 'Standard authenticated user'),
    ('TeamLead', 'Temporary Team Lead', TRUE, TRUE, 'Project-scoped temporary responsibility'),
    ('HRRepresentative', 'Temporary HR Representative', TRUE, TRUE, 'Attendance-scoped temporary responsibility');

INSERT INTO work.ChangeRequestTypes (TypeCode, TypeName)
VALUES
    ('Dates', 'Start or due date'),
    ('Priority', 'Priority'),
    ('Description', 'Description'),
    ('AcceptanceCriteria', 'Acceptance criteria'),
    ('Assignees', 'Assignees'),
    ('Dependencies', 'Dependencies'),
    ('Reopen', 'Reopen completed task'),
    ('Complete', 'Final completion approval'),
    ('EvidenceRemoval', 'Remove submitted evidence');

INSERT INTO calendar.EventTypes (EventTypeCode, EventTypeName, IconName)
VALUES
    ('Meeting', 'Meeting', 'users'),
    ('OfficeEvent', 'Office event', 'calendar'),
    ('Reminder', 'Reminder', 'bell');

INSERT INTO ai.PromptOutputTypes (OutputTypeCode, OutputTypeName, RequiresProject, RequiresTask)
VALUES
    ('ProjectBreakdown', 'Project breakdown', TRUE, FALSE),
    ('TaskDescription', 'Task description', TRUE, TRUE),
    ('SimplifiedExplanation', 'Simplified explanation', FALSE, FALSE),
    ('Summary', 'Summary', FALSE, FALSE),
    ('AcceptanceCriteria', 'Acceptance criteria', TRUE, TRUE),
    ('TestCases', 'Test cases', TRUE, TRUE),
    ('CodeReview', 'Code review prompt', TRUE, TRUE),
    ('Documentation', 'Documentation prompt', TRUE, FALSE);
