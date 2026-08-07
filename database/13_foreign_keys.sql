-- Cross-schema and self-referencing relationships.
-- Kept separate so table creation has no circular ordering problem.

ALTER TABLE org.Departments
    ADD CONSTRAINT FK_Departments_Organization FOREIGN KEY (OrganizationId) REFERENCES org.Organizations(OrganizationId);

ALTER TABLE org.Departments
    ADD CONSTRAINT FK_Departments_Parent FOREIGN KEY (ParentDepartmentId) REFERENCES org.Departments(DepartmentId);

ALTER TABLE org.Teams
    ADD CONSTRAINT FK_Teams_Department FOREIGN KEY (DepartmentId) REFERENCES org.Departments(DepartmentId);

ALTER TABLE iam.Users
    ADD CONSTRAINT FK_Users_Organization FOREIGN KEY (OrganizationId) REFERENCES org.Organizations(OrganizationId);

ALTER TABLE iam.Users
    ADD CONSTRAINT FK_Users_DepartmentOrganization FOREIGN KEY (DepartmentId, OrganizationId)
        REFERENCES org.Departments(DepartmentId, OrganizationId);

ALTER TABLE iam.Users
    ADD CONSTRAINT FK_Users_Manager FOREIGN KEY (ManagerUserId) REFERENCES iam.Users(UserId);

ALTER TABLE iam.UserProfiles
    ADD CONSTRAINT FK_UserProfiles_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId) ON DELETE CASCADE;

ALTER TABLE iam.UserCredentials
    ADD CONSTRAINT FK_UserCredentials_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId) ON DELETE CASCADE;

ALTER TABLE iam.RolePermissions
    ADD CONSTRAINT FK_RolePermissions_Role FOREIGN KEY (RoleId) REFERENCES iam.Roles(RoleId) ON DELETE CASCADE;

ALTER TABLE iam.RolePermissions
    ADD CONSTRAINT FK_RolePermissions_Permission FOREIGN KEY (PermissionId) REFERENCES iam.Permissions(PermissionId) ON DELETE CASCADE;

ALTER TABLE iam.UserRoles
    ADD CONSTRAINT FK_UserRoles_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId);

ALTER TABLE iam.UserRoles
    ADD CONSTRAINT FK_UserRoles_Role FOREIGN KEY (RoleId) REFERENCES iam.Roles(RoleId);

