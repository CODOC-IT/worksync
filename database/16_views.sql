-- Reporting and read-model queries.

CREATE VIEW work.vw_TaskDetails
AS
SELECT
    t.TaskId,
    t.ProjectId,
    p.ProjectCode,
    p.ProjectName,
    t.TaskNumber,
    t.Title,
    t.Description,
    ts.StatusCode,
    ts.StatusName,
    pr.PriorityCode,
    pr.PriorityName,
    t.StartDate,
    t.DueDate,
    (NOT ts.IsCompletedState
        AND t.DueDate < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date) AS IsOverdue,
    t.ActualStartedAtUtc,
    t.SubmittedAtUtc,
    t.CompletedAtUtc,
    t.CompletionSummary,
    t.CreatedByUserId,
    t.CreatedAtUtc,
    t.UpdatedAtUtc
FROM work.Tasks t
JOIN work.Projects p ON p.ProjectId = t.ProjectId
JOIN work.TaskStatuses ts ON ts.TaskStatusId = t.TaskStatusId
JOIN work.Priorities pr ON pr.PriorityId = t.PriorityId
WHERE t.ArchivedAtUtc IS NULL
  AND t.ProjectArchivedAtUtc IS NULL;

CREATE VIEW work.vw_CurrentTaskAssignees
AS
SELECT
    ta.TaskId,
    ta.UserId,
    u.DisplayName,
    u.Email,
    ta.AssignedAtUtc,
    ta.AssignedByUserId
FROM work.TaskAssignees ta
JOIN iam.Users u ON u.UserId = ta.UserId
WHERE ta.UnassignedAtUtc IS NULL;

CREATE VIEW iam.vw_ActiveTemporaryPermissions
AS
SELECT
    ur.UserRoleId,
    ur.UserId,
    r.RoleCode,
    r.RoleName,
    ur.StartsAtUtc,
    ur.EndsAtUtc,
    ur.GrantedByUserId
FROM iam.UserRoles ur
JOIN iam.Roles r ON r.RoleId = ur.RoleId
WHERE r.IsTemporary
  AND ur.RevokedAtUtc IS NULL
  AND ur.StartsAtUtc <= CURRENT_TIMESTAMP
  AND (ur.EndsAtUtc IS NULL OR ur.EndsAtUtc > CURRENT_TIMESTAMP);

CREATE VIEW reporting.vw_MemberWorkload
AS
SELECT
    u.UserId,
    u.DisplayName,
    u.Email,
    COUNT(ta.TaskId) AS ActiveAssignments,
    COUNT(CASE WHEN ts.IsCompletedState THEN 1 END) AS CompletedAssignments,
    COUNT(CASE WHEN NOT ts.IsCompletedState THEN 1 END) AS OpenAssignments,
    COUNT(
        CASE
            WHEN NOT ts.IsCompletedState
             AND t.DueDate < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date
            THEN 1
        END
    ) AS OverdueAssignments
FROM iam.Users u
LEFT JOIN work.TaskAssignees ta
       ON ta.UserId = u.UserId
      AND ta.UnassignedAtUtc IS NULL
LEFT JOIN work.Tasks t
       ON t.TaskId = ta.TaskId
      AND t.ArchivedAtUtc IS NULL
      AND t.ProjectArchivedAtUtc IS NULL
LEFT JOIN work.TaskStatuses ts ON ts.TaskStatusId = t.TaskStatusId
WHERE u.AccountStatus = 'Active'
GROUP BY u.UserId, u.DisplayName, u.Email;

CREATE VIEW calendar.vw_CalendarFeed
AS
SELECT
    concat('TASK-', t.TaskId, '-START') AS CalendarItemKey,
    'TaskStart'::text AS ItemType,
    t.Title,
    t.StartDate::timestamp AT TIME ZONE 'UTC' AS StartsAt,
    (t.StartDate + 1)::timestamp AT TIME ZONE 'UTC' AS EndsAt,
    t.ProjectId,
    t.TaskId
FROM work.Tasks t
WHERE t.ArchivedAtUtc IS NULL
  AND t.ProjectArchivedAtUtc IS NULL

UNION ALL

SELECT
    concat('TASK-', t.TaskId, '-DUE'),
    'TaskDue'::text,
    t.Title,
    t.DueDate::timestamp AT TIME ZONE 'UTC',
    (t.DueDate + 1)::timestamp AT TIME ZONE 'UTC',
    t.ProjectId,
    t.TaskId
FROM work.Tasks t
WHERE t.ArchivedAtUtc IS NULL
  AND t.ProjectArchivedAtUtc IS NULL

UNION ALL

SELECT
    concat('MILESTONE-', m.MilestoneId),
    'Milestone'::text,
    m.MilestoneName,
    m.DueDate::timestamp AT TIME ZONE 'UTC',
    (m.DueDate + 1)::timestamp AT TIME ZONE 'UTC',
    m.ProjectId,
    NULL::bigint
FROM work.ProjectMilestones m

UNION ALL

SELECT
    concat('EVENT-', e.EventId),
    'Event'::text,
    e.Title,
    e.StartsAtUtc,
    e.EndsAtUtc,
    e.ProjectId,
    NULL::bigint
FROM calendar.Events e
WHERE e.CancelledAtUtc IS NULL;
