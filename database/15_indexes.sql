-- Performance and filtered uniqueness indexes.

CREATE UNIQUE INDEX UX_Users_Organization_EmployeeNumber
ON iam.Users(OrganizationId, EmployeeNumber)
WHERE EmployeeNumber IS NOT NULL;

CREATE UNIQUE INDEX UX_UserRoles_Active
ON iam.UserRoles(UserId, RoleId)
WHERE RevokedAtUtc IS NULL AND EndsAtUtc IS NULL;

CREATE UNIQUE INDEX UX_ProjectMembers_Current
ON work.ProjectMembers(ProjectId, UserId)
WHERE LeftAtUtc IS NULL;

CREATE UNIQUE INDEX UX_ProjectReviewers_Open
ON work.ProjectReviewerDesignations(ProjectId, ReviewerUserId)
WHERE EndsAtUtc IS NULL;

CREATE UNIQUE INDEX UX_TaskAssignees_Current
ON work.TaskAssignees(TaskId, UserId)
WHERE UnassignedAtUtc IS NULL;

CREATE INDEX IX_Users_Department_Status ON iam.Users(DepartmentId, AccountStatus) INCLUDE (DisplayName, Email);

CREATE INDEX IX_UserRoles_Validity ON iam.UserRoles(UserId, RoleId, StartsAtUtc, EndsAtUtc, RevokedAtUtc);

CREATE INDEX IX_Projects_Status_Dates ON work.Projects(ProjectStatusId, StartDate, EndDate) INCLUDE (OwnerUserId, PriorityId);

CREATE INDEX IX_ProjectMembers_UserCurrent ON work.ProjectMembers(UserId, ProjectId) WHERE LeftAtUtc IS NULL;

CREATE INDEX IX_Tasks_Project_Status ON work.Tasks(ProjectId, TaskStatusId, SortPosition) INCLUDE (PriorityId, StartDate, DueDate);

CREATE INDEX IX_Tasks_DueDate_Status ON work.Tasks(DueDate, TaskStatusId) INCLUDE (ProjectId, PriorityId);

CREATE INDEX IX_TaskAssignees_UserCurrent ON work.TaskAssignees(UserId, TaskId) WHERE UnassignedAtUtc IS NULL;

CREATE INDEX IX_TaskStatusHistory_TaskDate ON work.TaskStatusHistory(TaskId, ChangedAtUtc DESC);

CREATE INDEX IX_ChangeRequests_ReviewerStatus ON work.TaskChangeRequests(AssignedReviewerUserId, RequestStatus, SubmittedAtUtc);

CREATE UNIQUE INDEX UX_ChangeRequests_PendingField
    ON work.TaskChangeRequestItems(ChangeRequestId, FieldCode);

CREATE INDEX IX_Comments_ThreadDate ON collab.Comments(ThreadId, CreatedAtUtc) INCLUDE (AuthorUserId, CommentKind);

CREATE INDEX IX_Attendance_UserDate ON hr.AttendanceRecords(UserId, WorkDate DESC);

CREATE INDEX IX_AttendanceCorrections_ReviewerStatus ON hr.AttendanceCorrectionRequests(AssignedReviewerUserId, RequestStatus, SubmittedAtUtc);

CREATE INDEX IX_LeaveRequests_ReviewerStatus ON hr.LeaveRequests(AssignedReviewerUserId, RequestStatus, SubmittedAtUtc);

CREATE INDEX IX_LeaveRequests_UserDates ON hr.LeaveRequests(UserId, StartDate, EndDate);

CREATE INDEX IX_Events_DateRange ON calendar.Events(StartsAtUtc, EndsAtUtc) INCLUDE (EventTypeId, ProjectId, Title);

CREATE INDEX IX_ReportRuns_RequesterDate ON reporting.ReportRuns(RequestedByUserId, RequestedAtUtc DESC);

CREATE INDEX IX_PromptGenerations_UserDate ON ai.PromptGenerations(UserId, CreatedAtUtc DESC);

CREATE INDEX IX_UserNotifications_Inbox ON notify.UserNotifications(RecipientUserId, ReadAtUtc, ClearedAtUtc) INCLUDE (NotificationId, DeliveryStatus);

CREATE INDEX IX_Notifications_Date ON notify.Notifications(CreatedAtUtc DESC) INCLUDE (NotificationTypeId, PriorityCode);

CREATE INDEX IX_AuditEvents_Date ON audit.AuditEvents(OccurredAtUtc DESC, AuditEventId DESC) INCLUDE (ActorUserId, ActionCode, EntityTypeCode);

CREATE INDEX IX_AuditEvents_Project ON audit.AuditEvents(ProjectId, OccurredAtUtc DESC) WHERE ProjectId IS NOT NULL;

CREATE INDEX IX_AuditEvents_Task ON audit.AuditEvents(TaskId, OccurredAtUtc DESC) WHERE TaskId IS NOT NULL;
