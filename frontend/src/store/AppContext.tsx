import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import {
  UserRole,
  User,
  Project,
  Task,
  TaskStatus,
  AttendanceRecord,
  HRRequest,
  SystemApproval,
  ChatMessage,
  AIQueryLog,
  AIUsageAudit,
  NotificationItem,
  NotificationPreferences,
  ToastItem,
  ToastTone,
  ActivityLogItem,
  CalendarEvent,
  SavedPrompt,
  WeeklySummaryDraft,
  BreakType,
  WorkBreak,
  ControlledEditRequest,
  TaskStatusHistoryEntry
} from '../types';
import {
  INITIAL_USERS,
  INITIAL_PROJECTS,
  INITIAL_TASKS,
  INITIAL_ATTENDANCE,
  INITIAL_HR_REQUESTS,
  INITIAL_SYSTEM_APPROVALS,
  INITIAL_CHAT_MESSAGES,
  INITIAL_AI_LOGS,
  INITIAL_AI_AUDIT,
  INITIAL_NOTIFICATIONS,
  INITIAL_ACTIVITY_LOGS,
  INITIAL_CALENDAR_EVENTS,
  INITIAL_SAVED_PROMPTS,
  INITIAL_WEEKLY_DRAFT
} from '../mock-data/fixtures';
import {
  TaskMutationData,
  TaskMutationResult,
  getTaskAssigneeIds
} from '../features/tasks/taskRules';
import {
  prepareTaskCreation,
  prepareTaskDeletion,
  prepareTaskUpdate,
  toTaskFormInput
} from '../features/tasks/taskMutations';
import { loadTasksFromSupabase } from '../features/tasks/taskRepository';
import {
  SendNotificationInput,
  sendNotification,
  markAsRead,
  markAllAsRead as markAllAsReadInList,
  clearNotification as removeNotificationFromList,
  resolveAdminRecipients,
  resolveProjectRecipients,
  resolveSingleRecipient,
  resolveTaskRecipients
} from '../features/notifications/notificationService';
import { getNotificationTypeMeta } from '../features/notifications/notificationTypes';

interface AppState {
  currentRole: UserRole;
  currentUser: User;
  users: User[];
  theme: 'dark' | 'light';
  projects: Project[];
  tasks: Task[];
  attendanceRecords: AttendanceRecord[];
  hrRequests: HRRequest[];
  systemApprovals: SystemApproval[];
  chatMessages: ChatMessage[];
  aiLogs: AIQueryLog[];
  aiAudits: AIUsageAudit[];
  notifications: NotificationItem[];
  toasts: ToastItem[];
  notificationPreferences: NotificationPreferences;
  activityLogs: ActivityLogItem[];
  calendarEvents: CalendarEvent[];
  savedPrompts: SavedPrompt[];
  weeklySummaryDraft: WeeklySummaryDraft;
  activeBreak: {
    isBreaking: boolean;
    breakType: BreakType;
    startTime: string; // HH:mm
    elapsedSeconds: number;
  } | null;
  settings: {
    workingHours: { start: string; end: string };
    breakLimitMinutes: number;
    maskedAiKey: string;
    maxChatPins: number;
  };
  // Actions
  setRole: (role: UserRole) => void;
  refreshUsers: () => void;
  onUserRegistered: (user: User) => void;
  loginUser: (user: User) => void;
  toggleTheme: () => void;
  createProject: (data: Partial<Project>) => void;
  approveProject: (projectId: string) => void;
  rejectProject: (projectId: string, reason?: string) => void;
  updateProject: (projectId: string, data: Partial<Project>) => void;
  deleteProject: (projectId: string) => void;
  createTask: (data: TaskMutationData) => TaskMutationResult;
  updateTask: (taskId: string, data: TaskMutationData) => TaskMutationResult;
  deleteTask: (taskId: string) => TaskMutationResult;
  updateTaskStatus: (
    taskId: string,
    newStatus: TaskStatus,
    extraInfo?: {
      workSummary?: string;
      completionSummary?: string;
      blockerReason?: string;
      reopenReason?: string;
      // Project Board fields: `note` is the mandatory reason shown in the board's
      // status-change modal and is recorded on Task.statusHistory. `reviewDecision`
      // marks the change as an explicit Team Lead/Admin Approve or Reject action.
      note?: string;
      reviewDecision?: 'Approve' | 'Reject';
    }
  ) => { success: boolean; message: string };
  proposeControlledEdit: (taskId: string, field: 'dueDate' | 'priority' | 'description' | 'assignee' | 'status', newValue: string, reason: string) => void;
  approveApprovalItem: (approvalId: string) => void;
  rejectApprovalItem: (approvalId: string, reason?: string) => void;
  checkIn: () => void;
  checkOut: () => void;
  startBreak: (breakType: BreakType) => void;
  endBreak: () => void;
  submitHRRequest: (type: HRRequest['type'], reason: string, details: HRRequest['details']) => void;
  approveHRRequest: (requestId: string, decisionReason?: string) => void;
  rejectHRRequest: (requestId: string, decisionReason?: string) => void;
  sendChatMessage: (projectId: string, message: string) => void;
  togglePinMessage: (projectId: string, messageId: string) => void;
  addAIQueryLog: (query: string, scope: string, responseSummary: string) => void;
  updateWeeklySummaryDraft: (data: Partial<WeeklySummaryDraft>) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotification: (id: string) => void;
  updateNotificationPreferences: (data: Partial<NotificationPreferences>) => void;
  dismissToast: (id: string) => void;
  deactivateUser: (userId: string) => { success: boolean; message: string };
  exportBackup: () => void;
}