ALTER TABLE iam.UserRoles
    ADD CONSTRAINT FK_UserRoles_GrantedBy FOREIGN KEY (GrantedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE iam.UserRoles
    ADD CONSTRAINT FK_UserRoles_RevokedBy FOREIGN KEY (RevokedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE iam.PermissionAssignmentHistory
    ADD CONSTRAINT FK_PermissionHistory_Assignment FOREIGN KEY (UserRoleId) REFERENCES iam.UserRoles(UserRoleId);

ALTER TABLE iam.PermissionAssignmentHistory
    ADD CONSTRAINT FK_PermissionHistory_Actor FOREIGN KEY (ActorUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.Projects
    ADD CONSTRAINT FK_Projects_Organization FOREIGN KEY (OrganizationId) REFERENCES org.Organizations(OrganizationId);

ALTER TABLE work.Projects
    ADD CONSTRAINT FK_Projects_DepartmentOrganization FOREIGN KEY (DepartmentId, OrganizationId)
        REFERENCES org.Departments(DepartmentId, OrganizationId);

ALTER TABLE work.Projects
    ADD CONSTRAINT FK_Projects_OwnerOrganization FOREIGN KEY (OwnerUserId, OrganizationId)
        REFERENCES iam.Users(UserId, OrganizationId);

ALTER TABLE work.Projects
    ADD CONSTRAINT FK_Projects_Status FOREIGN KEY (ProjectStatusId) REFERENCES work.ProjectStatuses(ProjectStatusId);

ALTER TABLE work.Projects
    ADD CONSTRAINT FK_Projects_Priority FOREIGN KEY (PriorityId) REFERENCES work.Priorities(PriorityId);

ALTER TABLE work.Projects
    ADD CONSTRAINT FK_Projects_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.Projects
    ADD CONSTRAINT FK_Projects_ArchivedBy FOREIGN KEY (ArchivedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.ProjectMembers
    ADD CONSTRAINT FK_ProjectMembers_Project FOREIGN KEY (ProjectId) REFERENCES work.Projects(ProjectId);

ALTER TABLE work.ProjectMembers
    ADD CONSTRAINT FK_ProjectMembers_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.ProjectMembers
    ADD CONSTRAINT FK_ProjectMembers_AddedBy FOREIGN KEY (AddedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.ProjectMembers
    ADD CONSTRAINT FK_ProjectMembers_RemovedBy FOREIGN KEY (RemovedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.ProjectMembers
    ADD CONSTRAINT FK_ProjectMembers_PendingRemovalBy FOREIGN KEY (PendingRemovalByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE iam.TeamLeadProjectScopes
    ADD CONSTRAINT FK_TeamLeadScopes_UserRole FOREIGN KEY (UserRoleId) REFERENCES iam.UserRoles(UserRoleId) ON DELETE CASCADE;

ALTER TABLE iam.TeamLeadProjectScopes
    ADD CONSTRAINT FK_TeamLeadScopes_Project FOREIGN KEY (ProjectId) REFERENCES work.Projects(ProjectId);

ALTER TABLE work.ProjectReviewerDesignations
    ADD CONSTRAINT FK_ProjectReviewers_Project FOREIGN KEY (ProjectId) REFERENCES work.Projects(ProjectId);

ALTER TABLE work.ProjectReviewerDesignations
    ADD CONSTRAINT FK_ProjectReviewers_Reviewer FOREIGN KEY (ReviewerUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.ProjectReviewerDesignations
    ADD CONSTRAINT FK_ProjectReviewers_DesignatedBy FOREIGN KEY (DesignatedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.ProjectMilestones
    ADD CONSTRAINT FK_Milestones_Project FOREIGN KEY (ProjectId) REFERENCES work.Projects(ProjectId);

ALTER TABLE work.ProjectMilestones
    ADD CONSTRAINT FK_Milestones_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.ProjectPolicies
    ADD CONSTRAINT FK_ProjectPolicies_Project FOREIGN KEY (ProjectId) REFERENCES work.Projects(ProjectId) ON DELETE CASCADE;

ALTER TABLE work.ProjectPolicies
    ADD CONSTRAINT FK_ProjectPolicies_UpdatedBy FOREIGN KEY (UpdatedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.Tasks
    ADD CONSTRAINT FK_Tasks_Project FOREIGN KEY (ProjectId) REFERENCES work.Projects(ProjectId);

ALTER TABLE work.Tasks
    ADD CONSTRAINT FK_Tasks_Parent FOREIGN KEY (ParentTaskId) REFERENCES work.Tasks(TaskId);

ALTER TABLE work.Tasks
    ADD CONSTRAINT FK_Tasks_Status FOREIGN KEY (TaskStatusId) REFERENCES work.TaskStatuses(TaskStatusId);

ALTER TABLE work.Tasks
    ADD CONSTRAINT FK_Tasks_Priority FOREIGN KEY (PriorityId) REFERENCES work.Priorities(PriorityId);

ALTER TABLE work.Tasks
    ADD CONSTRAINT FK_Tasks_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.Tasks
    ADD CONSTRAINT FK_Tasks_DefaultReviewer FOREIGN KEY (DefaultReviewerUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.TaskAssignees
    ADD CONSTRAINT FK_TaskAssignees_Task FOREIGN KEY (TaskId) REFERENCES work.Tasks(TaskId);

ALTER TABLE work.TaskAssignees
    ADD CONSTRAINT FK_TaskAssignees_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.TaskAssignees
    ADD CONSTRAINT FK_TaskAssignees_AssignedBy FOREIGN KEY (AssignedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.TaskAssignees
    ADD CONSTRAINT FK_TaskAssignees_UnassignedBy FOREIGN KEY (UnassignedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.TaskAcceptanceCriteria
    ADD CONSTRAINT FK_AcceptanceCriteria_Task FOREIGN KEY (TaskId) REFERENCES work.Tasks(TaskId) ON DELETE CASCADE;

ALTER TABLE work.TaskAcceptanceCriteria
    ADD CONSTRAINT FK_AcceptanceCriteria_SatisfiedBy FOREIGN KEY (SatisfiedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.TaskDependencies
    ADD CONSTRAINT FK_TaskDependencies_Task FOREIGN KEY (TaskId) REFERENCES work.Tasks(TaskId);

ALTER TABLE work.TaskDependencies
    ADD CONSTRAINT FK_TaskDependencies_DependsOn FOREIGN KEY (DependsOnTaskId) REFERENCES work.Tasks(TaskId);

ALTER TABLE work.TaskDependencies
    ADD CONSTRAINT FK_TaskDependencies_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.TaskStatusHistory
    ADD CONSTRAINT FK_TaskStatusHistory_Task FOREIGN KEY (TaskId) REFERENCES work.Tasks(TaskId);

ALTER TABLE work.TaskStatusHistory
    ADD CONSTRAINT FK_TaskStatusHistory_From FOREIGN KEY (FromTaskStatusId) REFERENCES work.TaskStatuses(TaskStatusId);

ALTER TABLE work.TaskStatusHistory
    ADD CONSTRAINT FK_TaskStatusHistory_To FOREIGN KEY (ToTaskStatusId) REFERENCES work.TaskStatuses(TaskStatusId);

ALTER TABLE work.TaskStatusHistory
    ADD CONSTRAINT FK_TaskStatusHistory_User FOREIGN KEY (ChangedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.TaskBlockers
    ADD CONSTRAINT FK_TaskBlockers_Task FOREIGN KEY (TaskId) REFERENCES work.Tasks(TaskId);

ALTER TABLE work.TaskBlockers
    ADD CONSTRAINT FK_TaskBlockers_ReportedBy FOREIGN KEY (ReportedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.TaskBlockers
    ADD CONSTRAINT FK_TaskBlockers_ResolvedBy FOREIGN KEY (ResolvedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.TaskChangeRequests
    ADD CONSTRAINT FK_ChangeRequests_Task FOREIGN KEY (TaskId) REFERENCES work.Tasks(TaskId);

ALTER TABLE work.TaskChangeRequests
    ADD CONSTRAINT FK_ChangeRequests_Type FOREIGN KEY (ChangeRequestTypeId) REFERENCES work.ChangeRequestTypes(ChangeRequestTypeId);

ALTER TABLE work.TaskChangeRequests
    ADD CONSTRAINT FK_ChangeRequests_Requester FOREIGN KEY (RequestedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.TaskChangeRequests
    ADD CONSTRAINT FK_ChangeRequests_Reviewer FOREIGN KEY (AssignedReviewerUserId) REFERENCES iam.Users(UserId);

ALTER TABLE work.TaskChangeRequestItems
    ADD CONSTRAINT FK_ChangeRequestItems_Request FOREIGN KEY (ChangeRequestId)
        REFERENCES work.TaskChangeRequests(ChangeRequestId) ON DELETE CASCADE;

ALTER TABLE work.ChangeRequestReviews
    ADD CONSTRAINT FK_ChangeRequestReviews_Request FOREIGN KEY (ChangeRequestId) REFERENCES work.TaskChangeRequests(ChangeRequestId);

ALTER TABLE work.ChangeRequestReviews
    ADD CONSTRAINT FK_ChangeRequestReviews_Reviewer FOREIGN KEY (ReviewerUserId) REFERENCES iam.Users(UserId);

ALTER TABLE collab.StoredFiles
    ADD CONSTRAINT FK_StoredFiles_Organization FOREIGN KEY (OrganizationId) REFERENCES org.Organizations(OrganizationId);

ALTER TABLE collab.StoredFiles
    ADD CONSTRAINT FK_StoredFiles_Uploader FOREIGN KEY (UploadedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE collab.DiscussionThreads
    ADD CONSTRAINT FK_DiscussionThreads_Organization FOREIGN KEY (OrganizationId) REFERENCES org.Organizations(OrganizationId);

ALTER TABLE collab.DiscussionThreads
    ADD CONSTRAINT FK_DiscussionThreads_Project FOREIGN KEY (ProjectId) REFERENCES work.Projects(ProjectId);

ALTER TABLE collab.DiscussionThreads
    ADD CONSTRAINT FK_DiscussionThreads_Task FOREIGN KEY (TaskId) REFERENCES work.Tasks(TaskId);

ALTER TABLE collab.DiscussionThreads
    ADD CONSTRAINT FK_DiscussionThreads_ChangeRequest FOREIGN KEY (ChangeRequestId) REFERENCES work.TaskChangeRequests(ChangeRequestId);

ALTER TABLE collab.DiscussionThreads
    ADD CONSTRAINT FK_DiscussionThreads_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE collab.DiscussionThreads
    ADD CONSTRAINT FK_DiscussionThreads_ResolvedBy FOREIGN KEY (ResolvedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE collab.Comments
    ADD CONSTRAINT FK_Comments_Thread FOREIGN KEY (ThreadId) REFERENCES collab.DiscussionThreads(ThreadId);

ALTER TABLE collab.Comments
    ADD CONSTRAINT FK_Comments_Parent FOREIGN KEY (ParentCommentId) REFERENCES collab.Comments(CommentId);

ALTER TABLE collab.Comments
    ADD CONSTRAINT FK_Comments_Author FOREIGN KEY (AuthorUserId) REFERENCES iam.Users(UserId);

ALTER TABLE collab.CommentMentions
    ADD CONSTRAINT FK_CommentMentions_Comment FOREIGN KEY (CommentId) REFERENCES collab.Comments(CommentId) ON DELETE CASCADE;

ALTER TABLE collab.CommentMentions
    ADD CONSTRAINT FK_CommentMentions_User FOREIGN KEY (MentionedUserId) REFERENCES iam.Users(UserId);

ALTER TABLE collab.ProjectFiles
    ADD CONSTRAINT FK_ProjectFiles_Project FOREIGN KEY (ProjectId) REFERENCES work.Projects(ProjectId);

ALTER TABLE collab.ProjectFiles
    ADD CONSTRAINT FK_ProjectFiles_File FOREIGN KEY (FileId) REFERENCES collab.StoredFiles(FileId);

ALTER TABLE collab.ProjectFiles
    ADD CONSTRAINT FK_ProjectFiles_AddedBy FOREIGN KEY (AddedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE collab.TaskFiles
    ADD CONSTRAINT FK_TaskFiles_Task FOREIGN KEY (TaskId) REFERENCES work.Tasks(TaskId);

ALTER TABLE collab.TaskFiles
    ADD CONSTRAINT FK_TaskFiles_File FOREIGN KEY (FileId) REFERENCES collab.StoredFiles(FileId);

ALTER TABLE collab.TaskFiles
    ADD CONSTRAINT FK_TaskFiles_AddedBy FOREIGN KEY (AddedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE collab.CommentFiles
    ADD CONSTRAINT FK_CommentFiles_Comment FOREIGN KEY (CommentId) REFERENCES collab.Comments(CommentId) ON DELETE CASCADE;

ALTER TABLE collab.CommentFiles
    ADD CONSTRAINT FK_CommentFiles_File FOREIGN KEY (FileId) REFERENCES collab.StoredFiles(FileId);

ALTER TABLE hr.WorkSchedules
    ADD CONSTRAINT FK_WorkSchedules_Organization FOREIGN KEY (OrganizationId) REFERENCES org.Organizations(OrganizationId);

ALTER TABLE hr.WorkSchedules
    ADD CONSTRAINT FK_WorkSchedules_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE hr.WorkScheduleDays
    ADD CONSTRAINT FK_WorkScheduleDays_Schedule FOREIGN KEY (WorkScheduleId) REFERENCES hr.WorkSchedules(WorkScheduleId) ON DELETE CASCADE;

ALTER TABLE hr.UserWorkScheduleAssignments
    ADD CONSTRAINT FK_UserWorkSchedules_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId);

ALTER TABLE hr.UserWorkScheduleAssignments
    ADD CONSTRAINT FK_UserWorkSchedules_Schedule FOREIGN KEY (WorkScheduleId) REFERENCES hr.WorkSchedules(WorkScheduleId);

ALTER TABLE hr.UserWorkScheduleAssignments
    ADD CONSTRAINT FK_UserWorkSchedules_AssignedBy FOREIGN KEY (AssignedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE hr.Holidays
    ADD CONSTRAINT FK_Holidays_Organization FOREIGN KEY (OrganizationId) REFERENCES org.Organizations(OrganizationId);

ALTER TABLE hr.Holidays
    ADD CONSTRAINT FK_Holidays_DepartmentOrganization FOREIGN KEY (DepartmentId, OrganizationId)
        REFERENCES org.Departments(DepartmentId, OrganizationId);

ALTER TABLE hr.Holidays
    ADD CONSTRAINT FK_Holidays_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE hr.AttendanceRecords
    ADD CONSTRAINT FK_AttendanceRecords_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId);

ALTER TABLE hr.AttendanceRecords
    ADD CONSTRAINT FK_AttendanceRecords_Schedule FOREIGN KEY (WorkScheduleId) REFERENCES hr.WorkSchedules(WorkScheduleId);

ALTER TABLE hr.AttendanceRecords
    ADD CONSTRAINT FK_AttendanceRecords_Status FOREIGN KEY (AttendanceStatusId) REFERENCES hr.AttendanceStatuses(AttendanceStatusId);

ALTER TABLE hr.AttendancePunches
    ADD CONSTRAINT FK_AttendancePunches_Record FOREIGN KEY (AttendanceRecordId) REFERENCES hr.AttendanceRecords(AttendanceRecordId);

ALTER TABLE hr.AttendancePunches
    ADD CONSTRAINT FK_AttendancePunches_Recorder FOREIGN KEY (RecordedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE iam.HrDepartmentScopes
    ADD CONSTRAINT FK_HrScopes_UserRole FOREIGN KEY (UserRoleId) REFERENCES iam.UserRoles(UserRoleId) ON DELETE CASCADE;

ALTER TABLE iam.HrDepartmentScopes
    ADD CONSTRAINT FK_HrScopes_Department FOREIGN KEY (DepartmentId) REFERENCES org.Departments(DepartmentId);

ALTER TABLE hr.AttendanceCorrectionRequests
    ADD CONSTRAINT FK_AttendanceCorrections_Record FOREIGN KEY (AttendanceRecordId) REFERENCES hr.AttendanceRecords(AttendanceRecordId);

ALTER TABLE hr.AttendanceCorrectionRequests
    ADD CONSTRAINT FK_AttendanceCorrections_Requester FOREIGN KEY (RequestedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE hr.AttendanceCorrectionRequests
    ADD CONSTRAINT FK_AttendanceCorrections_Reviewer FOREIGN KEY (AssignedReviewerUserId) REFERENCES iam.Users(UserId);

ALTER TABLE hr.AttendanceCorrectionItems
    ADD CONSTRAINT FK_AttendanceCorrectionItems_Request FOREIGN KEY (AttendanceCorrectionId)
        REFERENCES hr.AttendanceCorrectionRequests(AttendanceCorrectionId) ON DELETE CASCADE;

ALTER TABLE hr.AttendanceCorrectionReviews
    ADD CONSTRAINT FK_AttendanceCorrectionReviews_Request FOREIGN KEY (AttendanceCorrectionId)
        REFERENCES hr.AttendanceCorrectionRequests(AttendanceCorrectionId);

ALTER TABLE hr.AttendanceCorrectionReviews
    ADD CONSTRAINT FK_AttendanceCorrectionReviews_Reviewer FOREIGN KEY (ReviewerUserId) REFERENCES iam.Users(UserId);

ALTER TABLE hr.LeaveTypes
    ADD CONSTRAINT FK_LeaveTypes_Organization FOREIGN KEY (OrganizationId) REFERENCES org.Organizations(OrganizationId);

ALTER TABLE hr.LeaveRequests
    ADD CONSTRAINT FK_LeaveRequests_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId);

ALTER TABLE hr.LeaveRequests
    ADD CONSTRAINT FK_LeaveRequests_Type FOREIGN KEY (LeaveTypeId) REFERENCES hr.LeaveTypes(LeaveTypeId);

ALTER TABLE hr.LeaveRequests
    ADD CONSTRAINT FK_LeaveRequests_Reviewer FOREIGN KEY (AssignedReviewerUserId) REFERENCES iam.Users(UserId);

ALTER TABLE hr.LeaveRequestReviews
    ADD CONSTRAINT FK_LeaveReviews_Request FOREIGN KEY (LeaveRequestId) REFERENCES hr.LeaveRequests(LeaveRequestId);

ALTER TABLE hr.LeaveRequestReviews
    ADD CONSTRAINT FK_LeaveReviews_Reviewer FOREIGN KEY (ReviewerUserId) REFERENCES iam.Users(UserId);

ALTER TABLE collab.LeaveRequestFiles
    ADD CONSTRAINT FK_LeaveRequestFiles_Request FOREIGN KEY (LeaveRequestId) REFERENCES hr.LeaveRequests(LeaveRequestId);

ALTER TABLE collab.LeaveRequestFiles
    ADD CONSTRAINT FK_LeaveRequestFiles_File FOREIGN KEY (FileId) REFERENCES collab.StoredFiles(FileId);

ALTER TABLE calendar.Events
    ADD CONSTRAINT FK_Events_Organization FOREIGN KEY (OrganizationId) REFERENCES org.Organizations(OrganizationId);

ALTER TABLE calendar.Events
    ADD CONSTRAINT FK_Events_Type FOREIGN KEY (EventTypeId) REFERENCES calendar.EventTypes(EventTypeId);

ALTER TABLE calendar.Events
    ADD CONSTRAINT FK_Events_Project FOREIGN KEY (ProjectId) REFERENCES work.Projects(ProjectId);

ALTER TABLE calendar.Events
    ADD CONSTRAINT FK_Events_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE calendar.EventAttendees
    ADD CONSTRAINT FK_EventAttendees_Event FOREIGN KEY (EventId) REFERENCES calendar.Events(EventId) ON DELETE CASCADE;

ALTER TABLE calendar.EventAttendees
    ADD CONSTRAINT FK_EventAttendees_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId);

ALTER TABLE reporting.SavedReports
    ADD CONSTRAINT FK_SavedReports_Definition FOREIGN KEY (ReportDefinitionId) REFERENCES reporting.ReportDefinitions(ReportDefinitionId);

ALTER TABLE reporting.SavedReports
    ADD CONSTRAINT FK_SavedReports_Owner FOREIGN KEY (OwnerUserId) REFERENCES iam.Users(UserId);

ALTER TABLE reporting.ReportRuns
    ADD CONSTRAINT FK_ReportRuns_Definition FOREIGN KEY (ReportDefinitionId) REFERENCES reporting.ReportDefinitions(ReportDefinitionId);

ALTER TABLE reporting.ReportRuns
    ADD CONSTRAINT FK_ReportRuns_SavedReport FOREIGN KEY (SavedReportId) REFERENCES reporting.SavedReports(SavedReportId);

ALTER TABLE reporting.ReportRuns
    ADD CONSTRAINT FK_ReportRuns_Requester FOREIGN KEY (RequestedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE reporting.ReportExports
    ADD CONSTRAINT FK_ReportExports_Run FOREIGN KEY (ReportRunId) REFERENCES reporting.ReportRuns(ReportRunId);

ALTER TABLE reporting.ReportExports
    ADD CONSTRAINT FK_ReportExports_File FOREIGN KEY (FileId) REFERENCES collab.StoredFiles(FileId);

ALTER TABLE ai.PromptGenerations
    ADD CONSTRAINT FK_PromptGenerations_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId);

ALTER TABLE ai.PromptGenerations
    ADD CONSTRAINT FK_PromptGenerations_Project FOREIGN KEY (ProjectId) REFERENCES work.Projects(ProjectId);

ALTER TABLE ai.PromptGenerations
    ADD CONSTRAINT FK_PromptGenerations_Task FOREIGN KEY (TaskId) REFERENCES work.Tasks(TaskId);

ALTER TABLE ai.PromptGenerations
    ADD CONSTRAINT FK_PromptGenerations_Type FOREIGN KEY (PromptOutputTypeId) REFERENCES ai.PromptOutputTypes(PromptOutputTypeId);

ALTER TABLE ai.PromptGenerations
    ADD CONSTRAINT FK_PromptGenerations_Parent FOREIGN KEY (ParentGenerationId) REFERENCES ai.PromptGenerations(PromptGenerationId);

ALTER TABLE ai.PromptLibraries
    ADD CONSTRAINT FK_PromptLibraries_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId);

ALTER TABLE ai.PromptLibraries
    ADD CONSTRAINT FK_PromptLibraries_Project FOREIGN KEY (ProjectId) REFERENCES work.Projects(ProjectId);

ALTER TABLE ai.PromptLibraries
    ADD CONSTRAINT FK_PromptLibraries_Task FOREIGN KEY (TaskId) REFERENCES work.Tasks(TaskId);

ALTER TABLE ai.PromptVersions
    ADD CONSTRAINT FK_PromptVersions_Library FOREIGN KEY (PromptLibraryId) REFERENCES ai.PromptLibraries(PromptLibraryId) ON DELETE CASCADE;

ALTER TABLE ai.PromptVersions
    ADD CONSTRAINT FK_PromptVersions_CreatedBy FOREIGN KEY (CreatedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE notify.UserNotificationPreferences
    ADD CONSTRAINT FK_NotificationPreferences_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId) ON DELETE CASCADE;

ALTER TABLE notify.UserNotificationPreferences
    ADD CONSTRAINT FK_NotificationPreferences_Type FOREIGN KEY (NotificationTypeId) REFERENCES notify.NotificationTypes(NotificationTypeId);

ALTER TABLE notify.Notifications
    ADD CONSTRAINT FK_Notifications_Type FOREIGN KEY (NotificationTypeId) REFERENCES notify.NotificationTypes(NotificationTypeId);

ALTER TABLE notify.Notifications
    ADD CONSTRAINT FK_Notifications_Actor FOREIGN KEY (ActorUserId) REFERENCES iam.Users(UserId);

ALTER TABLE notify.Notifications
    ADD CONSTRAINT FK_Notifications_Project FOREIGN KEY (ProjectId) REFERENCES work.Projects(ProjectId);

ALTER TABLE notify.Notifications
    ADD CONSTRAINT FK_Notifications_Task FOREIGN KEY (TaskId) REFERENCES work.Tasks(TaskId);

ALTER TABLE notify.Notifications
    ADD CONSTRAINT FK_Notifications_ChangeRequest FOREIGN KEY (ChangeRequestId) REFERENCES work.TaskChangeRequests(ChangeRequestId);

ALTER TABLE notify.Notifications
    ADD CONSTRAINT FK_Notifications_AttendanceCorrection FOREIGN KEY (AttendanceCorrectionId) REFERENCES hr.AttendanceCorrectionRequests(AttendanceCorrectionId);

ALTER TABLE notify.Notifications
    ADD CONSTRAINT FK_Notifications_LeaveRequest FOREIGN KEY (LeaveRequestId) REFERENCES hr.LeaveRequests(LeaveRequestId);

ALTER TABLE notify.UserNotifications
    ADD CONSTRAINT FK_UserNotifications_Notification FOREIGN KEY (NotificationId) REFERENCES notify.Notifications(NotificationId) ON DELETE CASCADE;

ALTER TABLE notify.UserNotifications
    ADD CONSTRAINT FK_UserNotifications_Recipient FOREIGN KEY (RecipientUserId) REFERENCES iam.Users(UserId);

ALTER TABLE config.OrganizationSettingValues
    ADD CONSTRAINT FK_OrganizationSettings_Organization FOREIGN KEY (OrganizationId) REFERENCES org.Organizations(OrganizationId);

ALTER TABLE config.OrganizationSettingValues
    ADD CONSTRAINT FK_OrganizationSettings_Definition FOREIGN KEY (SettingDefinitionId) REFERENCES config.SettingDefinitions(SettingDefinitionId);

ALTER TABLE config.OrganizationSettingValues
    ADD CONSTRAINT FK_OrganizationSettings_UpdatedBy FOREIGN KEY (UpdatedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE config.UserSettingValues
    ADD CONSTRAINT FK_UserSettings_User FOREIGN KEY (UserId) REFERENCES iam.Users(UserId) ON DELETE CASCADE;

ALTER TABLE config.UserSettingValues
    ADD CONSTRAINT FK_UserSettings_Definition FOREIGN KEY (SettingDefinitionId) REFERENCES config.SettingDefinitions(SettingDefinitionId);

ALTER TABLE audit.AuditEvents
    ADD CONSTRAINT FK_AuditEvents_Organization FOREIGN KEY (OrganizationId) REFERENCES org.Organizations(OrganizationId);

ALTER TABLE audit.AuditEvents
    ADD CONSTRAINT FK_AuditEvents_Actor FOREIGN KEY (ActorUserId) REFERENCES iam.Users(UserId);

ALTER TABLE audit.AuditEvents
    ADD CONSTRAINT FK_AuditEvents_Impersonator FOREIGN KEY (ImpersonatedByUserId) REFERENCES iam.Users(UserId);

ALTER TABLE audit.AuditEvents
    ADD CONSTRAINT FK_AuditEvents_Project FOREIGN KEY (ProjectId) REFERENCES work.Projects(ProjectId);

ALTER TABLE audit.AuditEvents
    ADD CONSTRAINT FK_AuditEvents_Task FOREIGN KEY (TaskId) REFERENCES work.Tasks(TaskId);

ALTER TABLE audit.AuditEvents
    ADD CONSTRAINT FK_AuditEvents_Attendance FOREIGN KEY (AttendanceRecordId) REFERENCES hr.AttendanceRecords(AttendanceRecordId);

ALTER TABLE audit.AuditEvents
    ADD CONSTRAINT FK_AuditEvents_UserRole FOREIGN KEY (UserRoleId) REFERENCES iam.UserRoles(UserRoleId);

ALTER TABLE audit.AuditEventChanges
    ADD CONSTRAINT FK_AuditEventChanges_Event FOREIGN KEY (AuditEventId) REFERENCES audit.AuditEvents(AuditEventId) ON DELETE CASCADE;

ALTER TABLE iam.UserProfiles
    ADD CONSTRAINT FK_UserProfiles_ProfileImage FOREIGN KEY (ProfileImageFileId) REFERENCES collab.StoredFiles(FileId);

ALTER TABLE collab.DiscussionThreads
    ADD CONSTRAINT FK_DiscussionThreads_Attendance FOREIGN KEY (AttendanceRecordId) REFERENCES hr.AttendanceRecords(AttendanceRecordId);

ALTER TABLE collab.DiscussionThreads
    ADD CONSTRAINT FK_DiscussionThreads_AttendanceCorrection FOREIGN KEY (AttendanceCorrectionId) REFERENCES hr.AttendanceCorrectionRequests(AttendanceCorrectionId);

ALTER TABLE collab.DiscussionThreads
    ADD CONSTRAINT FK_DiscussionThreads_Leave FOREIGN KEY (LeaveRequestId) REFERENCES hr.LeaveRequests(LeaveRequestId);

ALTER TABLE collab.DiscussionThreads
    ADD CONSTRAINT FK_DiscussionThreads_ReportRun FOREIGN KEY (ReportRunId) REFERENCES reporting.ReportRuns(ReportRunId);
