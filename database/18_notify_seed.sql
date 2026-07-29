-- Reference data required for the Notification Module's backend integration
-- (feature/notification-backend-integration). This is SEED DATA ONLY — no
-- CREATE TABLE / ALTER TABLE statements — added because notify.Notifications
-- and notify.UserNotifications carry foreign keys into iam.Users,
-- work.Projects and work.Tasks (see database/13_foreign_keys.sql:419-444),
-- and 17_seed.sql never populated those tables (it only seeds lookup/enum
-- tables). Without these rows, nothing could ever be inserted into the
-- notify schema against a real Postgres instance.
--
-- Row shapes mirror the existing frontend mock data 1:1
-- (frontend/src/mock-data/fixtures.ts) and the values already hardcoded in
-- backend/src/store/userStore.ts / backend/src/store/projectStore.ts, using
-- the same usr-<n>/prj-<n>/tsk-<n> <-> integer id convention already
-- established in frontend/src/features/tasks/taskRepository.ts.

-- ─── Organization ────────────────────────────────────────────────────────
INSERT INTO org.Organizations (OrganizationId, OrganizationCode, OrganizationName)
OVERRIDING SYSTEM VALUE
VALUES (1, 'WORKSYNC', 'WorkSync Inc.')
ON CONFLICT (OrganizationId) DO NOTHING;

-- ─── Users (iam.Users) — usr-1..usr-8 ───────────────────────────────────
INSERT INTO iam.Users
    (UserId, OrganizationId, Email, GivenName, FamilyName, DisplayName, Designation, AccountStatus, DeactivatedAtUtc)
OVERRIDING SYSTEM VALUE
VALUES
    (1, 1, 'fazal.k@codoc.com',    'Fazal',   'Khan',     'Fazal Khan',     'Managing Director & Operations Oversight', 'Active', NULL),
    (2, 1, 'adolf.h@codoc.com',    'Adolf',   'Adolf',    'Adolf',          'Lead Software Architect',                  'Active', NULL),
    (3, 1, 'maryam@codoc.com',     'Maryam',  'Maryam',   'Maryam',         'Head of People Operations',                'Active', NULL),
    (4, 1, 'salman.c@codoc.com',   'Salman',  'Ahmed',    'Salman Ahmed',   'Senior Frontend Engineer',                 'Active', NULL),
    (5, 1, 'liam.g@cyberoffice.io','Liam',    'Gallagher','Liam Gallagher', 'Lead Product Designer',                    'Active', NULL),
    (6, 1, 'priya.s@cyberoffice.io','Priya',  'Sharma',   'Priya Sharma',   'AI Product Lead',                          'Active', NULL),
    (7, 1, 'derrick.m@cyberoffice.io','Derrick','Miller', 'Derrick Miller', 'DevOps & Reliability Engineer',             'Active', NULL),
    (8, 1, 'aisha.o@cyberoffice.io','Aisha',  'Omar',     'Aisha Omar',     'HR Compliance Officer',                    'Deactivated', CURRENT_TIMESTAMP)
ON CONFLICT (UserId) DO NOTHING;

SELECT setval(pg_get_serial_sequence('iam.Users', 'userid'), (SELECT MAX(UserId) FROM iam.Users));

-- ─── Projects (work.Projects) — prj-1..prj-6 ────────────────────────────
INSERT INTO work.Projects
    (ProjectId, OrganizationId, ProjectCode, ProjectName, Description, OwnerUserId, ProjectStatusId, PriorityId, StartDate, EndDate, CreatedByUserId)