const AppContext = createContext<AppState | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [users, setUsers] = useState<User[]>(INITIAL_USERS);
  const [currentRole, setCurrentRole] = useState<UserRole>('Admin');
  const [currentUser, setCurrentUser] = useState<User>(INITIAL_USERS[0]);
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const [projects, setProjects] = useState<Project[]>(INITIAL_PROJECTS);
  const [tasks, setTasks] = useState<Task[]>(INITIAL_TASKS);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>(INITIAL_ATTENDANCE);
  const [hrRequests, setHrRequests] = useState<HRRequest[]>(INITIAL_HR_REQUESTS);
  const [systemApprovals, setSystemApprovals] = useState<SystemApproval[]>(INITIAL_SYSTEM_APPROVALS);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(INITIAL_CHAT_MESSAGES);
  const [aiLogs, setAiLogs] = useState<AIQueryLog[]>(INITIAL_AI_LOGS);
  const [aiAudits, setAiAudits] = useState<AIUsageAudit[]>(INITIAL_AI_AUDIT);
  const [notifications, setNotifications] = useState<NotificationItem[]>(INITIAL_NOTIFICATIONS);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>({
    toast: true,
    inApp: true,
    dueReminders: true,
    mentions: true,
    comments: true,
    assignments: true,
    email: false
  });
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>(INITIAL_ACTIVITY_LOGS);
  const [calendarEvents] = useState<CalendarEvent[]>(INITIAL_CALENDAR_EVENTS);
  const [savedPrompts] = useState<SavedPrompt[]>(INITIAL_SAVED_PROMPTS);
  const [weeklySummaryDraft, setWeeklySummaryDraft] = useState<WeeklySummaryDraft>(INITIAL_WEEKLY_DRAFT);
  const recentTaskSubmission = useRef<{ signature: string; submittedAt: number } | null>(null);

  const [activeBreak, setActiveBreak] = useState<{
    isBreaking: boolean;
    breakType: BreakType;
    startTime: string;
    elapsedSeconds: number;
  } | null>(null);

  const [settings] = useState({
    workingHours: { start: '09:00', end: '18:00' },
    breakLimitMinutes: 60,
    maskedAiKey: 'sk-proj-••••••••••••••••38FA',
    maxChatPins: 10
  });

  // Role Switcher Handler
  const setRole = (role: UserRole) => {
    setCurrentRole(role);
    const matchedUser = users.find((u) => u.role === role) || users[0];
    setCurrentUser(matchedUser);
  };

  // Theme Toggle Handler
  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    const root = document.documentElement;
    if (next === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
  };

  const refreshUsers = () => {
    fetch('/api/auth/users')
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.users) && data.users.length > 0) {
          setUsers(data.users as User[]);
        }
      })
      .catch(() => {
        // Silently keep default users if offline
      });
  };

  const onUserRegistered = (newUser: User) => {
    setUsers((prev) => {
      const exists = prev.some((u) => u.email.toLowerCase() === newUser.email.toLowerCase());
      if (exists) return prev;
      return [...prev, newUser];
    });
    setCurrentUser(newUser);
    setCurrentRole(newUser.role);
    refreshUsers();
  };

  const loginUser = (user: User) => {
    setUsers((prev) => {
      const exists = prev.some((u) => u.email.toLowerCase() === user.email.toLowerCase());
      if (exists) return prev;
      return [...prev, user];
    });
    setCurrentUser(user);
    setCurrentRole(user.role);
    refreshUsers();
  };

  // Fetch persisted database users on mount
  useEffect(() => {
    refreshUsers();
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.classList.remove('light');
    } else {
      root.classList.remove('dark');
      root.classList.add('light');
    }
  }, [theme]);

  useEffect(() => {
    let isActive = true;

    const hydrateTasks = async () => {
      try {
        const remoteTasks = await loadTasksFromSupabase(projects);
        if (isActive && remoteTasks !== null) {
          setTasks(remoteTasks);
        }
      } catch (error) {
        console.warn(
          'Supabase task query failed; continuing with local task data.',
          error
        );
      }
    };

    void hydrateTasks();

    return () => {
      isActive = false;
    };
  }, []);

  // Break Timer Interval Effect
  useEffect(() => {
    let interval: any = null;
    if (activeBreak?.isBreaking) {
      interval = setInterval(() => {
        setActiveBreak((prev) => prev ? { ...prev, elapsedSeconds: prev.elapsedSeconds + 1 } : null);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [activeBreak?.isBreaking]);

  // Log Activity Helper
  const pushActivity = (
    action: string,
    targetType: ActivityLogItem['targetType'],
    targetId: string,
    targetTitle: string,
    diff?: ActivityLogItem['diff']
  ) => {
    const newAct: ActivityLogItem = {
      id: `act-${Date.now()}`,
      userId: currentUser.id,
      userName: currentUser.name,
      userAvatar: currentUser.avatar,
      action,
      targetType,
      targetId,
      targetTitle,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      diff
    };
    setActivityLogs((prev) => [newAct, ...prev]);
  };

  // --- Notification Module -----------------------------------------------------------
  // Every trigger point below only *describes* what happened and calls dispatchNotifications;
  // NotificationService (features/notifications/notificationService.ts) owns recipient
  // resolution (RBAC) and NotificationItem construction. No component or action here ever
  // pushes onto `notifications` directly except through this one function.
  const pushToast = (tone: ToastTone, title: string, message: string) => {
    const toast: ToastItem = {
      id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      tone,
      title,
      message
    };
    setToasts((prev) => [...prev, toast]);
  };

  const dismissToast = (id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  };

  const dispatchNotifications = (input: SendNotificationInput) => {
    const created = sendNotification(input);
    if (created.length === 0) return;
    setNotifications((prev) => [...created, ...prev]);

    // Toasts only fire for the notification(s) addressed to the person currently viewing the
    // app — this is a single-session prototype, so there is no live socket to push a toast to
    // any of the other simulated recipients.
    if (notificationPreferences.toast) {
      created
        .filter((notification) => notification.userId === currentUser.id)
        .forEach((notification) => {
          const meta = getNotificationTypeMeta(notification.type);
          pushToast(meta.tone, notification.title, notification.message);
        });
    }
  };

  // Confirms to the person who just performed an action that it actually went through — a
  // success toast for the actor themselves, independent of dispatchNotifications above. The
  // actor is almost always excluded from a trigger's own recipient list (nobody needs to be
  // told about the action they just took), so without this they'd get no feedback at all that
  // e.g. their status change or task edit succeeded. Respects the same toast preference toggle
  // as every other notification toast.
  const confirmActionSuccess = (title: string, message: string) => {
    if (notificationPreferences.toast) {
      pushToast('success', title, message);
    }
  };

  // Due-date reminder scanner (FR-18: "Due Tomorrow" — 24 hours before deadline).
  // There is no backend scheduler in this prototype (see docs/Notification_Module_Guide.md
  // §9), so this is a frontend stopgap: it scans `tasks` for anything exactly one calendar
  // day from its due date and fires a `task_due_tomorrow` reminder automatically, with no
  // user action required. Recipients follow the same rule as every other task notification
  // (resolveTaskRecipients: assignee(s) + creator + the project's Team Lead) since the PRD's
  // Due Tomorrow recipients are "Assigned Members + Team Lead", not the assignee alone.
  // `dueReminderSentRef` deduplicates by task+day so re-scans (interval tick, task list
  // change) never re-notify for a date already covered — it resets on page reload along with
  // the rest of this in-memory prototype's state.
  const dueReminderSentRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const checkDueTomorrowReminders = () => {
      const todayStr = new Date().toISOString().split('T')[0];
      const today = new Date(`${todayStr}T00:00:00`);

      tasks.forEach((task) => {
        if (task.status === 'Done') return;

        const dueDate = new Date(`${task.dueDate}T00:00:00`);
        if (Number.isNaN(dueDate.getTime())) return;

        const diffDays = Math.round((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays !== 1) return;

        const dedupeKey = `${task.id}:due_tomorrow:${todayStr}`;
        if (dueReminderSentRef.current.has(dedupeKey)) return;
        dueReminderSentRef.current.add(dedupeKey);

        const project = projects.find((p) => p.id === task.projectId);
        dispatchNotifications({
          recipientIds: resolveTaskRecipients({ task, project }),
          type: 'task_due_tomorrow',
          title: 'Task Due Tomorrow',
          message: `"${task.title}" in ${project?.title || 'the project'} is due tomorrow (${task.dueDate}).`,
          linkRoute: 'tasks',
          projectId: task.projectId,
          taskId: task.id
        });
      });
    };

    checkDueTomorrowReminders();
    const interval = setInterval(checkDueTomorrowReminders, 60 * 60 * 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, projects]);

  // Create Project (Role Enforcement: TL creation needs Admin approval)
  const createProject = (data: Partial<Project>) => {
    const isAdmin = currentRole === 'Admin';
    const newProjId = `prj-${Date.now()}`;
    const code = `PROJ-${Math.floor(100 + Math.random() * 900)}`;

    // Admin may explicitly choose to hold a new project as Pending Approval (draft);
    // Team Lead creation always routes to Pending Approval for Admin review.
    const status = isAdmin ? (data.status || 'Active') : 'Pending Approval';
    const approvalStatus = isAdmin ? (status === 'Active' ? 'Approved' : 'Pending Approval') : 'Pending Approval';

    const newProject: Project = {
      id: newProjId,
      code,
      title: data.title || 'Untitled Project',
      description: data.description || '',
      status,
      approvalStatus,
      createdBy: currentUser.id,
      teamLeadId: data.teamLeadId || currentUser.id,
      memberIds: data.memberIds || [currentUser.id],
      startDate: data.startDate || new Date().toISOString().split('T')[0],
      targetDate: data.targetDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      priority: data.priority || 'Medium',
      progress: 0,
      tags: data.tags || ['New Project'],
      milestones: data.milestones || [],
      files: data.files || [],
      pinnedMessagesCount: 0,
      creationReason: data.creationReason
    };

    setProjects((prev) => [newProject, ...prev]);

    if (!isAdmin) {
      // Create System Approval for Admin
      const approval: SystemApproval = {
        id: `app-${Date.now()}`,
        type: 'Project_Creation',
        targetId: newProjId,
        targetTitle: newProject.title,
        requestedBy: currentUser.id,
        requestedRole: currentRole,
        createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
        details: `Team Lead ${currentUser.name} proposed new project "${newProject.title}". Pending Admin approval.`,
        status: 'Pending'
      };
      setSystemApprovals((prev) => [approval, ...prev]);

      dispatchNotifications({
        recipientIds: resolveAdminRecipients(users, currentUser.id),
        type: 'approval',
        title: 'Project Approval Requested',
        message: `${currentUser.name} requested approval for new project "${newProject.title}".`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'approvals',
        projectId: newProjId
      });
      confirmActionSuccess('Project Submitted', `"${newProject.title}" was submitted for Admin approval successfully.`);
    } else {
      confirmActionSuccess('Project Created', `"${newProject.title}" was created successfully.`);
    }

    // Notify the Team Lead AND every project member that the project now exists — regardless
    // of whether it's Active (Admin-created) or Pending Approval (Team-Lead-created; members
    // can already see it in the Projects list either way). Previously: Admin-created projects
    // only notified the Team Lead ("assigned you as Team Lead"), leaving members with no
    // notification at all; Team-Lead-created projects notified nobody but Admins. Both gaps
    // are fixed here in one shared block instead of two near-duplicate ones.
    const projectCreatedRecipients = resolveProjectRecipients({ project: newProject, excludeUserId: currentUser.id });
    if (projectCreatedRecipients.length > 0) {
      const projectCreatedMessages: Record<string, string> = {};
      projectCreatedRecipients.forEach((recipientId) => {
        projectCreatedMessages[recipientId] =
          recipientId === newProject.teamLeadId
            ? `${currentUser.name} created the new project "${newProject.title}" and assigned you as Team Lead.`
            : `${currentUser.name} created the new project "${newProject.title}" and added you as a member.`;
      });

      dispatchNotifications({
        recipientIds: projectCreatedRecipients,
        type: 'project_created',
        title: 'New Project Created',
        message: `${currentUser.name} created the new project "${newProject.title}".`,
        recipientMessages: projectCreatedMessages,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'projects',
        projectId: newProjId
      });
    }

    pushActivity('Created project', 'Project', newProjId, newProject.title);
  };

  const approveProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    const approvalItem = systemApprovals.find(
      (sa) => sa.targetId === projectId && sa.type === 'Project_Creation'
    );

    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, status: 'Active', approvalStatus: 'Approved' } : p))
    );
    setSystemApprovals((prev) =>
      prev.map((sa) => (sa.targetId === projectId ? { ...sa, status: 'Approved' } : sa))
    );

    if (project && approvalItem) {
      dispatchNotifications({
        recipientIds: resolveSingleRecipient(approvalItem.requestedBy, currentUser.id),
        type: 'approval',
        title: 'Project Approved',
        message: `${currentUser.name} approved your project "${project.title}".`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'projects',
        projectId
      });
    }

    if (project) confirmActionSuccess('Project Approved', `"${project.title}" was approved successfully.`);
    pushActivity('Approved project proposal', 'Project', projectId, 'Project Approval');
  };

  const rejectProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    const approvalItem = systemApprovals.find(
      (sa) => sa.targetId === projectId && sa.type === 'Project_Creation'
    );

    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, approvalStatus: 'Rejected' } : p))
    );
    setSystemApprovals((prev) =>
      prev.map((sa) => (sa.targetId === projectId ? { ...sa, status: 'Rejected' } : sa))
    );

    if (project && approvalItem) {
      dispatchNotifications({
        recipientIds: resolveSingleRecipient(approvalItem.requestedBy, currentUser.id),
        type: 'approval',
        title: 'Project Rejected',
        message: `${currentUser.name} rejected your project "${project.title}".`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'projects',
        projectId
      });
    }

    if (project) confirmActionSuccess('Project Rejected', `"${project.title}" was rejected successfully.`);
    pushActivity('Rejected project proposal', 'Project', projectId, 'Project Rejection');
  };

  const updateProject = (projectId: string, data: Partial<Project>) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, ...data } : p))
    );
    pushActivity('Updated project', 'Project', projectId, data.title || project.title);

    const adminRecipients = resolveAdminRecipients(users, currentUser.id);
    const projectRecipients = resolveProjectRecipients({ project, excludeUserId: currentUser.id });
    const wasArchived = project.status === 'Archived';
    const willArchive = data.status === 'Archived';

    if (!wasArchived && willArchive) {
      dispatchNotifications({
        recipientIds: [...adminRecipients, ...projectRecipients],
        type: 'project_archived',
        title: 'Project Archived',
        message: `${currentUser.name} archived project "${project.title}".`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'projects',
        projectId
      });
    } else if (wasArchived && data.status && data.status !== 'Archived') {
      dispatchNotifications({
        recipientIds: [...adminRecipients, ...projectRecipients],
        type: 'project_restored',
        title: 'Project Restored',
        message: `${currentUser.name} restored project "${project.title}".`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'projects',
        projectId
      });
    } else if (data.title || data.description || data.targetDate || data.priority) {
      dispatchNotifications({
        recipientIds: projectRecipients,
        type: 'project_updated',
        title: 'Project Updated',
        message: `${currentUser.name} updated project "${data.title || project.title}".`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'projects',
        projectId
      });
    }

    if (data.memberIds) {
      const beforeIds = new Set(project.memberIds);
      const afterIds = new Set(data.memberIds);
      const added = data.memberIds.filter((id) => !beforeIds.has(id));
      const removed = project.memberIds.filter((id) => !afterIds.has(id));

      added.forEach((userId) =>
        dispatchNotifications({
          recipientIds: resolveSingleRecipient(userId, currentUser.id),
          type: 'project_member_added',
          title: 'Added to Project',
          message: `${currentUser.name} added you to project "${project.title}".`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          linkRoute: 'projects',
          projectId
        })
      );
      removed.forEach((userId) =>
        dispatchNotifications({
          recipientIds: resolveSingleRecipient(userId, currentUser.id),
          type: 'project_member_removed',
          title: 'Removed from Project',
          message: `${currentUser.name} removed you from project "${project.title}".`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          linkRoute: 'projects',
          projectId
        })
      );
    }

    confirmActionSuccess('Project Updated', `Your changes to "${data.title || project.title}" were saved successfully.`);
  };

  const deleteProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    setTasks((prev) => prev.filter((t) => t.projectId !== projectId));

    dispatchNotifications({
      recipientIds: [
        ...resolveAdminRecipients(users, currentUser.id),
        ...resolveSingleRecipient(project.teamLeadId, currentUser.id)
      ],
      type: 'project_deleted',
      title: 'Project Deleted',
      message: `${currentUser.name} deleted project "${project.title}".`,
      actorId: currentUser.id,
      actorName: currentUser.name,
      linkRoute: 'projects',
      projectId
    });

    confirmActionSuccess('Project Deleted', `"${project.title}" was deleted successfully.`);
    pushActivity('Deleted project', 'Project', projectId, project.title);
  };

  // Client-side prototype data boundary. The future API must repeat every
  // authorization and validation check inside a PostgreSQL transaction.
  const createTask = (data: TaskMutationData): TaskMutationResult => {
    const input = toTaskFormInput(data);
    const signature = JSON.stringify(input);
    const now = Date.now();
    if (
      recentTaskSubmission.current?.signature === signature
      && now - recentTaskSubmission.current.submittedAt < 2000
    ) {
      return {
        success: false,
        message: 'This task was already submitted. Please wait before trying again.'
      };
    }

    const result = prepareTaskCreation(data, {
      currentRole,
      currentUserId: currentUser.id,
      projects,
      tasks,
      users
    }, now);
    if (!result.success || !result.task) return result;

    recentTaskSubmission.current = { signature, submittedAt: now };
    setTasks((prev) => [result.task!, ...prev]);
    pushActivity('Created task', 'Task', result.task.id, result.task.title);

    const project = projects.find((p) => p.id === result.task!.projectId);
    const taskRecipients = resolveTaskRecipients({ task: result.task, project, excludeUserId: currentUser.id });
    const newTaskAssigneeIds = getTaskAssigneeIds(result.task);
    const newTaskAssigneeNames = newTaskAssigneeIds
      .map((id) => users.find((user) => user.id === id)?.name)
      .filter((name): name is string => Boolean(name))
      .join(', ') || 'a team member';

    const taskAssignedMessages: Record<string, string> = {};
    taskRecipients.forEach((recipientId) => {
      taskAssignedMessages[recipientId] = newTaskAssigneeIds.includes(recipientId)
        ? `${currentUser.name} assigned you "${result.task!.title}" in ${project?.title || 'the project'}.`
        : `${currentUser.name} assigned ${newTaskAssigneeNames} "${result.task!.title}" in ${project?.title || 'the project'}.`;
    });

    dispatchNotifications({
      recipientIds: taskRecipients,
      type: 'task_assigned',
      title: 'New Task Assigned',
      message: `${currentUser.name} assigned ${newTaskAssigneeNames} "${result.task.title}" in ${project?.title || 'the project'}.`,
      recipientMessages: taskAssignedMessages,
      actorId: currentUser.id,
      actorName: currentUser.name,
      linkRoute: 'tasks',
      projectId: result.task.projectId,
      taskId: result.task.id
    });

    confirmActionSuccess('Task Created', `"${result.task.title}" was created successfully.`);
    return result;
  };

  const updateTask = (taskId: string, data: TaskMutationData): TaskMutationResult => {
    const before = tasks.find((item) => item.id === taskId);
    const result = prepareTaskUpdate(taskId, data, {
      currentRole,
      currentUserId: currentUser.id,
      projects,
      tasks,
      users
    });
    if (!result.success || !result.task) return result;

    setTasks((prev) => prev.map((item) => item.id === taskId ? result.task! : item));
    pushActivity('Updated task', 'Task', taskId, result.task.title);

    if (before) {
      const after = result.task;
      const project = projects.find((p) => p.id === after.projectId);
      const baseRecipients = resolveTaskRecipients({ task: after, project, excludeUserId: currentUser.id });

      const beforeAssignees = getTaskAssigneeIds(before);
      const afterAssignees = getTaskAssigneeIds(after);
      const assigneesChanged =
        JSON.stringify([...beforeAssignees].sort()) !== JSON.stringify([...afterAssignees].sort());

      if (assigneesChanged) {
        const addedAssignees = afterAssignees.filter((id) => !beforeAssignees.includes(id));
        const newAssigneeNames = afterAssignees
          .map((id) => users.find((user) => user.id === id)?.name)
          .filter((name): name is string => Boolean(name))
          .join(', ') || 'Unassigned';
        const reassignRecipients = [
          ...addedAssignees.filter((id) => id !== currentUser.id),
          ...resolveSingleRecipient(project?.teamLeadId, currentUser.id)
        ];
        const genericReassignMessage = `${currentUser.name} reassigned "${after.title}" (${project?.title || 'the project'}) to ${newAssigneeNames}.`;
        const reassignMessages: Record<string, string> = {};
        addedAssignees.forEach((recipientId) => {
          reassignMessages[recipientId] = `${currentUser.name} assigned you "${after.title}" in ${project?.title || 'the project'}.`;
        });

        dispatchNotifications({
          recipientIds: reassignRecipients,
          type: 'task_reassigned',
          title: 'Task Reassigned',
          message: genericReassignMessage,
          recipientMessages: reassignMessages,
          actorId: currentUser.id,
          actorName: currentUser.name,
          linkRoute: 'tasks',
          projectId: after.projectId,
          taskId
        });
      } else if (before.priority !== after.priority) {
        dispatchNotifications({
          recipientIds: baseRecipients,
          type: 'task_priority_changed',
          title: 'Task Priority Changed',
          message: `${currentUser.name} changed "${after.title}" priority from ${before.priority} to ${after.priority} in ${project?.title || 'the project'}.`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          linkRoute: 'tasks',
          projectId: after.projectId,
          taskId
        });
      } else if (before.dueDate !== after.dueDate) {
        dispatchNotifications({
          recipientIds: baseRecipients,
          type: 'task_due_date_changed',
          title: 'Due Date Changed',
          message: `${currentUser.name} changed the due date for "${after.title}" from ${before.dueDate} to ${after.dueDate} in ${project?.title || 'the project'}.`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          linkRoute: 'tasks',
          projectId: after.projectId,
          taskId
        });
      } else {
        dispatchNotifications({
          recipientIds: baseRecipients,
          type: 'task_updated',
          title: 'Task Updated',
          message: `${currentUser.name} updated "${after.title}" in ${project?.title || 'the project'}.`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          linkRoute: 'tasks',
          projectId: after.projectId,
          taskId
        });
      }

      const beforeAllComplete = Boolean(before.subtasks?.length) && before.subtasks.every((s) => s.completed);
      const afterAllComplete = Boolean(after.subtasks?.length) && after.subtasks.every((s) => s.completed);
      if (!beforeAllComplete && afterAllComplete) {
        dispatchNotifications({
          recipientIds: baseRecipients,
          type: 'checklist_completed',
          title: 'Checklist Completed',
          message: `${currentUser.name} completed the checklist on "${after.title}" in ${project?.title || 'the project'}.`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          linkRoute: 'tasks',
          projectId: after.projectId,
          taskId
        });
      }

      confirmActionSuccess('Task Updated', `Your changes to "${after.title}" were saved successfully.`);
    }

    return result;
  };

  const deleteTask = (taskId: string): TaskMutationResult => {
    const task = tasks.find((item) => item.id === taskId);
    const result = prepareTaskDeletion(taskId, {
      currentRole,
      currentUserId: currentUser.id,
      projects,
      tasks,
      users
    });
    if (!result.success || !result.task) return result;
    setTasks((prev) => prev.filter((item) => item.id !== taskId));
    pushActivity('Deleted task', 'Task', taskId, result.task.title);

    if (task) {
      const project = projects.find((p) => p.id === task.projectId);
      dispatchNotifications({
        recipientIds: resolveTaskRecipients({ task, project, excludeUserId: currentUser.id }),
        type: 'task_deleted',
        title: 'Task Deleted',
        message: `${currentUser.name} deleted "${task.title}" from ${project?.title || 'the project'}.`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'tasks',
        projectId: task.projectId,
        taskId
      });
    }

    if (task) confirmActionSuccess('Task Deleted', `"${task.title}" was deleted successfully.`);
    return result;
  };

  // Update Task Status (Kanban & Details) with mandatory reason/summary handlers.
  // The Project Board module always supplies `extraInfo.note` (validated as non-empty by
  // its own status-change modal); `reviewDecision` is set only when a Team Lead/Admin is
  // resolving a task that's Pending review approval.
  const updateTaskStatus = (
    taskId: string,
    newStatus: TaskStatus,
    extraInfo?: {
      workSummary?: string;
      completionSummary?: string;
      blockerReason?: string;
      reopenReason?: string;
      note?: string;
      reviewDecision?: 'Approve' | 'Reject';
    }
  ): { success: boolean; message: string } => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return { success: false, message: 'Task not found.' };

    const note = extraInfo?.note?.trim();
    const historyEntry: TaskStatusHistoryEntry | null = note
      ? {
          id: `tsh-${Date.now()}`,
          fromStatus: task.status,
          toStatus: newStatus,
          note,
          changedBy: currentUser.id,
          changedByName: currentUser.name,
          timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16)
        }
      : null;

    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== taskId) return t;
        return {
          ...t,
          status: newStatus,
          workSummary: extraInfo?.workSummary ?? t.workSummary,
          completionSummary: extraInfo?.completionSummary ?? t.completionSummary,
          blockerReason: extraInfo?.blockerReason ?? t.blockerReason,
          reopenReason: extraInfo?.reopenReason ?? t.reopenReason,
          // Entering Review always opens a pending approval decision; leaving Review by any
          // path (drag, dropdown, or an Approve/Reject decision) resolves/clears it.
          reviewApproval: newStatus === 'Review' ? 'Pending' : undefined,
          statusHistory: historyEntry ? [...(t.statusHistory || []), historyEntry] : t.statusHistory
        };
      })
    );

    const activityAction =
      extraInfo?.reviewDecision === 'Approve'
        ? 'Approved task review'
        : extraInfo?.reviewDecision === 'Reject'
        ? 'Rejected task review'
        : `Moved task to ${newStatus}`;

    pushActivity(activityAction, 'Task', taskId, task.title, {
      field: 'status',
      oldVal: task.status,
      newVal: newStatus
    });

    const project = projects.find((p) => p.id === task.projectId);
    const baseRecipients = resolveTaskRecipients({ task, project, excludeUserId: currentUser.id });

    if (extraInfo?.reviewDecision === 'Approve') {
      dispatchNotifications({
        recipientIds: baseRecipients,
        type: 'task_review_approved',
        title: 'Task Approved',
        message: `${currentUser.name} approved "${task.title}" — moved from Review to Done in ${project?.title || 'the project'}.`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'kanban',
        projectId: task.projectId,
        taskId
      });
      confirmActionSuccess('Task Approved', `You approved "${task.title}" successfully. It has been moved to Done.`);
    } else if (extraInfo?.reviewDecision === 'Reject') {
      dispatchNotifications({
        recipientIds: baseRecipients,
        type: 'task_review_rejected',
        title: 'Task Returned for Revision',
        message: `${currentUser.name} rejected "${task.title}" — moved from Review back to In Progress in ${project?.title || 'the project'}.`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'kanban',
        projectId: task.projectId,
        taskId
      });
      confirmActionSuccess('Task Rejected', `You rejected "${task.title}" successfully. It has been returned to In Progress.`);
    } else if (newStatus === 'Review') {
      dispatchNotifications({
        recipientIds: resolveSingleRecipient(project?.teamLeadId, currentUser.id),
        type: 'task_review_requested',
        title: 'Review Requested',
        message: `${currentUser.name} moved "${task.title}" from ${task.status} to Review in ${project?.title || 'the project'}.`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'kanban',
        projectId: task.projectId,
        taskId
      });
      confirmActionSuccess('Review Requested', `You moved "${task.title}" to Review successfully.`);
    } else if (newStatus === 'Done') {
      dispatchNotifications({
        recipientIds: baseRecipients,
        type: 'task_completed',
        title: 'Task Completed',
        message: `${currentUser.name} marked "${task.title}" as Done in ${project?.title || 'the project'} (was ${task.status}).`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'kanban',
        projectId: task.projectId,
        taskId
      });
      confirmActionSuccess('Task Completed', `You marked "${task.title}" as Done successfully.`);
    } else {
      dispatchNotifications({
        recipientIds: baseRecipients,
        type: 'task_status_changed',
        title: 'Task Status Changed',
        message: `${currentUser.name} moved "${task.title}" from ${task.status} to ${newStatus} in ${project?.title || 'the project'}.`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'kanban',
        projectId: task.projectId,
        taskId
      });
      confirmActionSuccess('Status Updated', `You moved "${task.title}" to ${newStatus} successfully.`);
    }

    return { success: true, message: `"${task.title}" moved to ${newStatus}.` };
  };

  // Controlled Field Edits (Team Member submits -> TL/Admin approves)
  const proposeControlledEdit = (
    taskId: string,
    field: 'dueDate' | 'priority' | 'description' | 'assignee' | 'status',
    newValue: string,
    reason: string
  ) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const editReq: ControlledEditRequest = {
      id: `ed-${Date.now()}`,
      taskId,
      requestedBy: currentUser.id,
      field,
      oldValue: (task as any)[field] || '',
      newValue,
      reason,
      status: 'Pending',
      createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16)
    };

    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, pendingEdit: editReq } : t))
    );

    const approval: SystemApproval = {
      id: `app-${Date.now()}`,
      type: 'Controlled_Edit',
      targetId: taskId,
      targetTitle: task.title,
      requestedBy: currentUser.id,
      requestedRole: currentRole,
      createdAt: editReq.createdAt,
      details: `Proposed edit on ${field}: "${(task as any)[field]}" → "${newValue}". Reason: ${reason}`,
      status: 'Pending',
      proposedDiff: {
        field,
        oldValue: (task as any)[field] || '',
        newValue
      }
    };

    setSystemApprovals((prev) => [approval, ...prev]);

    const project = projects.find((p) => p.id === task.projectId);
    dispatchNotifications({
      recipientIds: [
        ...resolveAdminRecipients(users, currentUser.id),
        ...resolveSingleRecipient(project?.teamLeadId, currentUser.id)
      ],
      type: 'approval',
      title: 'Controlled Edit Requested',
      message: `${currentUser.name} requested to change ${field} on "${task.title}" (${project?.title || 'the project'}) from "${(task as any)[field] || '—'}" to "${newValue}".`,
      actorId: currentUser.id,
      actorName: currentUser.name,
      linkRoute: 'approvals',
      projectId: task.projectId,
      taskId
    });

    confirmActionSuccess('Request Submitted', `Your ${field} change request for "${task.title}" was submitted successfully.`);
    pushActivity(`Proposed controlled edit on ${field}`, 'Task', taskId, task.title);
  };

  const approveApprovalItem = (approvalId: string) => {
    const item = systemApprovals.find((sa) => sa.id === approvalId);
    if (!item) return;

    if (item.type === 'Project_Creation') {
      approveProject(item.targetId);
    } else if (item.type === 'Controlled_Edit' && item.proposedDiff) {
      const { field, newValue } = item.proposedDiff;
      setTasks((prev) =>
        prev.map((t) => {
          if (t.id === item.targetId) {
            return {
              ...t,
              [field]: newValue,
              pendingEdit: undefined
            };
          }
          return t;
        })
      );
      setSystemApprovals((prev) =>
        prev.map((sa) => (sa.id === approvalId ? { ...sa, status: 'Approved' } : sa))
      );
      const relatedTask = tasks.find((t) => t.id === item.targetId);
      const relatedProject = relatedTask ? projects.find((p) => p.id === relatedTask.projectId) : undefined;
      dispatchNotifications({
        recipientIds: resolveSingleRecipient(item.requestedBy, currentUser.id),
        type: 'approval',
        title: 'Request Approved',
        message: `${currentUser.name} approved your ${field} change on "${item.targetTitle}"${relatedProject ? ` in ${relatedProject.title}` : ''}.`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'tasks',
        taskId: item.targetId,
        projectId: relatedProject?.id
      });
      confirmActionSuccess('Request Approved', `You approved the ${field} change on "${item.targetTitle}" successfully.`);
    }
    pushActivity('Approved request', 'Approval', approvalId, item.targetTitle);
  };

  const rejectApprovalItem = (approvalId: string) => {
    const item = systemApprovals.find((sa) => sa.id === approvalId);

    setSystemApprovals((prev) =>
      prev.map((sa) => (sa.id === approvalId ? { ...sa, status: 'Rejected' } : sa))
    );

    if (item) {
      const relatedProjectId =
        item.type === 'Project_Creation' ? item.targetId : tasks.find((t) => t.id === item.targetId)?.projectId;
      const relatedProject = relatedProjectId ? projects.find((p) => p.id === relatedProjectId) : undefined;
      dispatchNotifications({
        recipientIds: resolveSingleRecipient(item.requestedBy, currentUser.id),
        type: 'approval',
        title: 'Request Rejected',
        message: `${currentUser.name} rejected your request for "${item.targetTitle}"${relatedProject ? ` in ${relatedProject.title}` : ''}.`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: item.type === 'Project_Creation' ? 'projects' : 'tasks',
        taskId: item.type === 'Project_Creation' ? undefined : item.targetId,
        projectId: item.type === 'Project_Creation' ? item.targetId : undefined
      });
      confirmActionSuccess('Request Rejected', `You rejected the request for "${item.targetTitle}" successfully.`);
    }
  };

  // Attendance & Breaks
  const checkIn = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

    setAttendanceRecords((prev) => {
      const existing = prev.find((a) => a.userId === currentUser.id && a.date === todayStr);
      if (existing) return prev; // block duplicate checkin
      const newRec: AttendanceRecord = {
        id: `att-${Date.now()}`,
        userId: currentUser.id,
        date: todayStr,
        checkIn: nowTime,
        status: 'Present',
        totalHours: 0,
        breaks: []
      };
      return [newRec, ...prev];
    });

    pushActivity('Checked in for work', 'Attendance', currentUser.id, currentUser.name);
  };

  const checkOut = () => {
    const todayStr = new Date().toISOString().split('T')[0];
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

    setAttendanceRecords((prev) =>
      prev.map((a) => {
        if (a.userId === currentUser.id && a.date === todayStr) {
          return {
            ...a,
            checkOut: nowTime,
            totalHours: 8.0
          };
        }
        return a;
      })
    );

    if (activeBreak?.isBreaking) {
      endBreak();
    }

    pushActivity('Checked out from work', 'Attendance', currentUser.id, currentUser.name);
  };

  const startBreak = (breakType: BreakType) => {
    const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    setActiveBreak({
      isBreaking: true,
      breakType,
      startTime: nowTime,
      elapsedSeconds: 0
    });
    pushActivity(`Started ${breakType}`, 'Attendance', currentUser.id, currentUser.name);
  };

  const endBreak = () => {
    if (!activeBreak) return;
    const todayStr = new Date().toISOString().split('T')[0];
    const endTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const durationMin = Math.max(1, Math.round(activeBreak.elapsedSeconds / 60));

    const newBreak: WorkBreak = {
      id: `brk-${Date.now()}`,
      type: activeBreak.breakType,
      startTime: activeBreak.startTime,
      endTime: endTimeStr,
      durationMinutes: durationMin
    };

    setAttendanceRecords((prev) =>
      prev.map((a) => {
        if (a.userId === currentUser.id && a.date === todayStr) {
          return {
            ...a,
            breaks: [...a.breaks, newBreak]
          };
        }
        return a;
      })
    );

    setActiveBreak(null);
    pushActivity(`Ended break (${durationMin} mins)`, 'Attendance', currentUser.id, currentUser.name);
  };

  // HR Requests
  const submitHRRequest = (type: HRRequest['type'], reason: string, details: HRRequest['details']) => {
    const newReq: HRRequest = {
      id: `hrq-${Date.now()}`,
      userId: currentUser.id,
      type,
      date: new Date().toISOString().split('T')[0],
      reason,
      status: 'Pending',
      details,
      submittedAt: new Date().toISOString().replace('T', ' ').substring(0, 16)
    };

    setHrRequests((prev) => [newReq, ...prev]);

    // Notify HR
    const notif: NotificationItem = {
      id: `notif-${Date.now()}`,
      userId: 'usr-3', // Marcus Vance (HR)
      title: `New ${type.replace('_', ' ')} Request`,
      message: `${currentUser.name} submitted a ${type.toLowerCase().replace('_', ' ')} request.`,
      type: 'attendance',
      read: false,
      timestamp: 'Just now',
      linkRoute: 'attendance'
    };
    setNotifications((prev) => [notif, ...prev]);

    pushActivity(`Submitted HR ${type} request`, 'Attendance', newReq.id, currentUser.name);
  };

  const approveHRRequest = (requestId: string, decisionReason?: string) => {
    setHrRequests((prev) =>
      prev.map((r) =>
        r.id === requestId
          ? { ...r, status: 'Approved', decidedBy: currentUser.id, decisionReason }
          : r
      )
    );
    pushActivity('Approved HR request', 'Attendance', requestId, 'HR Approval');
  };

  const rejectHRRequest = (requestId: string, decisionReason?: string) => {
    setHrRequests((prev) =>
      prev.map((r) =>
        r.id === requestId
          ? { ...r, status: 'Rejected', decidedBy: currentUser.id, decisionReason }
          : r
      )
    );
    pushActivity('Rejected HR request', 'Attendance', requestId, 'HR Rejection');
  };

  // Chat
  const sendChatMessage = (projectId: string, message: string) => {
    const mentionedUsers = users.filter(
      (user) => user.id !== currentUser.id && message.includes(`@${user.name}`)
    );

    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      projectId,
      senderId: currentUser.id,
      message,
      timestamp: 'Just now',
      isPinned: false,
      mentions: mentionedUsers.map((user) => user.id)
    };
    setChatMessages((prev) => [...prev, newMsg]);
    pushActivity('Posted project chat message', 'Project', projectId, 'Project Chat');

    const chatProject = projects.find((p) => p.id === projectId);
    mentionedUsers.forEach((user) => {
      dispatchNotifications({
        recipientIds: resolveSingleRecipient(user.id, currentUser.id),
        type: 'mention',
        title: 'You were mentioned',
        message: `${currentUser.name} mentioned you in ${chatProject?.title || 'project'} chat: "${message.slice(0, 80)}"`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'chat',
        projectId
      });
    });
  };

  const togglePinMessage = (projectId: string, messageId: string) => {
    setChatMessages((prev) => {
      const currentPinnedCount = prev.filter((m) => m.projectId === projectId && m.isPinned).length;
      return prev.map((m) => {
        if (m.id === messageId) {
          if (!m.isPinned && currentPinnedCount >= settings.maxChatPins) {
            alert(`Maximum pinned messages cap (${settings.maxChatPins}) reached for this project.`);
            return m;
          }
          return { ...m, isPinned: !m.isPinned };
        }
        return m;
      });
    });
  };

  // AI Logs
  const addAIQueryLog = (queryText: string, scopeTouched: string, responseSummary: string) => {
    const newLog: AIQueryLog = {
      id: `qlog-${Date.now()}`,
      userId: currentUser.id,
      userName: currentUser.name,
      userRole: currentRole,
      queryText,
      scopeTouched,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 16),
      responseSummary
    };
    setAiLogs((prev) => [newLog, ...prev]);
  };

  const updateWeeklySummaryDraft = (data: Partial<WeeklySummaryDraft>) => {
    setWeeklySummaryDraft((prev) => ({ ...prev, ...data }));
  };

  const markNotificationRead = (id: string) => {
    setNotifications((prev) => markAsRead(prev, id));
  };

  const markAllNotificationsRead = () => {
    setNotifications((prev) => markAllAsReadInList(prev, currentUser.id));
  };

  const clearNotification = (id: string) => {
    setNotifications((prev) => removeNotificationFromList(prev, id, currentUser.id));
  };

  const updateNotificationPreferences = (data: Partial<NotificationPreferences>) => {
    setNotificationPreferences((prev) => ({ ...prev, ...data }));
  };

  // Deactivate Admin Safeguard Check
  const deactivateUser = (userId: string) => {
    const targetUser = users.find((u) => u.id === userId);
    if (!targetUser) return { success: false, message: 'User not found.' };

    if (targetUser.role === 'Admin') {
      const activeAdminsCount = users.filter((u) => u.role === 'Admin' && u.status === 'active').length;
      if (activeAdminsCount <= 1) {
        return {
          success: false,
          message: 'Action Blocked: Cannot deactivate the sole active Admin account in the system.'
        };
      }
    }

    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, status: 'inactive' } : u))
    );

    dispatchNotifications({
      recipientIds: [
        ...resolveAdminRecipients(users, currentUser.id),
        ...resolveSingleRecipient(userId, currentUser.id)
      ],
      type: 'user_deactivated',
      title: 'User Deactivated',
      message: `${currentUser.name} deactivated ${targetUser.name}'s account.`,
      recipientMessages: { [userId]: `${currentUser.name} deactivated your account.` },
      actorId: currentUser.id,
      actorName: currentUser.name,
      linkRoute: 'settings'
    });

    pushActivity(`Deactivated user ${targetUser.name}`, 'Settings', userId, targetUser.name);
    return { success: true, message: `User ${targetUser.name} has been deactivated.` };
  };

  const exportBackup = () => {
    const backupData = {
      exportedAt: new Date().toISOString(),
      users,
      projects,
      tasks,
      attendanceRecords,
      hrRequests,
      systemApprovals,
      chatMessages,
      aiLogs
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `office-management-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    // Includes the acting Admin (no excludeUserId) — a self-notification here doubles as an
    // in-app confirmation that the export actually completed.
    dispatchNotifications({
      recipientIds: resolveAdminRecipients(users),
      type: 'backup_completed',
      title: 'Backup Completed',
      message: `${currentUser.name} exported a full system backup.`,
      actorId: currentUser.id,
      actorName: currentUser.name,
      linkRoute: 'settings'
    });

    pushActivity('Exported system data backup', 'Settings', 'backup', 'JSON Vault Backup');
  };

  return (
    <AppContext.Provider
      value={{
        currentRole,
        currentUser,
        users,
        theme,
        projects,
        tasks,
        attendanceRecords,
        hrRequests,
        systemApprovals,
        chatMessages,
        aiLogs,
        aiAudits,
        notifications,
        toasts,
        notificationPreferences,
        activityLogs,
        calendarEvents,
        savedPrompts,
        weeklySummaryDraft,
        activeBreak,
        settings,
        setRole,
        refreshUsers,
        onUserRegistered,
        loginUser,
        toggleTheme,
        createProject,
        approveProject,
        rejectProject,
        updateProject,
        deleteProject,
        createTask,
        updateTask,
        deleteTask,
        updateTaskStatus,
        proposeControlledEdit,
        approveApprovalItem,
        rejectApprovalItem,
        checkIn,
        checkOut,
        startBreak,
        endBreak,
        submitHRRequest,
        approveHRRequest,
        rejectHRRequest,
        sendChatMessage,
        togglePinMessage,
        addAIQueryLog,
        updateWeeklySummaryDraft,
        markNotificationRead,
        markAllNotificationsRead,
        clearNotification,
        updateNotificationPreferences,
        dismissToast,
        deactivateUser,
        exportBackup
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
