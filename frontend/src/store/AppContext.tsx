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
  TaskMutationResult
} from '../features/tasks/taskRules';
import {
  prepareTaskCreation,
  prepareTaskDeletion,
  prepareTaskUpdate,
  toTaskFormInput
} from '../features/tasks/taskMutations';
import { loadTasksFromSupabase } from '../features/tasks/taskRepository';

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
    if (next === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  };

  // Fetch persisted database users on mount
  useEffect(() => {
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
  }, []);

  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

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
      
      // Notify Admins
      const notif: NotificationItem = {
        id: `notif-${Date.now()}`,
        userId: 'usr-1',
        title: 'Project Approval Requested',
        message: `${currentUser.name} requested approval for new project "${newProject.title}".`,
        type: 'approval',
        read: false,
        timestamp: 'Just now',
        linkRoute: 'approvals'
      };
      setNotifications((prev) => [notif, ...prev]);
    }

    pushActivity('Created project', 'Project', newProjId, newProject.title);
  };

  const approveProject = (projectId: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, status: 'Active', approvalStatus: 'Approved' } : p))
    );
    setSystemApprovals((prev) =>
      prev.map((sa) => (sa.targetId === projectId ? { ...sa, status: 'Approved' } : sa))
    );
    pushActivity('Approved project proposal', 'Project', projectId, 'Project Approval');
  };

  const rejectProject = (projectId: string) => {
    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, approvalStatus: 'Rejected' } : p))
    );
    setSystemApprovals((prev) =>
      prev.map((sa) => (sa.targetId === projectId ? { ...sa, status: 'Rejected' } : sa))
    );
    pushActivity('Rejected project proposal', 'Project', projectId, 'Project Rejection');
  };

  const updateProject = (projectId: string, data: Partial<Project>) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    setProjects((prev) =>
      prev.map((p) => (p.id === projectId ? { ...p, ...data } : p))
    );
    pushActivity('Updated project', 'Project', projectId, data.title || project.title);
  };

  const deleteProject = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    if (!project) return;

    setProjects((prev) => prev.filter((p) => p.id !== projectId));
    setTasks((prev) => prev.filter((t) => t.projectId !== projectId));
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
    return result;
  };

  const updateTask = (taskId: string, data: TaskMutationData): TaskMutationResult => {
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
    return result;
  };

  const deleteTask = (taskId: string): TaskMutationResult => {
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
    }
    pushActivity('Approved request', 'Approval', approvalId, item.targetTitle);
  };

  const rejectApprovalItem = (approvalId: string) => {
    setSystemApprovals((prev) =>
      prev.map((sa) => (sa.id === approvalId ? { ...sa, status: 'Rejected' } : sa))
    );
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
    const newMsg: ChatMessage = {
      id: `msg-${Date.now()}`,
      projectId,
      senderId: currentUser.id,
      message,
      timestamp: 'Just now',
      isPinned: false
    };
    setChatMessages((prev) => [...prev, newMsg]);
    pushActivity('Posted project chat message', 'Project', projectId, 'Project Chat');
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
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
  };

  const markAllNotificationsRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
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
        activityLogs,
        calendarEvents,
        savedPrompts,
        weeklySummaryDraft,
        activeBreak,
        settings,
        setRole,
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