OVERRIDING SYSTEM VALUE
VALUES
    (1, 1, 'PROJ-NX',  'Nexus AI Copilot Integration',
        'Next-gen LLM copilot engine embedded across all workstation tools for automated code reviews and task summaries.',
        2, (SELECT ProjectStatusId FROM work.ProjectStatuses WHERE StatusCode = 'Active'),
        (SELECT PriorityId FROM work.Priorities WHERE PriorityCode = 'High'), '2026-06-01', '2026-08-30', 1),
    (2, 1, 'PROJ-KG',  'Kinetic Glass Design System',
        'Comprehensive UI token library and glassmorphic micro-interaction framework powering the entire product suite.',
        6, (SELECT ProjectStatusId FROM work.ProjectStatuses WHERE StatusCode = 'Active'),
        (SELECT PriorityId FROM work.Priorities WHERE PriorityCode = 'Medium'), '2026-05-15', '2026-09-01', 1),
    (3, 1, 'PROJ-AT',  'Automated Attendance & HR Vault',
        'Live clocking, multi-break counter, automated leave policy exceptions, and HR approval portal.',
        2, (SELECT ProjectStatusId FROM work.ProjectStatuses WHERE StatusCode = 'Active'),
        (SELECT PriorityId FROM work.Priorities WHERE PriorityCode = 'High'), '2026-06-15', '2026-08-20', 3),
    (4, 1, 'PROJ-OS',  'OmniStream Realtime Communication',
        'Ultra-low latency web-sockets messaging with pinned message caps, @mentions, and file previews.',
        2, (SELECT ProjectStatusId FROM work.ProjectStatuses WHERE StatusCode = 'PendingActivation'),
        (SELECT PriorityId FROM work.Priorities WHERE PriorityCode = 'Medium'), '2026-08-01', '2026-10-30', 2),
    (5, 1, 'PROJ-QA',  'Zero-Trust Security & Backup Vault',
        'Automated database snapshots, Admin two-step deactivation flow safeguards, and audit log vault.',
        2, (SELECT ProjectStatusId FROM work.ProjectStatuses WHERE StatusCode = 'Active'),
        (SELECT PriorityId FROM work.Priorities WHERE PriorityCode = 'Critical'), '2026-04-01', '2026-07-30', 1),
    (6, 1, 'PROJ-LEG', 'Legacy Monolith Migration',
        'Archived project representing the initial monolithic refactoring pass.',
        2, (SELECT ProjectStatusId FROM work.ProjectStatuses WHERE StatusCode = 'Archived'),
        (SELECT PriorityId FROM work.Priorities WHERE PriorityCode = 'Low'), '2025-01-01', '2025-12-31', 1)
ON CONFLICT (ProjectId) DO NOTHING;

SELECT setval(pg_get_serial_sequence('work.Projects', 'projectid'), (SELECT MAX(ProjectId) FROM work.Projects));

-- ─── Tasks (work.Tasks) — tsk-101..tsk-108 ──────────────────────────────
INSERT INTO work.Tasks
    (TaskId, ProjectId, TaskNumber, Title, Description, TaskStatusId, PriorityId, StartDate, DueDate, CreatedByUserId, CompletedAtUtc, CompletionSummary)
