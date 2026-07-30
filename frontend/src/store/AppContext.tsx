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
  ApprovedLeaveEntry,
  SavedPrompt,

  BreakType,
  WorkBreak,
  ControlledEditRequest,
  TaskStatusHistoryEntry
} from '../types';

import {
  TaskMutationData,
  TaskMutationResult
} from '../features/tasks/taskRules';
import {
  prepareTaskCreation,
  prepareTaskDeletion,
  prepareTaskUpdate,
  toTaskFormInput
} from '../features/tasks/taskMutations';
import {
  approveTaskViaApi,
  changeTaskStatusViaApi,
  createTaskViaApi,
  createTaskEditApprovalViaApi,
  decideTaskEditApprovalViaApi,
  deleteTaskViaApi,
  loadTaskDetailFromApi,
  loadTaskEditApprovalsViaApi,
  loadTasksFromApi,
  rejectTaskViaApi,
  reopenTaskViaApi,
  updateTaskViaApi
} from '../features/tasks/taskRepository';
import {
  fetchProjects as fetchProjectsApi,
  fetchProject as fetchProjectApi,
  createProjectApi,
  updateProjectApi,
  archiveProjectApi,
  permanentlyDeleteProjectApi,
  restoreProjectApi,
  addProjectMemberApi,
  removeProjectMemberApi
} from '../features/projects/projectRepository';
import {
  fetchActivities,
} from '../features/activity/activityApi';
import {
  fetchApprovedLeave
} from '../features/calendar/calendarRepository';
import {
  ActivityItem,
  DEFAULT_ACTIVITY_FILTERS,
} from '../features/activity/activityTypes';
import {
  SendNotificationInput,
  markAsRead,
  markAllAsRead as markAllAsReadInList,
  clearNotification as removeNotificationFromList,
  snoozeNotification as snoozeNotificationInList,
  resolveAdminRecipients,
  resolveProjectRecipients,
  resolveSingleRecipient,
  resolveTaskRecipients
} from '../features/notifications/notificationService';
import { getNotificationTypeMeta } from '../features/notifications/notificationTypes';
import {
  publishNotificationEvent,
  fetchNotifications as fetchNotificationsApi,
  fetchNotificationPreferences,
  updateNotificationPreferencesApi,
  markNotificationReadApi,
  markAllNotificationsReadApi,
  clearNotificationApi,
  snoozeNotificationApi
} from '../features/notifications/notificationApiClient';
import { supabase, isSupabaseConfigured, subscribeToChannel } from '../../utils/supabase';

const ATTENDANCE_STORAGE_KEY = 'worksync-attendance-records';




const loadAttendanceRecords = (): AttendanceRecord[] => {
  try {
    const savedAttendance = localStorage.getItem(ATTENDANCE_STORAGE_KEY);
    if (!savedAttendance) return [];
    const parsedAttendance = JSON.parse(savedAttendance);
    return Array.isArray(parsedAttendance) ? parsedAttendance : [];
  } catch (error) {
    console.error('Failed to load attendance records from localStorage.', error);
    return [];
  }
};

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
  approvedLeave: ApprovedLeaveEntry[];
  savedPrompts: SavedPrompt[];

  activeBreak: {
    isBreaking: boolean;
    userId: string;
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
  refreshUsers: () => void;
  onUserRegistered: (user: User) => void;
  loginUser: (user: User) => void;
  logoutUser: () => void;
  toggleTheme: () => void;
  createProject: (data: Partial<Project>) => Promise<{ success: boolean; message: string }>;
  approveProject: (projectId: string) => Promise<{ success: boolean; message: string }>;
  rejectProject: (projectId: string, reason?: string) => Promise<{ success: boolean; message: string }>;
  updateProject: (projectId: string, data: Partial<Project>) => Promise<{ success: boolean; message: string }>;
  deleteProject: (projectId: string) => Promise<{ success: boolean; message: string }>;
  permanentlyDeleteProject: (projectId: string) => Promise<{ success: boolean; message: string }>;
  restoreProject: (projectId: string) => Promise<{ success: boolean; message: string }>;
  createTask: (data: TaskMutationData) => Promise<TaskMutationResult>;
  updateTask: (taskId: string, data: TaskMutationData) => Promise<TaskMutationResult>;
  deleteTask: (taskId: string) => Promise<TaskMutationResult>;
  updateTaskStatus: (
    taskId: string,
    newStatus: TaskStatus,
    extraInfo?: {
      // `note` is the mandatory reason shown in the board's status-change modal, persisted to
      // work.TaskStatusHistory server-side. `reviewDecision` routes the call to the dedicated
      // Approve/Reject endpoints instead of the generic status-change one (see task.service.ts
      // -- Review -> Done must always go through an explicit reviewer decision).
      note?: string;
      reviewDecision?: 'Approve' | 'Reject';
    }
  ) => Promise<{ success: boolean; message: string }>;
  // Team-Lead-only reopen of a Done task. `reason` is mandatory and is persisted to
  // work.TaskStatusHistory exactly like a normal status change's note.
  reopenTask: (
    taskId: string,
    newStatus: TaskStatus,
    reason: string
  ) => Promise<{ success: boolean; message: string }>;
  // Ticks/un-ticks a subtask from the board's task detail. `note` is the mandatory description
  // the board prompts for. Returns once the server has confirmed and the parent task (whose
  // status/progress may have cascaded) has been re-read.
  setSubtaskCompletion: (
    subtaskId: string,
    parentTaskId: string,
    completed: boolean,
    note: string
  ) => Promise<{ success: boolean; message: string }>;
  proposeControlledEdit: (taskId: string, field: 'dueDate' | 'priority' | 'description' | 'assignee' | 'status', newValue: string, reason: string) => void;
  approveApprovalItem: (approvalId: string) => Promise<{ success: boolean; message: string }>;
  rejectApprovalItem: (approvalId: string, reason?: string) => Promise<{ success: boolean; message: string }>;
  checkIn: () => void;
  checkOut: () => void;
  startBreak: (breakType: BreakType) => void;
  endBreak: () => void;
  updateAttendanceRecord: (
    recordId: string,
    updates: Pick<AttendanceRecord, 'checkIn' | 'checkOut' | 'breaks'>,
    reason?: string
  ) => Promise<{ success: boolean; message: string }>;
  submitHRRequest: (type: HRRequest['type'], reason: string, details: HRRequest['details'], requestDate?: string) => Promise<{ success: boolean; message: string }>;
  approveHRRequest: (requestId: string, decisionReason?: string) => Promise<{ success: boolean; message: string }>;
  rejectHRRequest: (requestId: string, decisionReason?: string) => Promise<{ success: boolean; message: string }>;
  sendChatMessage: (projectId: string, message: string) => void;
  togglePinMessage: (projectId: string, messageId: string) => void;
  addAIQueryLog: (query: string, scope: string, responseSummary: string) => void;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotification: (id: string) => void;
  snoozeNotification: (id: string, untilIso: string) => void;
  updateNotificationPreferences: (data: Partial<NotificationPreferences>) => void;
  dismissToast: (id: string) => void;
  showToast: (tone: ToastTone, title: string, message: string) => void;
  deactivateUser: (userId: string) => { success: boolean; message: string };
  exportBackup: () => void;
  updateCurrentUser: (updates: Partial<User>) => void;
  addTeamMember: (data: Omit<User, 'id'>) => void;
  updateTeamMember: (userId: string, data: Partial<User>) => void;
  deleteTeamMember: (userId: string, targetReassignUserId?: string) => { success: boolean; message: string };
  reassignMemberTasks: (sourceUserId: string, targetUserId: string) => { success: boolean; count: number };
  getMemberAssignedTasksCount: (userId: string) => number;
}

const AppContext = createContext<AppState | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User>({
    id: '', name: '', email: '', passwordHash: '', role: 'Team_Member', department: '', avatar: '', title: '', status: 'inactive', createdAt: ''
  });
  const currentRole: UserRole = currentUser.role;
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskReloadVersion, setTaskReloadVersion] = useState(0);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [hrRequests, setHrRequests] = useState<HRRequest[]>([]);
  const [systemApprovals, setSystemApprovals] = useState<SystemApproval[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [aiLogs, setAiLogs] = useState<AIQueryLog[]>([]);
  const [aiAudits, setAiAudits] = useState<AIUsageAudit[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>({
    toast: true,
    inApp: true,
    dueReminders: true,
    mentions: true,
    comments: true,
    assignments: true,
    email: true
  });
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([]);
  const [calendarEvents] = useState<CalendarEvent[]>([]);
  const [approvedLeave, setApprovedLeave] = useState<ApprovedLeaveEntry[]>([]);
  const [savedPrompts] = useState<SavedPrompt[]>([]);
  const recentTaskSubmission = useRef<{ signature: string; submittedAt: number } | null>(null);

  const [activeBreak, setActiveBreak] = useState<{
    isBreaking: boolean;
    userId: string;
    breakType: BreakType;
    startTime: string;
    elapsedSeconds: number;
  } | null>(null);


  useEffect(() => {
    try {
      localStorage.setItem(
        ATTENDANCE_STORAGE_KEY,
        JSON.stringify(attendanceRecords)
      );
    } catch (error) {
      console.error('Failed to save attendance records.', error);
    }
  }, [attendanceRecords]);


  


  useEffect(() => {
    if (!currentUser.id) return;

    let isActive = true;
    const token = localStorage.getItem('worksync_auth_token');
    if (!token) return;

    fetch('/api/hr-requests', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.success) {
          throw new Error(data.message || 'Failed to load HR requests.');
        }
        if (isActive && Array.isArray(data.requests)) {
          setHrRequests(data.requests as HRRequest[]);
        }
      })
     .catch((error) => {
  console.error('Failed to load HR requests from API.', error);
  if (isActive) {
    setHrRequests([]);
  }
});

    return () => {
      isActive = false;
    };
  }, [currentUser.id]);

  const [settings] = useState({
    workingHours: { start: '09:00', end: '18:00' },
    breakLimitMinutes: 60,
    maskedAiKey: 'sk-proj-••••••••••••••••38FA',
    maxChatPins: 10
  });

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
    const token = localStorage.getItem('worksync_auth_token');
    if (!token) return;

    fetch('/api/auth/users', {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(data?.message || 'Failed to load users.');
        }
        return data;
      })
      .then((data) => {
        if (data.success && Array.isArray(data.users) && data.users.length > 0) {
          setUsers(data.users as User[]);
        }
      })
      .catch((error) => {
        console.warn('User directory API unavailable; keeping current in-memory user list.', error);
        // Silently keep the authenticated user if the directory is unavailable.
      });
  };

  const onUserRegistered = (newUser: User) => {
    setUsers((prev) => {
      const exists = prev.some((u) => u.email.toLowerCase() === newUser.email.toLowerCase());
      if (exists) return prev;
      return [...prev, newUser];
    });
    setCurrentUser(newUser);
    setTaskReloadVersion((version) => version + 1);
    refreshUsers();
  };

  const loginUser = (user: User) => {
    setUsers((prev) => {
      const exists = prev.some((u) => u.email.toLowerCase() === user.email.toLowerCase());
      if (exists) {
        return prev.map((existingUser) =>
          existingUser.email.toLowerCase() === user.email.toLowerCase()
            ? user
            : existingUser
        );
      }
      return [...prev, user];
    });
    setCurrentUser(user);
    setTaskReloadVersion((version) => version + 1);
    // Privileged roles need the roster immediately for management/assignment flows; the
    // currentUser.id effect below still refreshes for every authenticated session.
    if (['Admin', 'Team_Lead', 'HR'].includes(user.role)) {
      refreshUsers();
    }
  };
  const logoutUser = () => {
  localStorage.removeItem('worksync_auth_token');
  setHrRequests([]);
  setCurrentUser({
    id: '',
    name: '',
    email: '',
    role: 'Team_Member',
    department: '',
    avatar: '',
    title: '',
    status: 'inactive'
  });
};

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
    if (!currentUser.id) return;
    refreshUsers();
  }, [currentUser.id]);

  useEffect(() => {
    let isActive = true;

    const hydrateTasks = async () => {
      try {
        const remoteTasks = await loadTasksFromApi();
        if (isActive && remoteTasks !== null) {
          setTasks(remoteTasks);
        }
      } catch (error) {
        console.warn(
          'Task API request failed; continuing with local task data.',
          error
        );
      }
    };

    const hydrateProjects = async () => {
      try {
        const remoteProjects = await fetchProjectsApi();
        if (isActive) {
          setProjects(
            remoteProjects.map((p) => ({
              ...p,
              milestones: p.milestones || [],
              files: p.files || [],
              pinnedMessagesCount: p.pinnedMessagesCount ?? 0
            }))
          );
        }
      } catch (error) {
        console.warn('Project API request failed; continuing with local project data.', error);
      }
    };

    // Calendar-only, read-only: approved HR leave requests for display alongside
    // Deadlines/Milestones/Task Due. Never mutates leave data; the HR approval flow that owns it
    // (backend/src/routes/hrRequestRoutes.ts) is untouched.
    const hydrateApprovedLeave = async () => {
      try {
        const remoteApprovedLeave = await fetchApprovedLeave();
        if (isActive) setApprovedLeave(remoteApprovedLeave);
      } catch (error) {
        console.warn('Approved leave API request failed; Calendar will show no leave entries.', error);
      }
    };

    const hydrateAttendance = async () => {
      try {
        const token = localStorage.getItem('worksync_auth_token');
        if (!token || !isActive) return;
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 90);
        const to = futureDate.toISOString().split('T')[0];
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - 90);
        const from = fromDate.toISOString().split('T')[0];
        const response = await fetch(`/api/attendance?from=${from}&to=${to}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await response.json();
        if (!response.ok || !data.success || !Array.isArray(data.data)) {
          throw new Error(data.message || 'Failed to load attendance.');
        }
        if (isActive) {
          const mapped: AttendanceRecord[] = data.data.map((r: any) => ({
            id: `att-${r.userId}-${r.date}`,
            userId: r.userId,
            date: r.date,
            checkIn: r.checkIn
              ? new Date(r.checkIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : '',
            checkOut: r.checkOut
              ? new Date(r.checkOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              : undefined,
            totalHours: r.totalHours || 0,
            status: (r.status === 'Leave' ? 'On Leave' : r.status || 'Present') as AttendanceRecord['status'],
            breaks: Array.isArray(r.breaks) ? r.breaks : [],
          }));
          setAttendanceRecords(mapped);
        }
      } catch (error) {
        console.warn('Attendance API request failed; falling back to local data.', error);
        if (isActive) {
          const local = loadAttendanceRecords();
          if (local.length > 0) setAttendanceRecords(local);
        }
      }
    };

    const hydrateActivityLogs = async () => {
      try {
        const result = await fetchActivities(DEFAULT_ACTIVITY_FILTERS, 1, 50);
        if (isActive && Array.isArray(result.items)) {
          const mapped: ActivityLogItem[] = (result.items as ActivityItem[]).map((item) => ({
            id: item.id,
            userId: item.actor.id || '',
            userName: item.actor.name,
            userAvatar: item.actor.avatar || '',
            action: `${item.action} ${item.entityType}`,
            targetType: (item.entityType === 'Task' ? 'Task' : item.entityType === 'Project' ? 'Project' : item.entityType === 'Attendance' ? 'Attendance' : 'Approval') as ActivityLogItem['targetType'],
            targetId: item.entityId,
            targetTitle: item.entityName || item.description,
            timestamp: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            diff: item.changes.length > 0 ? { field: item.changes[0].field, oldVal: item.changes[0].previousValue || '', newVal: item.changes[0].newValue || '' } : undefined,
          }));
          setActivityLogs(mapped);
        }
      } catch (error) {
        console.warn('Activity API request failed.', error);
      }
    };

    void hydrateTasks();
    void hydrateProjects();
    void hydrateApprovedLeave();
    void hydrateAttendance();
    void hydrateActivityLogs();

    return () => {
      isActive = false;
    };
  }, [currentUser.id, taskReloadVersion]);

  // Derive systemApprovals from loaded backend data (projects + tasks)
  const approvalsHydratedRef = useRef(false);
  useEffect(() => {
    if (approvalsHydratedRef.current) return;
    if (projects.length === 0 && tasks.length === 0) return;
    approvalsHydratedRef.current = true;

    const derived: SystemApproval[] = [];

    for (const p of projects) {
      if (p.approvalStatus === 'Pending Approval') {
        derived.push({
          id: `sys-approval-prj-${p.id}`,
          type: 'Project_Creation',
          targetId: p.id,
          targetTitle: p.title,
          requestedBy: p.teamLeadId || '',
          requestedRole: 'Team_Lead',
          createdAt: p.createdAt || new Date().toISOString(),
          details: `Team Lead proposed new project "${p.title}". Pending Admin approval.`,
          status: 'Pending',
          projectId: p.id,
        });
      }
    }

    for (const t of tasks) {
      if (t.pendingEdit && t.pendingEdit.status === 'Pending') {
        derived.push({
          id: `sys-approval-edit-${t.pendingEdit.id}`,
          type: 'Controlled_Edit',
          targetId: t.id,
          targetTitle: t.title,
          requestedBy: t.pendingEdit.requestedBy,
          requestedRole: 'Team_Member',
          createdAt: t.pendingEdit.createdAt,
          details: `Requested ${t.pendingEdit.field} change on "${t.title}"`,
          status: 'Pending',
          projectId: t.projectId,
          proposedDiff: {
            field: t.pendingEdit.field,
            oldValue: t.pendingEdit.oldValue,
            newValue: t.pendingEdit.newValue,
          },
        });
      }
    }

    if (derived.length > 0) {
      setSystemApprovals((prev) => {
        const existingIds = new Set(prev.map((a) => a.id));
        const newItems = derived.filter((d) => !existingIds.has(d.id));
        return newItems.length > 0 ? [...prev, ...newItems] : prev;
      });
    }
  }, [projects, tasks]);

  useEffect(() => {
    if (!currentUser.id || currentRole !== 'Team_Lead' || projects.length === 0 || tasks.length === 0) return;
    let isActive = true;

    void loadTaskEditApprovalsViaApi()
      .then((persistedApprovals) => {
        if (!isActive) return;
        const validApprovals = persistedApprovals.filter((approval) => {
          const project = projects.find((candidate) => candidate.id === approval.projectId);
          if (!project || project.teamLeadId !== currentUser.id) return false;
          return tasks.some((task) =>
            task.id === approval.targetId ||
            task.subtasks.some((subtask) => subtask.id === approval.targetId)
          );
        });
        setSystemApprovals((prev) => {
          const persistedIds = new Set(validApprovals.map((approval) => approval.id));
          return [
            ...validApprovals,
            ...prev.filter((approval) =>
              !persistedIds.has(approval.id) &&
              !(approval.type === 'Controlled_Edit' &&
                approval.proposedTaskUpdate &&
                approval.status === 'Pending')
            )
          ];
        });
        if (validApprovals.length === 0) return;
        setTasks((prev) => prev.map((task) => {
          const directApproval = validApprovals.find((approval) => approval.targetId === task.id);
          if (directApproval) {
            return {
              ...task,
              approvalStatus: 'Pending Approval',
              pendingEdit: {
                id: directApproval.id,
                taskId: task.id,
                requestedBy: directApproval.requestedBy,
                field: 'description',
                oldValue: 'Current task details',
                newValue: 'Proposed task details',
                reason: 'Task update requested by the assignee.',
                status: 'Pending',
                createdAt: directApproval.createdAt
              }
            };
          }
          return {
            ...task,
            subtasks: task.subtasks.map((subtask) => {
              const approval = validApprovals.find((candidate) => candidate.targetId === subtask.id);
              return approval
                ? {
                    ...subtask,
                    approvalStatus: 'Pending Approval',
                    pendingEdit: {
                      id: approval.id,
                      taskId: subtask.id,
                      requestedBy: approval.requestedBy,
                      field: 'description',
                      oldValue: 'Current task details',
                      newValue: 'Proposed task details',
                      reason: 'Task update requested by the assignee.',
                      status: 'Pending',
                      createdAt: approval.createdAt
                    }
                  }
                : subtask;
            })
          };
        }));
      })
      .catch((error) => console.warn('Failed to load persisted task edit approvals.', error));

    return () => {
      isActive = false;
    };
  }, [currentUser.id, currentRole, projects, tasks.length]);

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
  const getAuthHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('worksync_auth_token');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  };

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

    fetch('/api/activity-log', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ action, targetType, targetId, targetTitle, diff }),
    }).catch(() => {});
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

  // Fetches this session's persisted notifications + preferences from the backend
  // (backend/src/notifications) on mount and whenever the authenticated identity changes.
  // Both calls fail silently (console.warn only) whenever there's no backend/DATABASE_URL
  // reachable — e.g. running the Vite dev server alone, or no real login has happened yet.
  useEffect(() => {
    let isActive = true;

    fetchNotificationsApi({ pageSize: 200 })
      .then(({ items }) => {
        if (isActive) setNotifications(items);
      })
      .catch((error) => {
        console.warn('Notification API unavailable; using local notification data.', error);
      });

    fetchNotificationPreferences()
      .then((prefs) => {
        if (isActive) setNotificationPreferences(prefs);
      })
      .catch((error) => {
        console.warn('Notification preferences API unavailable; using local defaults.', error);
      });

    return () => {
      isActive = false;
    };
  }, [currentUser.id]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;

    const channel = subscribeToChannel(
      'worksync-notifications',
      (payload) => {
        if (payload?.notification) {
          const notif = payload.notification as NotificationItem;
          if (notif.userId === currentUser.id) {
            setNotifications((prev) => [notif, ...prev]);
            if (notificationPreferences.toast) {
              const meta = getNotificationTypeMeta(notif.type);
              pushToast(meta.tone, notif.title, notif.message);
            }
          }
        }
      }
    );

    return () => {
      if (channel) supabase?.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser.id, isSupabaseConfigured]);

  const applyCreatedNotifications = (created: NotificationItem[]) => {
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

  const dispatchNotifications = (input: SendNotificationInput) => {
    // Every notification must be persisted in Postgres via the real API (notificationApiClient's
    // publishNotificationEvent) — that's the only path the recipient's own session (a different
    // browser/tab) can ever actually see. A local-only fallback here would silently fabricate a
    // notification that only flashes in the *acting* user's own in-memory state and is never
    // delivered to the real recipients nor stored anywhere — worse than surfacing the failure.
    // So on failure we log loudly and tell the acting user it didn't go through, instead of
    // pretending it succeeded.
    publishNotificationEvent(input)
      .then(applyCreatedNotifications)
      .catch((error) => {
        console.error('Notification publish failed — event was NOT persisted or delivered.', input.type, error);
        pushToast(
          'error',
          'Notification Failed',
          `"${input.title}" could not be delivered. It was not saved — please check your connection and try again.`
        );
      });
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

  // Only Team Leads may propose new projects; every new project requires Admin approval.
  const eligibleProjectMemberIds = (ids: string[]): string[] =>
    ids.filter((id) => users.find((u) => u.id === id)?.role === 'Team_Member');

  // --- Project Module (backend/src/projects) -----------------------------------------
  // Real API, no local fallback: every mutation below either applies the server's authoritative
  // ProjectDTO to `projects` state, or leaves state untouched and returns success: false with a
  // real error message. project.service.ts publishes its own notification events server-side
  // (project_created/updated/archived/member_added/member_removed/approval), so none of these
  // functions call dispatchNotifications anymore -- doing so would double up every event.
  // `milestones`/`files`/`pinnedMessagesCount` have no backend representation yet (see
  // project.types.ts's ProjectDTO comment), so they are preserved/merged locally on top of
  // whatever the server returns.
  const createProject = async (data: Partial<Project>): Promise<{ success: boolean; message: string }> => {
    if (currentRole !== 'Team_Lead' && currentRole !== 'Admin') {
      return { success: false, message: 'You do not have permission to create a project.' };
    }

    try {
      const created = await createProjectApi({
        title: data.title || 'Untitled Project',
        description: data.description || '',
        priority: data.priority || 'Medium',
        startDate: data.startDate || new Date().toISOString().split('T')[0],
        targetDate: data.targetDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
        teamLeadId: data.teamLeadId,
        memberIds: eligibleProjectMemberIds(data.memberIds || []),
        creationReason: data.creationReason
      });

      setProjects((prev) => [
        { ...created, milestones: data.milestones || [], files: data.files || [], pinnedMessagesCount: 0 },
        ...prev
      ]);

      // Pending Approval projects still need a local SystemApproval record so the Approvals
      // Inbox can list them -- the backend has no SystemApprovals table of its own (out of this
      // branch's scope), it only publishes the "approval" notification event to Admins.
      if (created.status === 'Pending Approval') {
        const approval: SystemApproval = {
          id: `app-${Date.now()}`,
          type: 'Project_Creation',
          targetId: created.id,
          targetTitle: created.title,
          requestedBy: currentUser.id,
          requestedRole: currentRole,
          createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
          details: `Team Lead ${currentUser.name} proposed new project "${created.title}". Pending Admin approval.`,
          status: 'Pending'
        };
        setSystemApprovals((prev) => [approval, ...prev]);
      }

      pushActivity('Created project', 'Project', created.id, created.title);

      const message =
        created.status === 'Pending Approval'
          ? `"${created.title}" was submitted for Admin approval successfully.`
          : `"${created.title}" was created successfully.`;
      confirmActionSuccess(created.status === 'Pending Approval' ? 'Project Submitted' : 'Project Created', message);
      return { success: true, message };
    } catch (error: any) {
      console.error('Failed to create project.', error);
      return { success: false, message: error?.message || 'Failed to create the project. Please try again.' };
    }
  };

  const approveProject = async (projectId: string): Promise<{ success: boolean; message: string }> => {
    if (currentRole !== 'Admin') return { success: false, message: 'Only Admins can approve project proposals.' };

    const project = projects.find((p) => p.id === projectId);
    if (!project) return { success: false, message: 'Project not found.' };

    try {
      const updated = await updateProjectApi(projectId, { status: 'Active' });
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, ...updated } : p)));
      setSystemApprovals((prev) =>
        prev.map((sa) =>
          sa.targetId === projectId && sa.type === 'Project_Creation' ? { ...sa, status: 'Approved' } : sa
        )
      );
      pushActivity('Approved project proposal', 'Project', projectId, 'Project Approval');

      const message = `"${project.title}" was approved successfully.`;
      confirmActionSuccess('Project Approved', message);
      return { success: true, message };
    } catch (error: any) {
      console.error('Failed to approve project.', error);
      return { success: false, message: error?.message || 'Failed to approve the project. Please try again.' };
    }
  };

  // There is no dedicated "reject" endpoint on the backend (ApiProjectStatus has no Rejected
  // value) -- rejecting a pending proposal archives it, the same soft-delete every other Project
  // mutation uses, with the reason recorded on ArchiveReason for the audit trail.
  const rejectProject = async (
    projectId: string,
    reason?: string
  ): Promise<{ success: boolean; message: string }> => {
    if (currentRole !== 'Admin') return { success: false, message: 'Only Admins can reject project proposals.' };

    const project = projects.find((p) => p.id === projectId);
    if (!project) return { success: false, message: 'Project not found.' };

    try {
      await archiveProjectApi(projectId, reason?.trim() || `Project proposal rejected by ${currentUser.name}.`);
      setProjects((prev) =>
        prev.map((p) => (p.id === projectId ? { ...p, status: 'Archived', approvalStatus: 'Rejected' } : p))
      );
      setSystemApprovals((prev) =>
        prev.map((sa) =>
          sa.targetId === projectId && sa.type === 'Project_Creation' ? { ...sa, status: 'Rejected' } : sa
        )
      );
      pushActivity('Rejected project proposal', 'Project', projectId, 'Project Rejection');

      const message = `"${project.title}" was rejected successfully.`;
      confirmActionSuccess('Project Rejected', message);
      return { success: true, message };
    } catch (error: any) {
      console.error('Failed to reject project.', error);
      return { success: false, message: error?.message || 'Failed to reject the project. Please try again.' };
    }
  };

  const updateProject = async (
    projectId: string,
    data: Partial<Project>
  ): Promise<{ success: boolean; message: string }> => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return { success: false, message: 'Project not found.' };

    try {
      const updated = await updateProjectApi(projectId, {
        title: data.title,
        description: data.description,
        priority: data.priority,
        startDate: data.startDate,
        targetDate: data.targetDate,
        status: data.status,
        teamLeadId: data.teamLeadId,
        creationReason: data.creationReason
      });
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? { ...p, ...updated, milestones: data.milestones ?? p.milestones, files: data.files ?? p.files }
            : p
        )
      );
      pushActivity('Updated project', 'Project', projectId, updated.title);

      // Membership has no bulk field on PUT /api/projects/:id (see projectRepository.ts's
      // UpdateProjectPayload) -- it goes through the dedicated member endpoints instead, one
      // call per added/removed user, diffed against the project's current membership.
      if (data.memberIds) {
        const beforeIds = new Set(project.memberIds);
        const afterIds = eligibleProjectMemberIds(data.memberIds);
        const added = afterIds.filter((id) => !beforeIds.has(id));
        const removed = project.memberIds.filter((id) => !afterIds.includes(id));
        const memberErrors: string[] = [];

        for (const userId of added) {
          try {
            await addProjectMemberApi(projectId, userId, 'Member');
          } catch (error: any) {
            memberErrors.push(error?.message || `Failed to add member ${userId}.`);
          }
        }
        for (const userId of removed) {
          try {
            await removeProjectMemberApi(projectId, userId);
          } catch (error: any) {
            memberErrors.push(error?.message || `Failed to remove member ${userId}.`);
          }
        }

        if (added.length > 0 || removed.length > 0) {
          const refreshed = await fetchProjectApi(projectId);
          setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, ...refreshed } : p)));
        }

        if (memberErrors.length > 0) {
          const message = `Project details saved, but some membership changes failed: ${memberErrors.join(' ')}`;
          return { success: false, message };
        }
      }

      const message = `Your changes to "${updated.title}" were saved successfully.`;
      confirmActionSuccess('Project Updated', message);
      return { success: true, message };
    } catch (error: any) {
      console.error('Failed to update project.', error);
      return { success: false, message: error?.message || 'Failed to update the project. Please try again.' };
    }
  };

  const deleteProject = async (projectId: string): Promise<{ success: boolean; message: string }> => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return { success: false, message: 'Project not found.' };

    // Team Leads cannot delete immediately: their delete action files a Project Deletion
    // approval request instead (local-only, same as the Project Creation approval flow); the
    // actual archive only happens once an Admin approves it via approveProjectDeletion below.
    // This entire branch never calls the backend (there's no API for "request a deletion"), so
    // unlike every other Project mutation, the Admin notification here has no server-side
    // equivalent to rely on -- it must be dispatched from here, or Admins never learn a
    // deletion request exists at all.
    if (currentRole !== 'Admin') {
      const approval: SystemApproval = {
        id: `app-${Date.now()}`,
        type: 'Project_Deletion',
        targetId: projectId,
        targetTitle: project.title,
        requestedBy: currentUser.id,
        requestedRole: currentRole,
        createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
        details: `Team Lead ${currentUser.name} requested deletion of project "${project.title}". Pending Admin approval.`,
        status: 'Pending'
      };
      setSystemApprovals((prev) => [approval, ...prev]);
      dispatchNotifications({
        recipientIds: resolveAdminRecipients(users, currentUser.id),
        type: 'approval',
        title: 'Project Deletion Requested',
        message: `${currentUser.name} requested deletion of project "${project.title}".`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'approvals',
        projectId
      });
      pushActivity('Requested project deletion', 'Project', projectId, project.title);

      const message = `Your request to delete "${project.title}" was submitted for Admin approval.`;
      confirmActionSuccess('Deletion Requested', message);
      return { success: true, message };
    }

    try {
      await archiveProjectApi(projectId, `Deleted by ${currentUser.name}.`);
      // Soft delete only -- the backend never cascades this to work.Tasks, so tasks under an
      // archived project are intentionally left exactly as they are.
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, status: 'Archived' } : p)));
      pushActivity('Deleted project', 'Project', projectId, project.title);

      const message = `"${project.title}" was archived successfully.`;
      confirmActionSuccess('Project Deleted', message);
      return { success: true, message };
    } catch (error: any) {
      console.error('Failed to delete project.', error);
      return { success: false, message: error?.message || 'Failed to delete the project. Please try again.' };
    }
  };

  // Step two of the two-step delete: only usable on a project that's already Archived (the
  // permanent-delete confirmation in ProjectsView only ever calls this for such a project). Unlike
  // deleteProject/archiveProjectApi above, this removes the project from local state entirely --
  // there's no longer a row to reflect a status on.
  const permanentlyDeleteProject = async (projectId: string): Promise<{ success: boolean; message: string }> => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return { success: false, message: 'Project not found.' };

    try {
      await permanentlyDeleteProjectApi(projectId);
      setProjects((prev) => prev.filter((p) => p.id !== projectId));
      pushActivity('Permanently deleted project', 'Project', projectId, project.title);

      const message = `"${project.title}" was permanently deleted.`;
      confirmActionSuccess('Project Permanently Deleted', message);
      return { success: true, message };
    } catch (error: any) {
      console.error('Failed to permanently delete project.', error);
      return { success: false, message: error?.message || 'Failed to permanently delete the project. Please try again.' };
    }
  };

  // Restores an Archived project back to Active. Deliberately not routed through updateProject --
  // the backend clears ArchivedAtUtc/ArchivedByUserId/ArchiveReason together, which the generic
  // update path never touches (see project.service.ts's restoreProject comment). Members,
  // milestones, files, notes, team lead, and tasks are untouched server-side, so the local merge
  // here only needs to flip status, exactly like deleteProject's archive branch does the reverse.
  const restoreProject = async (projectId: string): Promise<{ success: boolean; message: string }> => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return { success: false, message: 'Project not found.' };

    try {
      await restoreProjectApi(projectId);
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, status: 'Active' } : p)));
      pushActivity('Restored project', 'Project', projectId, project.title);

      const message = `"${project.title}" was restored to Active.`;
      confirmActionSuccess('Project Restored', message);
      return { success: true, message };
    } catch (error: any) {
      console.error('Failed to restore project.', error);
      return { success: false, message: error?.message || 'Failed to restore the project. Please try again.' };
    }
  };

  // Admin decision on a Project Deletion request. Approving performs the actual archive;
  // rejecting is handled entirely by rejectApprovalItem, which never touches project state.
  const approveProjectDeletion = async (projectId: string): Promise<{ success: boolean; message: string }> => {
    if (currentRole !== 'Admin') return { success: false, message: 'Only Admins can approve a project deletion.' };

    const project = projects.find((p) => p.id === projectId);
    if (!project) return { success: false, message: 'Project not found.' };

    try {
      await archiveProjectApi(projectId, `Deletion approved by ${currentUser.name}.`);
      setProjects((prev) => prev.map((p) => (p.id === projectId ? { ...p, status: 'Archived' } : p)));
      setSystemApprovals((prev) =>
        prev.map((sa) =>
          sa.targetId === projectId && sa.type === 'Project_Deletion' ? { ...sa, status: 'Approved' } : sa
        )
      );
      pushActivity('Approved project deletion', 'Project', projectId, project.title);

      const message = `"${project.title}" was deleted successfully.`;
      confirmActionSuccess('Deletion Approved', message);
      return { success: true, message };
    } catch (error: any) {
      console.error('Failed to approve project deletion.', error);
      return { success: false, message: error?.message || 'Failed to approve the deletion. Please try again.' };
    }
  };

  const createTask = async (
    data: TaskMutationData
  ): Promise<TaskMutationResult> => {
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

    const validationResult = prepareTaskCreation(data, {
      currentRole,
      currentUserId: currentUser.id,
      projects,
      tasks,
      users
    }, now);
    if (!validationResult.success) return validationResult;

    // Team Members submit task creation requests to the selected project's Team Lead.
    // The task is only created in the backend after that Team Lead approves the request.
    if (currentRole === 'Team_Member') {
      const project = projects.find((item) => item.id === input.projectId);

      if (!project) {
        return { success: false, message: 'The selected project was not found.' };
      }

      if (!project.teamLeadId) {
        return { success: false, message: 'This project does not have a Team Lead.' };
      }

      const requestId = `app-${Date.now()}`;
      const approval: SystemApproval = {
        id: requestId,
        type: 'Task_Creation',
        targetId: `pending-task-${Date.now()}`,
        targetTitle: input.title,
        requestedBy: currentUser.id,
        requestedRole: currentRole,
        projectId: project.id,
        createdAt: new Date().toISOString().replace('T', ' ').substring(0, 16),
        details: `${currentUser.name} requested creation of task "${input.title}" in project "${project.title}".`,
        status: 'Pending',
        proposedTask: {
          projectId: input.projectId,
          title: input.title,
          description: input.description,
          priority: input.priority || 'Medium',
          startDate: input.startDate,
          dueDate: input.dueDate,
          assigneeIds: input.assigneeIds,
          status: input.status,
          parentTaskId: data.parentTaskId
        }
      };

      recentTaskSubmission.current = { signature, submittedAt: now };
      setSystemApprovals((prev) => [approval, ...prev]);

      dispatchNotifications({
        recipientIds: resolveSingleRecipient(project.teamLeadId, currentUser.id),
        type: 'approval',
        title: 'Task Creation Requested',
        message: `${currentUser.name} requested creation of "${input.title}" in ${project.title}.`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'approvals',
        projectId: project.id
      });

      pushActivity('Requested task creation', 'Approval', requestId, input.title);
      confirmActionSuccess(
        'Task Request Submitted',
        `"${input.title}" was sent to ${project.title}'s Team Lead for approval.`
      );

      return {
        success: true,
        message: 'Task creation request submitted for Team Lead approval.'
      };
    }

    const result = await createTaskViaApi(data);
    if (!result.success || !result.task) return result;

    recentTaskSubmission.current = { signature, submittedAt: now };
    setTasks((prev) => [result.task!, ...prev]);
    pushActivity('Created task', 'Task', result.task.id, result.task.title);

    // task.service.ts's createTask already publishes a 'task_assigned' notification event
    // server-side (see backend/src/tasks/task.service.ts) -- no dispatchNotifications call here
    // anymore, to avoid every assignee getting the same notification twice.
    confirmActionSuccess('Task Created', `"${result.task.title}" was created successfully.`);
    return result;
  };

  // Real API, no local fallback: prepareTaskUpdate/prepareTaskDeletion below still run first for
  // immediate client-side validation/permission feedback (same as createTask's
  // prepareTaskCreation), but `tasks` state only ever changes from the server's authoritative
  // response -- never from prepareTaskUpdate's locally-computed guess. task.service.ts publishes
  // its own 'task_updated'/'task_deleted' notification events, so neither function below
  // dispatches one itself (main's per-field notification differentiation -- reassigned/priority/
  // due-date/checklist -- had no backend equivalent to call through to, so it's not carried
  // forward here; see docs/ProjectBoardNotification_Implementation_Notes.md).
  const updateTask = async (taskId: string, data: TaskMutationData): Promise<TaskMutationResult> => {
    const validationResult = prepareTaskUpdate(taskId, data, {
      currentRole,
      currentUserId: currentUser.id,
      projects,
      tasks,
      users
    });
    if (!validationResult.success) return validationResult;

    const existingTask = tasks.find((task) => task.id === taskId) || validationResult.task;
    const project = existingTask && projects.find((item) => item.id === existingTask.projectId);
    const isMemberOwnedTask = Boolean(
      existingTask
      && (Boolean(existingTask.parentTaskId)
        || Math.max(existingTask.subtaskCount || 0, existingTask.subtasks?.length || 0) === 0)
      && currentRole === 'Team_Member'
    );

    // Team Members may prepare changes to their assigned standalone tasks and subtasks, but
    // the stored task remains unchanged until the owning Team Lead approves the request.
    if (isMemberOwnedTask && existingTask && project?.teamLeadId) {
      const proposedTaskUpdate = {
        title: data.title?.trim() || existingTask.title,
        description: data.description?.trim() || existingTask.description,
        priority: data.priority || existingTask.priority,
        startDate: data.startDate || validationResult.task?.startDate || existingTask.createdAt.slice(0, 10),
        dueDate: data.dueDate || existingTask.dueDate
      };
      const requestId = `edit-${Date.now()}`;
      const createdAt = new Date().toISOString().replace('T', ' ').substring(0, 16);
      const pendingEdit: ControlledEditRequest = {
        id: requestId,
        taskId,
        requestedBy: currentUser.id,
        field: 'description',
        oldValue: 'Current task details',
        newValue: 'Proposed task details',
        reason: 'Task update requested by the assignee.',
        status: 'Pending',
        createdAt
      };
      let approval: SystemApproval;
      try {
        approval = await createTaskEditApprovalViaApi(taskId, proposedTaskUpdate);
      } catch (error: any) {
        return { success: false, message: error?.message || 'Unable to submit the task update request.' };
      }

      const pendingTask = {
        ...existingTask,
        approvalStatus: 'Pending Approval' as const,
        pendingEdit
      };
      setTasks((prev) => prev.map((task) => {
        if (task.id === taskId) return pendingTask;
        if (!task.subtasks.some((subtask) => subtask.id === taskId)) return task;
        return {
          ...task,
          subtasks: task.subtasks.map((subtask) => subtask.id === taskId
            ? { ...subtask, approvalStatus: 'Pending Approval', pendingEdit }
            : subtask)
        };
      }));
      dispatchNotifications({
        recipientIds: resolveSingleRecipient(project.teamLeadId, currentUser.id),
        type: 'approval',
        title: 'Task Update Requested',
        message: `${currentUser.name} requested an update to "${existingTask.title}".`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'approvals',
        projectId: existingTask.projectId,
        taskId
      });
      pushActivity('Requested task update approval', 'Approval', approval.id, existingTask.title);
      confirmActionSuccess('Task Update Requested', `Your changes to "${existingTask.title}" were sent to the Team Lead for approval.`);
      return { success: true, message: 'Task update requested for Team Lead approval.', task: pendingTask };
    }

    try {
      const updated = await updateTaskViaApi(taskId, data);
      setTasks((prev) => prev.map((item) => (item.id === taskId ? updated : item)));
      pushActivity('Updated task', 'Task', taskId, updated.title);
      confirmActionSuccess('Task Updated', `Your changes to "${updated.title}" were saved successfully.`);
      return { success: true, message: 'Task updated successfully.', task: updated };
    } catch (error: any) {
      console.error('Failed to update task.', error);
      return { success: false, message: error?.message || 'Failed to update the task. Please try again.' };
    }
  };

  const deleteTask = async (taskId: string): Promise<TaskMutationResult> => {
    const validationResult = prepareTaskDeletion(taskId, {
      currentRole,
      currentUserId: currentUser.id,
      projects,
      tasks,
      users
    });
    if (!validationResult.success || !validationResult.task) return validationResult;

    const task = validationResult.task;
    try {
      await deleteTaskViaApi(taskId);
      setTasks((prev) => prev.filter((item) => item.id !== taskId));
      pushActivity('Deleted task', 'Task', taskId, task.title);
      confirmActionSuccess('Task Deleted', `"${task.title}" was deleted successfully.`);
      return { success: true, message: `"${task.title}" was deleted successfully.`, task };
    } catch (error: any) {
      console.error('Failed to delete task.', error);
      return { success: false, message: error?.message || 'Failed to delete the task. Please try again.' };
    }
  };

  // Update Task Status (Kanban & Details) with mandatory reason/summary handlers.
    // The Project Board module always supplies `extraInfo.note` (validated as non-empty by
    // its own status-change modal); `reviewDecision` is set only when a Team Lead/Admin is
    // resolving a task that's Pending review approval.
    // Real backend call — the Kanban board's one and only mutation path. No optimistic local
    // update: `tasks` state only changes once the server confirms the transition (writes
    // work.TaskStatusHistory + work.Tasks.TaskStatusId in one transaction and publishes the
    // notification event itself — see task.service.ts). A failed call leaves `tasks` untouched
    // and returns success: false so the board can show a real, retryable error instead of ever
    // pretending the move happened.
    const updateTaskStatus = async (
      taskId: string,
      newStatus: TaskStatus,
      extraInfo?: {
        note?: string;
        reviewDecision?: 'Approve' | 'Reject';
      }
    ): Promise<{ success: boolean; message: string }> => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return { success: false, message: 'Task not found.' };

      const note = extraInfo?.note?.trim() || '';

      try {
        const updated =
          extraInfo?.reviewDecision === 'Approve'
            ? await approveTaskViaApi(taskId, note)
            : extraInfo?.reviewDecision === 'Reject'
              ? await rejectTaskViaApi(taskId, note)
              : await changeTaskStatusViaApi(taskId, newStatus, note);

        setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));

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

        const successMessage =
          extraInfo?.reviewDecision === 'Approve'
            ? `You approved "${task.title}" successfully. It has been moved to Done.`
            : extraInfo?.reviewDecision === 'Reject'
              ? `You rejected "${task.title}" successfully. It has been returned to In Progress.`
              : newStatus === 'Review'
                ? `You moved "${task.title}" to Review successfully.`
                : `You moved "${task.title}" to ${newStatus} successfully.`;
        confirmActionSuccess('Status Updated', successMessage);

        return { success: true, message: `"${task.title}" moved to ${newStatus}.` };
      } catch (error: any) {
        console.error('Failed to update task status.', error);
        return { success: false, message: error?.message || 'Failed to update task status. Please try again.' };
      }
    };

    // Reopens a completed task. Kept separate from updateTaskStatus because the backend treats
    // it as a distinct, more strictly authorized operation (Team Lead only, mandatory reason,
    // its own endpoint and history entry) — see backend/src/tasks/task.service.ts's reopenTask.
    // Like every other board mutation, `tasks` is only updated from the server's response.
    const reopenTask = async (
      taskId: string,
      newStatus: TaskStatus,
      reason: string
    ): Promise<{ success: boolean; message: string }> => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return { success: false, message: 'Task not found.' };

      try {
        const updated = await reopenTaskViaApi(taskId, newStatus, reason.trim());
        setTasks((prev) => prev.map((t) => (t.id === taskId ? updated : t)));

        pushActivity('Reopened task', 'Task', taskId, task.title, {
          field: 'status',
          oldVal: 'Done',
          newVal: newStatus
        });
        confirmActionSuccess('Task Reopened', `"${task.title}" was reopened to ${newStatus}.`);

        return { success: true, message: `"${task.title}" reopened to ${newStatus}.` };
      } catch (error: any) {
        console.error('Failed to reopen task.', error);
        return { success: false, message: error?.message || 'Failed to reopen the task. Please try again.' };
      }
    };

    // Ticks / un-ticks a subtask from the Project Board's task detail. A subtask is just a Task
    // with a parent (Task Module model), so this reuses the *existing* status endpoint rather
    // than adding a subtask-specific one — the board consumes the Task Module's API, it does not
    // duplicate its logic. `note` is the mandatory description the board prompts for, persisted
    // to work.TaskStatusHistory exactly like any other status change's reason.
    //
    // The parent is then re-read from the server, never patched locally: completing a subtask
    // can cascade the parent to In Progress or Review server-side (see task.service.ts's
    // syncParentFromSubtasks), so only the server knows the resulting status and progress.
    const setSubtaskCompletion = async (
      subtaskId: string,
      parentTaskId: string,
      completed: boolean,
      note: string
    ): Promise<{ success: boolean; message: string }> => {
      try {
        await changeTaskStatusViaApi(subtaskId, completed ? 'Done' : 'Todo', note);

        const refreshedParent = await loadTaskDetailFromApi(parentTaskId);
        setTasks((prev) => prev.map((t) => (t.id === parentTaskId ? refreshedParent : t)));

        return {
          success: true,
          message: completed ? 'Subtask marked complete.' : 'Subtask reopened.'
        };
      } catch (error: any) {
        console.error('Failed to update subtask.', error);
        return { success: false, message: error?.message || 'Failed to update the subtask. Please try again.' };
      }
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

    // Project_Creation/Project_Deletion decisions delegate to the real, API-backed
    // approveProject/approveProjectDeletion above -- those already update `projects`,
    // `systemApprovals`, and the success toast; this just adds the Approvals-Inbox-specific
    // activity log entry once the underlying call actually succeeds.
    const approveApprovalItem = async (approvalId: string): Promise<{ success: boolean; message: string }> => {
      const item = systemApprovals.find((sa) => sa.id === approvalId);
      if (!item) return { success: false, message: 'Approval request not found.' };

      let result: { success: boolean; message: string } = {
        success: true,
        message: `Approved "${item.targetTitle}".`
      };

      if (item.type === 'Project_Creation') {
        result = await approveProject(item.targetId);
      } else if (item.type === 'Project_Deletion') {
        result = await approveProjectDeletion(item.targetId);
      } else if (item.type === 'Task_Creation') {
        const project = projects.find((candidate) => candidate.id === item.projectId);

        if (currentRole !== 'Team_Lead' || !project || project.teamLeadId !== currentUser.id) {
          return {
            success: false,
            message: 'Only this project’s Team Lead can approve the task request.'
          };
        }

        if (!item.proposedTask) {
          return { success: false, message: 'The proposed task details are missing.' };
        }

        const proposed = item.proposedTask;
        const creationResult = await createTaskViaApi({
          projectId: proposed.projectId,
          parentTaskId: proposed.parentTaskId,
          title: proposed.title,
          description: proposed.description,
          priority: proposed.priority,
          startDate: proposed.startDate,
          dueDate: proposed.dueDate,
          assigneeIds: proposed.assigneeIds,
          status: proposed.status
        });

        if (!creationResult.success || !creationResult.task) {
          return creationResult;
        }

        setTasks((prev) => [creationResult.task!, ...prev]);
        setSystemApprovals((prev) =>
          prev.map((approval) =>
            approval.id === approvalId
              ? { ...approval, status: 'Approved', targetId: creationResult.task!.id }
              : approval
          )
        );

        dispatchNotifications({
          recipientIds: resolveSingleRecipient(item.requestedBy, currentUser.id),
          type: 'approval',
          title: 'Task Request Approved',
          message: `${currentUser.name} approved your task request for "${item.targetTitle}" in ${project.title}.`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          linkRoute: 'tasks',
          projectId: project.id,
          taskId: creationResult.task.id
        });

        result = {
          success: true,
          message: `You approved "${item.targetTitle}" and created the task successfully.`
        };
        confirmActionSuccess('Task Request Approved', result.message);
      } else if (item.type === 'Controlled_Edit' && item.proposedTaskUpdate) {
        const relatedProject = item.projectId && projects.find((project) => project.id === item.projectId);
        if (currentRole !== 'Team_Lead' || !relatedProject || relatedProject.teamLeadId !== currentUser.id) {
          return { success: false, message: 'Only this task\'s Team Lead can approve the update.' };
        }
        try {
          const updated = await decideTaskEditApprovalViaApi(approvalId, 'Approved');
          if (!updated) return { success: false, message: 'The approved task was not returned by the server.' };
          setTasks((prev) => prev.map((task) => {
            if (task.id === item.targetId) return { ...updated, approvalStatus: 'Approved', pendingEdit: undefined };
            if (!task.subtasks.some((subtask) => subtask.id === item.targetId)) return task;
            return {
              ...task,
              subtasks: task.subtasks.map((subtask) => subtask.id === item.targetId
                ? { ...updated, approvalStatus: 'Approved', pendingEdit: undefined, completed: updated.status === 'Done' }
                : subtask)
            };
          }));
          setSystemApprovals((prev) => prev.map((approval) => approval.id === approvalId
            ? { ...approval, status: 'Approved' }
            : approval));
          dispatchNotifications({
            recipientIds: resolveSingleRecipient(item.requestedBy, currentUser.id),
            type: 'approval',
            title: 'Task Update Approved',
            message: `${currentUser.name} approved your update to "${item.targetTitle}".`,
            actorId: currentUser.id,
            actorName: currentUser.name,
            linkRoute: 'tasks',
            projectId: relatedProject.id,
            taskId: item.targetId
          });
          result = { success: true, message: `You approved the update to "${item.targetTitle}".` };
          confirmActionSuccess('Task Update Approved', result.message);
        } catch (error: any) {
          return { success: false, message: error?.message || 'Unable to apply the approved task update.' };
        }
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
        result = { success: true, message: `You approved the ${field} change on "${item.targetTitle}" successfully.` };
        confirmActionSuccess('Request Approved', result.message);
      }

      if (result.success) {
        pushActivity('Approved request', 'Approval', approvalId, item.targetTitle);
      }
      return result;
    };

    // Project_Creation is the one type backed by a real API call: rejectProject() above both
    // archives the pending project on the backend and marks this same SystemApproval Rejected,
    // so there is nothing left to do here for that branch. Project_Deletion/Controlled_Edit
    // rejections stay purely local (rejecting a deletion request must never touch the project).
    const rejectApprovalItem = async (
      approvalId: string,
      reason?: string
    ): Promise<{ success: boolean; message: string }> => {
      const item = systemApprovals.find((sa) => sa.id === approvalId);
      if (!item) return { success: false, message: 'Approval request not found.' };

      if (item.type === 'Project_Deletion' && currentRole !== 'Admin') {
        return { success: false, message: 'Only Admins can reject a project deletion request.' };
      }

      if (item.type === 'Project_Creation') {
        return rejectProject(item.targetId, reason);
      }

      if (item.type === 'Task_Creation') {
        const project = projects.find((candidate) => candidate.id === item.projectId);

        if (currentRole !== 'Team_Lead' || !project || project.teamLeadId !== currentUser.id) {
          return {
            success: false,
            message: 'Only this project’s Team Lead can reject the task request.'
          };
        }
      }

      if (item.type === 'Controlled_Edit' && item.proposedTaskUpdate) {
        const project = item.projectId && projects.find((candidate) => candidate.id === item.projectId);
        if (currentRole !== 'Team_Lead' || !project || project.teamLeadId !== currentUser.id) {
          return { success: false, message: 'Only this task\'s Team Lead can reject the update.' };
        }
        try {
          await decideTaskEditApprovalViaApi(approvalId, 'Rejected');
        } catch (error: any) {
          return { success: false, message: error?.message || 'Unable to reject the task update.' };
        }
      }

      setSystemApprovals((prev) =>
        prev.map((sa) => (sa.id === approvalId ? { ...sa, status: 'Rejected' } : sa))
      );
      if (item.type === 'Controlled_Edit' && item.proposedTaskUpdate) {
        setTasks((prev) => prev.map((task) => {
          if (task.id === item.targetId) {
            return { ...task, approvalStatus: 'Approved', pendingEdit: undefined };
          }
          if (!task.subtasks.some((subtask) => subtask.id === item.targetId)) return task;
          return {
            ...task,
            subtasks: task.subtasks.map((subtask) => subtask.id === item.targetId
              ? { ...subtask, approvalStatus: 'Approved', pendingEdit: undefined }
              : subtask)
          };
        }));
      }

      const targetsProject = item.type === 'Project_Deletion';
      const relatedProjectId = targetsProject
        ? item.targetId
        : item.type === 'Task_Creation'
          ? item.projectId
          : tasks.find((t) => t.id === item.targetId)?.projectId;
      const relatedProject = relatedProjectId ? projects.find((p) => p.id === relatedProjectId) : undefined;
      dispatchNotifications({
        recipientIds: resolveSingleRecipient(item.requestedBy, currentUser.id),
        type: 'approval',
        title: 'Request Rejected',
        message: `${currentUser.name} rejected your request for "${item.targetTitle}"${relatedProject ? ` in ${relatedProject.title}` : ''}.`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: targetsProject ? 'projects' : 'tasks',
        taskId: targetsProject || item.type === 'Task_Creation' ? undefined : item.targetId,
        projectId: targetsProject ? item.targetId : relatedProjectId
      });
      const message = `You rejected the request for "${item.targetTitle}" successfully.`;
      confirmActionSuccess('Request Rejected', message);
      return { success: true, message };
    };

    // Attendance & Breaks
    // Minimal integration hook (Attendance/Break Management modules are not being redesigned —
    // see the notification backend spec): every trigger below only describes what happened and
    // calls dispatchNotifications, exactly like every other module's hooks in this file.
    // Recipients are the HR-role users, mirroring the pre-existing "Notify HR" convention already
    // used by submitHRRequest below (HR is this app's attendance-oversight role, per
    // frontend/src/types/index.ts's UserRole).
    const resolveHRRecipients = () =>
      users.filter((user) => user.role === 'HR' && user.id !== currentUser.id).map((user) => user.id);

    const checkIn = () => {
      if (currentRole === 'Admin') {
        pushToast('error', 'Attendance Unavailable', 'Administrators do not have personal attendance.');
        return;
      }
      const todayStr = new Date().toISOString().split('T')[0];
      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const isLate = nowTime > settings.workingHours.start;

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

      // Persist check-in to backend
      const checkInUtc = new Date().toISOString();
      const token = localStorage.getItem('worksync_auth_token');
      if (token) {
        fetch('/api/attendance/check-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ workDate: todayStr, checkInUtc, isLate }),
        }).catch((err) => console.error('[Attendance] Failed to persist check-in:', err));
      }

      dispatchNotifications({
        recipientIds: resolveHRRecipients(),
        type: isLate ? 'attendance_late_check_in' : 'attendance_check_in',
        title: isLate ? 'Late Check-In' : 'Employee Checked In',
        message: isLate
          ? `${currentUser.name} checked in late at ${nowTime} (shift starts ${settings.workingHours.start}).`
          : `${currentUser.name} checked in at ${nowTime}.`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'attendance'
      });
      confirmActionSuccess('Checked In', `You checked in at ${nowTime} successfully.`);
      pushActivity('Checked in for work', 'Attendance', currentUser.id, currentUser.name);
    };

    const checkOut = () => {
      if (currentRole === 'Admin') return;
      const todayStr = new Date().toISOString().split('T')[0];
      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const hasOpenAttendance = attendanceRecords.some(
        (record) =>
          record.userId === currentUser.id &&
          record.date === todayStr &&
          !record.checkOut
      );
      if (!hasOpenAttendance) return;

      setAttendanceRecords((prev) =>
        prev.map((a) => {
          if (a.userId === currentUser.id && a.date === todayStr && !a.checkOut) {
            return {
              ...a,
              checkOut: nowTime,
              totalHours: 8.0
            };
          }
          return a;
        })
      );

      if (activeBreak?.isBreaking && activeBreak.userId === currentUser.id) {
        endBreak();
      }

      // Persist check-out to backend
      const checkOutUtc = new Date().toISOString();
      const token = localStorage.getItem('worksync_auth_token');
      if (token) {
        fetch('/api/attendance/check-out', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ workDate: todayStr, checkOutUtc }),
        }).catch((err) => console.error('[Attendance] Failed to persist check-out:', err));
      }

      dispatchNotifications({
        recipientIds: resolveHRRecipients(),
        type: 'attendance_check_out',
        title: 'Employee Checked Out',
        message: `${currentUser.name} checked out at ${nowTime}.`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'attendance'
      });
      confirmActionSuccess('Checked Out', `You checked out at ${nowTime} successfully.`);
      pushActivity('Checked out from work', 'Attendance', currentUser.id, currentUser.name);
    };

    const startBreak = (breakType: BreakType) => {
      if (currentRole === 'Admin') return;
      if (activeBreak?.isBreaking) return;

      const todayStr = new Date().toISOString().split('T')[0];
      const openAttendance = attendanceRecords.some(
        (record) =>
          record.userId === currentUser.id &&
          record.date === todayStr &&
          !record.checkOut
      );
      if (!openAttendance) return;

      const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      setActiveBreak({
        isBreaking: true,
        userId: currentUser.id,
        breakType,
        startTime: nowTime,
        elapsedSeconds: 0
      });
      dispatchNotifications({
        recipientIds: resolveHRRecipients(),
        type: 'break_started',
        title: 'Break Started',
        message: `${currentUser.name} started a ${breakType} at ${nowTime}.`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'attendance'
      });
      pushActivity(`Started ${breakType}`, 'Attendance', currentUser.id, currentUser.name);
    };

    const endBreak = () => {
      if (currentRole === 'Admin') return;
      if (!activeBreak || activeBreak.userId !== currentUser.id) return;
      const todayStr = new Date().toISOString().split('T')[0];
      const endTimeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
      const durationMin = Math.max(1, Math.round(activeBreak.elapsedSeconds / 60));
      const exceeded = durationMin > settings.breakLimitMinutes;

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
      dispatchNotifications({
        recipientIds: resolveHRRecipients(),
        type: exceeded ? 'break_exceeded' : 'break_ended',
        title: exceeded ? 'Break Time Exceeded' : 'Break Ended',
        message: exceeded
          ? `${currentUser.name}'s ${activeBreak.breakType} lasted ${durationMin} minutes, over the ${settings.breakLimitMinutes}-minute limit.`
          : `${currentUser.name} ended their ${activeBreak.breakType} after ${durationMin} minutes.`,
        actorId: currentUser.id,
        actorName: currentUser.name,
        linkRoute: 'attendance'
      });
      pushActivity(`Ended break (${durationMin} mins)`, 'Attendance', currentUser.id, currentUser.name);
    };

    const updateAttendanceRecord = async (
      recordId: string,
      updates: Pick<AttendanceRecord, 'checkIn' | 'checkOut' | 'breaks'>,
      reason?: string
    ): Promise<{ success: boolean; message: string }> => {
      const record = attendanceRecords.find((item) => item.id === recordId);
      if (!record) {
        return { success: false, message: 'Attendance record not found.' };
      }

      const isAdmin = currentRole === 'Admin';
      const isOwnRecord = record.userId === currentUser.id;
      const canEditRecord = isOwnRecord || isAdmin;
      if (!canEditRecord) {
        return {
          success: false,
          message: 'You are not authorized to edit another user’s attendance record.'
        };
      }

      const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
      if (!timePattern.test(updates.checkIn) || (updates.checkOut && !timePattern.test(updates.checkOut))) {
        return { success: false, message: 'Check-in and check-out times must use HH:mm format.' };
      }

      const normalizedBreaks: WorkBreak[] = updates.breaks.map((workBreak, index) => {
        const duration = Number(workBreak.durationMinutes);
        return {
          ...workBreak,
          id: workBreak.id || `brk-${recordId}-${index}-${Date.now()}`,
          type: 'Other',
          startTime: timePattern.test(workBreak.startTime) ? workBreak.startTime : '',
          endTime: workBreak.endTime && timePattern.test(workBreak.endTime) ? workBreak.endTime : undefined,
          durationMinutes: Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : 0
        };
      });

      if (normalizedBreaks.some((workBreak) => !workBreak.startTime || !workBreak.endTime)) {
        return { success: false, message: 'Every saved break must have valid start and end times.' };
      }

      if (!isAdmin) {
        if (!isOwnRecord) {
          return { success: false, message: 'You can only request changes to your own attendance.' };
        }
        const cleanReason = reason?.trim() || '';
        if (!cleanReason) {
          return { success: false, message: 'A reason is required for an attendance edit request.' };
        }
        return submitHRRequest(
          'Correction',
          cleanReason,
          {
            currentCheckIn: record.checkIn,
            currentCheckOut: record.checkOut || '',
            requestedCheckIn: updates.checkIn,
            requestedCheckOut: updates.checkOut || '',
            currentBreaks: record.breaks,
            requestedBreaks: normalizedBreaks,
            attendanceChangeReason: cleanReason
          },
          record.date
        );
      }

      try {
        const response = await fetch(
          `/api/attendance/${encodeURIComponent(record.userId)}/${encodeURIComponent(record.date)}`,
          {
            method: 'PUT',
            headers: getAuthHeaders(),
            body: JSON.stringify({
              checkIn: updates.checkIn,
              checkOut: updates.checkOut || '',
              breaks: normalizedBreaks,
              reason: reason?.trim() || ''
            })
          }
        );
        const data = await response.json().catch(() => null);
        if (!response.ok || !data?.success) {
          throw new Error(data?.message || 'Failed to save attendance changes.');
        }
      } catch (error: any) {
        return { success: false, message: error?.message || 'Failed to save attendance changes.' };
      }

      setAttendanceRecords((prev) =>
        prev.map((item) =>
          item.id === recordId
            ? {
              ...item,
              checkIn: updates.checkIn,
              checkOut: updates.checkOut || undefined,
              breaks: normalizedBreaks
            }
            : item
        )
      );

      pushActivity(
        `Updated attendance for ${users.find((user) => user.id === record.userId)?.name || record.userId}`,
        'Attendance',
        record.id,
        currentUser.name
      );
      return { success: true, message: 'Attendance record updated.' };
    };

    // HR Requests
    // 'Correction' has its own dedicated notification type; 'Leave' and 'Break_Exception' reuse
    // the generic 'approval' type already used elsewhere in this file for every other
    // pending-decision flow (project creation, controlled edits) — see approveApprovalItem/
    // rejectApprovalItem above for the same convention.
    const submitHRRequest = async (
      type: HRRequest['type'],
      reason: string,
      details: HRRequest['details'],
      requestDate?: string
    ): Promise<{ success: boolean; message: string }> => {
      try {
        const response = await fetch('/api/hr-requests', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            userName: currentUser.name,
            type,
            date: requestDate || new Date().toISOString().split('T')[0],
            reason,
            details
          })
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.request) {
          throw new Error(data.message || 'Failed to submit HR request.');
        }

        const newReq = data.request as HRRequest;
        setHrRequests((prev) => [newReq, ...prev.filter((item) => item.id !== newReq.id)]);

        const recipients =
          newReq.approvalStage === 'Admin'
            ? resolveAdminRecipients(users, currentUser.id)
            : resolveHRRecipients();
        dispatchNotifications({
          recipientIds: recipients,
          type: type === 'Correction' ? 'attendance_correction_submitted' : 'attendance',
          title: type === 'Leave' ? 'Leave Submitted' : 'New Attendance Edit Request',
          message: `${currentUser.name} submitted a ${type.toLowerCase().replace('_', ' ')} request: "${reason}".`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          linkRoute: 'attendance'
        });
        confirmActionSuccess('Request Submitted', `Your ${type.toLowerCase().replace('_', ' ')} request was submitted successfully.`);
        pushActivity(`Submitted HR ${type} request`, 'Attendance', newReq.id, currentUser.name);
        return { success: true, message: data.message || 'HR request submitted successfully.' };
      } catch (error: any) {
        const message = error?.message || 'Failed to submit HR request.';
        pushToast('error', 'Request Failed', message);
        return { success: false, message };
      }
    };

    const approveHRRequest = async (
      requestId: string,
      decisionReason?: string
    ): Promise<{ success: boolean; message: string }> => {
      try {
        const response = await fetch(`/api/hr-requests/${requestId}/approve`, {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ decisionReason })
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.request) {
          throw new Error(data.message || 'Failed to approve HR request.');
        }

        const updatedRequest = data.request as HRRequest;
        setHrRequests((prev) =>
          prev.map((request) => request.id === requestId ? updatedRequest : request)
        );

        if (data.forwarded) {
          dispatchNotifications({
            recipientIds: resolveAdminRecipients(users, currentUser.id),
            type: 'attendance',
            title: 'Leave Forwarded to Admin',
            message: `${currentUser.name} approved ${updatedRequest.userName || 'an employee'}'s ${updatedRequest.details.leaveType || 'leave'} request for ${updatedRequest.date}.`,
            actorId: currentUser.id,
            actorName: currentUser.name,
            linkRoute: 'approvals'
          });
          dispatchNotifications({
            recipientIds: resolveSingleRecipient(updatedRequest.userId, currentUser.id),
            type: 'attendance',
            title: 'Leave Forwarded to Admin',
            message: `HR approved your leave request for ${updatedRequest.date}. It is awaiting final Admin approval.`,
            actorId: currentUser.id,
            actorName: currentUser.name,
            linkRoute: 'attendance'
          });
          const message = data.message || 'Leave request forwarded to Admin.';
          confirmActionSuccess('Leave Forwarded', message);
          return { success: true, message };
        }

        if (updatedRequest.type === 'Correction') {
          setAttendanceRecords((prev) => prev.map((record) =>
            record.userId === updatedRequest.userId && record.date === updatedRequest.date
              ? {
                  ...record,
                  checkIn: updatedRequest.details.requestedCheckIn || record.checkIn,
                  checkOut: updatedRequest.details.requestedCheckOut || undefined,
                  breaks: updatedRequest.details.requestedBreaks || []
                }
              : record
          ));
        } else if (updatedRequest.type === 'Leave') {
          const status = updatedRequest.details.leaveType === 'Half Day Leave' ? 'Half Day' : 'On Leave';
          setAttendanceRecords((prev) => {
            const exists = prev.some((record) =>
              record.userId === updatedRequest.userId && record.date === updatedRequest.date
            );
            if (exists) {
              return prev.map((record) =>
                record.userId === updatedRequest.userId && record.date === updatedRequest.date
                  ? { ...record, status }
                  : record
              );
            }
            return [{
              id: `att-${updatedRequest.userId}-${updatedRequest.date}`,
              userId: updatedRequest.userId,
              date: updatedRequest.date,
              checkIn: '',
              totalHours: 0,
              status,
              breaks: []
            }, ...prev];
          });
        }

        const notifType =
          updatedRequest.type === 'Correction'
            ? 'attendance_correction_approved'
            : updatedRequest.type === 'Break_Exception'
              ? 'break_approved'
              : 'attendance';
        dispatchNotifications({
          recipientIds: resolveSingleRecipient(updatedRequest.userId, currentUser.id),
          type: notifType,
          title: updatedRequest.type === 'Leave'
            ? 'Leave Approved'
            : updatedRequest.type === 'Correction'
              ? 'Attendance Approved'
              : `${updatedRequest.type.replace('_', ' ')} Request Approved`,
          message: `${currentUser.name} approved your ${updatedRequest.type.toLowerCase().replace('_', ' ')} request.`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          linkRoute: 'attendance'
        });
        confirmActionSuccess('Request Approved', `You approved the ${updatedRequest.type.toLowerCase().replace('_', ' ')} request successfully.`);
        pushActivity('Approved HR request', 'Attendance', requestId, 'HR Approval');
        return { success: true, message: data.message || 'HR request approved successfully.' };
      } catch (error: any) {
        const message = error?.message || 'Failed to approve HR request.';
        pushToast('error', 'Approval Failed', message);
        return { success: false, message };
      }
    };

    const rejectHRRequest = async (
      requestId: string,
      decisionReason?: string
    ): Promise<{ success: boolean; message: string }> => {
      try {
        const response = await fetch(`/api/hr-requests/${requestId}/reject`, {
          method: 'PATCH',
          headers: getAuthHeaders(),
          body: JSON.stringify({ decisionReason })
        });
        const data = await response.json();
        if (!response.ok || !data.success || !data.request) {
          throw new Error(data.message || 'Failed to reject HR request.');
        }

        const updatedRequest = data.request as HRRequest;
        setHrRequests((prev) =>
          prev.map((request) => request.id === requestId ? updatedRequest : request)
        );

        const notifType =
          updatedRequest.type === 'Correction'
            ? 'attendance_correction_rejected'
            : updatedRequest.type === 'Break_Exception'
              ? 'break_rejected'
              : 'attendance';
        dispatchNotifications({
          recipientIds: resolveSingleRecipient(updatedRequest.userId, currentUser.id),
          type: notifType,
          title: updatedRequest.type === 'Leave'
            ? 'Leave Rejected'
            : updatedRequest.type === 'Correction'
              ? 'Attendance Rejected'
              : `${updatedRequest.type.replace('_', ' ')} Request Rejected`,
          message: `${currentUser.name} rejected your ${updatedRequest.type.toLowerCase().replace('_', ' ')} request.${decisionReason ? ` Reason: ${decisionReason}` : ''}`,
          actorId: currentUser.id,
          actorName: currentUser.name,
          linkRoute: 'attendance'
        });
        confirmActionSuccess('Request Rejected', `You rejected the ${updatedRequest.type.toLowerCase().replace('_', ' ')} request successfully.`);
        pushActivity('Rejected HR request', 'Attendance', requestId, 'HR Rejection');
        return { success: true, message: data.message || 'HR request rejected successfully.' };
      } catch (error: any) {
        const message = error?.message || 'Failed to reject HR request.';
        pushToast('error', 'Rejection Failed', message);
        return { success: false, message };
      }
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
      const mentionedIds = new Set(mentionedUsers.map((user) => user.id));
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

      // Everyone else on the project hears about the new message at the generic 'chat_new_message'
      // level (mentioned users already got the more specific, higher-signal 'mention' above, so
      // they're excluded here to avoid a duplicate notification for the same message).
      if (chatProject) {
        const otherRecipients = resolveProjectRecipients({ project: chatProject, excludeUserId: currentUser.id }).filter(
          (id) => !mentionedIds.has(id)
        );
        if (otherRecipients.length > 0) {
          dispatchNotifications({
            recipientIds: otherRecipients,
            type: 'chat_new_message',
            title: 'New Chat Message',
            message: `${currentUser.name} posted a new message in ${chatProject.title} chat: "${message.slice(0, 80)}"`,
            actorId: currentUser.id,
            actorName: currentUser.name,
            linkRoute: 'chat',
            projectId
          });
        }
      }
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

    // Each of these applies the change to local state immediately (so the UI never waits on a
    // round-trip) and fires the real API call in the background — see dispatchNotifications'
    // comment above for why every notification action follows this same "local UX, backend as
    // best-effort persistence" shape rather than blocking on the network.
    const markNotificationRead = (id: string) => {
      setNotifications((prev) => markAsRead(prev, id));
      markNotificationReadApi(id).catch((error) => {
        console.warn('Failed to persist "mark as read" to the backend.', error);
      });
    };

    const markAllNotificationsRead = () => {
      setNotifications((prev) => markAllAsReadInList(prev, currentUser.id));
      markAllNotificationsReadApi().catch((error) => {
        console.warn('Failed to persist "mark all as read" to the backend.', error);
      });
    };

    const clearNotification = (id: string) => {
      setNotifications((prev) => removeNotificationFromList(prev, id, currentUser.id));
      clearNotificationApi(id).catch((error) => {
        console.warn('Failed to persist notification clear to the backend.', error);
      });
    };

    // "Remind me later". The API tracks a real SnoozedUntilUtc and re-surfaces the notification
    // automatically once it passes; the local fallback (used only if the API call fails) has no
    // such scheduler, so it approximates snooze as a dismiss — see notificationService.ts's
    // snoozeNotification for why.
    const snoozeNotification = (id: string, untilIso: string) => {
      setNotifications((prev) => snoozeNotificationInList(prev, id, currentUser.id));
      snoozeNotificationApi(id, untilIso).catch((error) => {
        console.warn('Failed to persist notification snooze to the backend.', error);
      });
    };

    const updateNotificationPreferences = (data: Partial<NotificationPreferences>) => {
      setNotificationPreferences((prev) => ({ ...prev, ...data }));
      updateNotificationPreferencesApi(data).catch((error) => {
        console.warn('Failed to persist notification preferences to the backend.', error);
      });
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

  const updateCurrentUser = (updates: Partial<User>) => {
    setCurrentUser((prev) => ({ ...prev, ...updates }));
    setUsers((prev) =>
      prev.map((u) => (u.id === currentUser.id ? { ...u, ...updates } : u))
    );
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

  const getMemberAssignedTasksCount = (userId: string) => {
    return tasks.filter((t) => t.assigneeId === userId && t.status !== 'Done').length;
  };

  const reassignMemberTasks = (sourceUserId: string, targetUserId: string) => {
    const assignedTasks = tasks.filter((t) => t.assigneeId === sourceUserId);
    if (assignedTasks.length === 0) return { success: true, count: 0 };

    const targetUser = users.find((u) => u.id === targetUserId);
    const sourceUser = users.find((u) => u.id === sourceUserId);

    setTasks((prev) =>
      prev.map((t) => (t.assigneeId === sourceUserId ? { ...t, assigneeId: targetUserId } : t))
    );

    setActivityLogs((prev) => [
      {
        id: `act-${Date.now()}`,
        userId: currentUser.id,
        userName: currentUser.name,
        userAvatar: currentUser.avatar,
        action: `Reassigned ${assignedTasks.length} task(s) from ${sourceUser?.name || sourceUserId} to ${targetUser?.name || targetUserId}`,
        targetType: 'Task',
        targetId: sourceUserId,
        targetTitle: 'Task Bulk Reassignment',
        timestamp: new Date().toISOString()
      },
      ...prev
    ]);

    return { success: true, count: assignedTasks.length };
  };

  const addTeamMember = (data: Omit<User, 'id'>) => {
    const newUserId = `usr-${Date.now()}`;
    const newUser: User = {
      id: newUserId,
      name: data.name,
      email: data.email,
      role: data.role || 'Team_Member',
      department: data.department || 'Engineering',
      avatar: data.avatar || `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(data.name)}`,
      title: data.title || 'Team Specialist',
      status: data.status || 'active',
      lastActive: 'Just now',
      githubUsername: data.githubUsername
    };

    setUsers((prev) => [newUser, ...prev]);
    setActivityLogs((prev) => [
      {
        id: `act-${Date.now()}`,
        userId: currentUser.id,
        userName: currentUser.name,
        userAvatar: currentUser.avatar,
        action: `Added new team member ${newUser.name} (${newUser.role})`,
        targetType: 'Settings',
        targetId: newUserId,
        targetTitle: newUser.name,
        timestamp: new Date().toISOString()
      },
      ...prev
    ]);
  };

  const updateTeamMember = (userId: string, data: Partial<User>) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, ...data } : u))
    );
    setActivityLogs((prev) => [
      {
        id: `act-${Date.now()}`,
        userId: currentUser.id,
        userName: currentUser.name,
        userAvatar: currentUser.avatar,
        action: `Updated profile details for member ${data.name || userId}`,
        targetType: 'Settings',
        targetId: userId,
        targetTitle: data.name || 'Member',
        timestamp: new Date().toISOString()
      },
      ...prev
    ]);
  };

  const deleteTeamMember = (userId: string, targetReassignUserId?: string) => {
    const targetUser = users.find((u) => u.id === userId);
    if (!targetUser) return { success: false, message: 'Member not found.' };

    const assignedCount = getMemberAssignedTasksCount(userId);
    if (assignedCount > 0 && !targetReassignUserId) {
      return {
        success: false,
        message: `Safety Warning: Member ${targetUser.name} currently has ${assignedCount} active assigned tasks. Please select a team member to reassign their tasks before deletion.`
      };
    }

    if (assignedCount > 0 && targetReassignUserId) {
      reassignMemberTasks(userId, targetReassignUserId);
    }

    setUsers((prev) => prev.filter((u) => u.id !== userId));
    setActivityLogs((prev) => [
      {
        id: `act-${Date.now()}`,
        userId: currentUser.id,
        userName: currentUser.name,
        userAvatar: currentUser.avatar,
        action: `Deleted team member ${targetUser.name}`,
        targetType: 'Settings',
        targetId: userId,
        targetTitle: targetUser.name,
        timestamp: new Date().toISOString()
      },
      ...prev
    ]);
    return { success: true, message: `Member ${targetUser.name} successfully deleted.` };
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
        approvedLeave,
        savedPrompts,
        activeBreak,
        settings,
        refreshUsers,
        onUserRegistered,
        loginUser,
        logoutUser,
        toggleTheme,
        createProject,
        approveProject,
        rejectProject,
        updateProject,
        deleteProject,
        permanentlyDeleteProject,
        restoreProject,
        createTask,
        updateTask,
        deleteTask,
        updateTaskStatus,
        reopenTask,
        setSubtaskCompletion,
        proposeControlledEdit,
        approveApprovalItem,
        rejectApprovalItem,
        checkIn,
        checkOut,
        startBreak,
        endBreak,
        updateAttendanceRecord,
        submitHRRequest,
        approveHRRequest,
        rejectHRRequest,
        sendChatMessage,
        togglePinMessage,
        addAIQueryLog,
        markNotificationRead,
        markAllNotificationsRead,
        clearNotification,
        snoozeNotification,
        updateNotificationPreferences,
        dismissToast,
        showToast: pushToast,
        deactivateUser,
        exportBackup,
        updateCurrentUser,
        addTeamMember,
        updateTeamMember,
        deleteTeamMember,
        reassignMemberTasks,
        getMemberAssignedTasksCount
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