OVERRIDING SYSTEM VALUE
VALUES
    (101, 1, 12, 'Implement Issue & PR Markdown Composer tab in AI Assistant',
        'Build a dedicated sub-view in AI Assistant with type picker, live Markdown preview, code snippet insertion, and exact finalized PR template output.',
        (SELECT TaskStatusId FROM work.TaskStatuses WHERE StatusCode = 'InProgress'),
        (SELECT PriorityId FROM work.Priorities WHERE PriorityCode = 'Critical'), '2026-07-21', '2026-07-26', 2, NULL, NULL),
    (102, 1, 15, 'Grounding Context Picker for Task & Project Data',
        'Enable selecting a specific project or task to supply structured mock context into prompt generation.',
        (SELECT TaskStatusId FROM work.TaskStatuses WHERE StatusCode = 'Todo'),
        (SELECT PriorityId FROM work.Priorities WHERE PriorityCode = 'High'), '2026-07-22', '2026-07-29', 2, NULL, NULL),
    (103, 2, 4, 'Cursor-reactive Radial Glow & 3D Parallax Tilt Cards',
        'Add mouse position tracking on Kinetic Glass cards for soft radial light bleed and spring-damped 3D perspective shift.',
        (SELECT TaskStatusId FROM work.TaskStatuses WHERE StatusCode = 'Review'),
        (SELECT PriorityId FROM work.Priorities WHERE PriorityCode = 'Medium'), '2026-07-18', '2026-07-25', 6, NULL, NULL),
    (104, 3, 8, 'Multi-Break Counter & HR Review Queue Integration',
        'Build running break timer for Lunch, Short Break, and Other. Route break policy exceptions and attendance corrections to HR queue.',
        (SELECT TaskStatusId FROM work.TaskStatuses WHERE StatusCode = 'Done'),
        (SELECT PriorityId FROM work.Priorities WHERE PriorityCode = 'Critical'), '2026-07-15', '2026-07-23', 3, '2026-07-23T00:00:00Z',
        'Fully functional break counter with live interval timer and separate HR approval queue.'),
    (105, 1, 22, 'Optimize Vector Embedding Search Cache',
        'Blocked due to pending security rate limiter approval from DevOps team.',
        (SELECT TaskStatusId FROM work.TaskStatuses WHERE StatusCode = 'Blocked'),
        (SELECT PriorityId FROM work.Priorities WHERE PriorityCode = 'High'), '2026-07-20', '2026-07-27', 2, NULL, NULL),
    (106, 4, 1, 'Implement Pinned Messages Cap (~10) in Project Chat',
        'Create pinned messages side panel with max 10 pins, pin/unpin micro-animation, and reverse-chronological order.',
        (SELECT TaskStatusId FROM work.TaskStatuses WHERE StatusCode = 'Todo'),
        (SELECT PriorityId FROM work.Priorities WHERE PriorityCode = 'Medium'), '2026-07-23', '2026-08-05', 2, NULL, NULL),
    (107, 2, 9, 'Dark/Light Theme Sweep Animation',
        'Animate dark and light mode toggle with radial sweep overlay rather than instantaneous color jump.',
        (SELECT TaskStatusId FROM work.TaskStatuses WHERE StatusCode = 'InProgress'),
        (SELECT PriorityId FROM work.Priorities WHERE PriorityCode = 'Low'), '2026-07-19', '2026-07-30', 6, NULL, NULL),
    (108, 5, 3, 'Two-Step Admin Deactivation Confirmation Modal',
        'Build fail-safe dialog flow requiring explicit second confirmation and preventing deactivation of the last Admin.',
        (SELECT TaskStatusId FROM work.TaskStatuses WHERE StatusCode = 'InProgress'),
        (SELECT PriorityId FROM work.Priorities WHERE PriorityCode = 'High'), '2026-07-22', '2026-07-28', 1, NULL, NULL)
ON CONFLICT (TaskId) DO NOTHING;

SELECT setval(pg_get_serial_sequence('work.Tasks', 'taskid'), (SELECT MAX(TaskId) FROM work.Tasks));

-- ─── Notification Types (notify.NotificationTypes) ──────────────────────
-- TypeCode values match the frontend's NotificationType union
-- (frontend/src/types/index.ts) 1:1 so the mapper never has to translate
-- codes, only casing (frontend uses snake_case already matching TypeCode).
-- CategoryCode groups them for role-based delivery + link-route derivation
-- (see notification.mapper.ts). DefaultPriority uses this table's own
-- 'Low'/'Normal'/'High'/'Critical' vocabulary (note: 'Normal', not the
-- frontend's 'Medium' — mapped in notification.mapper.ts).
INSERT INTO notify.NotificationTypes (TypeCode, CategoryCode, DefaultPriority, IsMandatory, DefaultEnabled)
VALUES
    -- Task
    ('task_assigned',          'Task',       'High',     FALSE, TRUE),
    ('task_reassigned',        'Task',       'High',     FALSE, TRUE),
    ('task_updated',           'Task',       'Normal',   FALSE, TRUE),
    ('task_status_changed',    'Task',       'Normal',   FALSE, TRUE),
    ('task_priority_changed',  'Task',       'Normal',   FALSE, TRUE),
    ('task_due_date_changed',  'Task',       'Normal',   FALSE, TRUE),
    ('task_review_requested',  'Task',       'High',     FALSE, TRUE),
    ('task_review_approved',   'Task',       'High',     FALSE, TRUE),
    ('task_review_rejected',   'Task',       'High',     FALSE, TRUE),
    ('task_completed',         'Task',       'Normal',   FALSE, TRUE),
    ('task_deleted',           'Task',       'Normal',   FALSE, TRUE),
    ('task_due_today',         'Task',       'High',     FALSE, TRUE),
    ('task_due_tomorrow',      'Task',       'Normal',   FALSE, TRUE),
    ('task_overdue',           'Task',       'High',     FALSE, TRUE),
    ('checklist_completed',    'Task',       'Low',      FALSE, TRUE),
    ('comment_added',          'Task',       'Normal',   FALSE, TRUE),
    ('mention',                'Chat',       'Normal',   FALSE, TRUE),
    ('attachment_uploaded',    'Task',       'Low',      FALSE, TRUE),
    -- Project
    ('project_created',        'Project',    'Normal',   FALSE, TRUE),
    ('project_updated',        'Project',    'Low',      FALSE, TRUE),
    ('project_archived',       'Project',    'Normal',   FALSE, TRUE),
    ('project_restored',       'Project',    'Normal',   FALSE, TRUE),
    ('project_deleted',        'Project',    'High',     FALSE, TRUE),
    ('project_member_added',   'Project',    'Normal',   FALSE, TRUE),
    ('project_member_removed', 'Project',    'Normal',   FALSE, TRUE),
    -- Approvals / system / admin
    ('approval',                'Approval',  'High',     FALSE, TRUE),
    ('user_registered',         'System',    'Normal',   FALSE, TRUE),
    ('user_role_changed',       'System',    'High',     FALSE, TRUE),
    ('user_deactivated',        'System',    'High',     FALSE, TRUE),
    ('workspace_created',       'System',    'Normal',   FALSE, TRUE),
    ('workspace_deleted',       'System',    'High',     FALSE, TRUE),
    ('backup_completed',        'System',    'Low',      FALSE, TRUE),
    ('backup_failed',           'System',    'Critical', TRUE,  TRUE),
    ('security_alert',          'System',    'Critical', TRUE,  TRUE),
    ('audit_alert',             'System',    'High',     FALSE, TRUE),
    ('system_maintenance',      'System',    'Normal',   FALSE, TRUE),
    ('attendance',               'Attendance','Normal',  FALSE, TRUE),
    ('task',                     'Task',      'Normal',  FALSE, TRUE),
    ('system',                   'System',    'Low',     FALSE, TRUE),
    -- Attendance
    ('attendance_check_in',            'Attendance', 'Low',    FALSE, TRUE),
    ('attendance_check_out',           'Attendance', 'Low',    FALSE, TRUE),
    ('attendance_late_check_in',       'Attendance', 'Normal', FALSE, TRUE),
    ('attendance_absent',              'Attendance', 'High',   FALSE, TRUE),
    ('attendance_correction_submitted','Attendance', 'Normal', FALSE, TRUE),
    ('attendance_correction_approved', 'Attendance', 'Normal', FALSE, TRUE),
    ('attendance_correction_rejected', 'Attendance', 'Normal', FALSE, TRUE),
    -- Break Management
    ('break_started',    'Break', 'Low',    FALSE, TRUE),
    ('break_ended',       'Break', 'Low',    FALSE, TRUE),
    ('break_exceeded',    'Break', 'High',   FALSE, TRUE),
    ('break_reminder',    'Break', 'Normal', FALSE, TRUE),
    ('break_approved',    'Break', 'Normal', FALSE, TRUE),
    ('break_rejected',    'Break', 'Normal', FALSE, TRUE),
    -- Reports
    ('report_weekly_generated',      'Report', 'Normal', FALSE, TRUE),
    ('report_monthly_generated',     'Report', 'Normal', FALSE, TRUE),
    ('report_sprint_ready',          'Report', 'Normal', FALSE, TRUE),
    ('report_productivity_ready',    'Report', 'Normal', FALSE, TRUE),
    ('report_project_completion',    'Report', 'High',   FALSE, TRUE),
    -- Project Chat (beyond `mention`, already listed under Chat above)
    ('chat_reply',          'Chat', 'Normal', FALSE, TRUE),
    ('chat_new_message',    'Chat', 'Low',    FALSE, TRUE),
    ('chat_file_shared',    'Chat', 'Normal', FALSE, TRUE),
    ('chat_thread_reply',   'Chat', 'Normal', FALSE, TRUE),
    ('chat_announcement',   'Chat', 'High',   FALSE, TRUE),
    -- AI Assistant
    ('ai_sprint_generated',        'AI', 'Normal', FALSE, TRUE),
    ('ai_tasks_generated',         'AI', 'Normal', FALSE, TRUE),
    ('ai_meeting_summarized',      'AI', 'Normal', FALSE, TRUE),
    ('ai_deadline_suggested',      'AI', 'Normal', FALSE, TRUE),
    ('ai_overdue_detected',        'AI', 'High',   FALSE, TRUE),
    ('ai_recommendation_available','AI', 'Low',    FALSE, TRUE)
ON CONFLICT (TypeCode) DO NOTHING;
