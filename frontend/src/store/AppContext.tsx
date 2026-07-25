import React, { createContext, useContext, useState, useEffect } from 'react';
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
  ControlledEditRequest
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
  createTask: (data: Partial<Task>) => void;
  updateTaskStatus: (
    taskId: string,
    newStatus: TaskStatus,
    extraInfo?: { workSummary?: string; completionSummary?: string; blockerReason?: string; reopenReason?: string }
  ) => void;
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
  // Team Members Module Actions (Intern 6)
  addTeamMember: (data: Omit<User, 'id'>) => void;
  updateTeamMember: (userId: string, data: Partial<User>) => void;
  deleteTeamMember: (userId: string, targetReassignUserId?: string) => { success: boolean; message: string };
  reassignMemberTasks: (sourceUserId: string, targetUserId: string) => { success: boolean; count: number };
  getMemberAssignedTasksCount: (userId: string) => number;
  // Personal Profile & Settings Module Actions (Module 09: AbdulAzeemHashmi)
  updateCurrentUserProfile: (data: Partial<Pick<User, 'name' | 'email' | 'title' | 'department' | 'status' | 'githubUsername'>>) => void;
  updateSettings: (data: Partial<{ workingHours: { start: string; end: string }; breakLimitMinutes: number }>) => void;
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

  const [activeBreak, setActiveBreak] = useState<{
    isBreaking: boolean;
    breakType: BreakType;
    startTime: string;
    elapsedSeconds: number;
  } | null>(null);

  const [settings, setSettings] = useState({
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

  useEffect(() => {
    document.documentElement.classList.add('dark');
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
    
    const newProject: Project = {
      id: newProjId,
      code,
      title: data.title || 'Untitled Project',
      description: data.description || '',
      status: isAdmin ? 'Active' : 'Pending Approval',
      approvalStatus: isAdmin ? 'Approved' : 'Pending Approval',
      createdBy: currentUser.id,
      teamLeadId: data.teamLeadId || currentUser.id,
      memberIds: data.memberIds || [currentUser.id],
      startDate: data.startDate || new Date().toISOString().split('T')[0],
      targetDate: data.targetDate || new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
      progress: 0,
      tags: data.tags || ['New Project'],
      milestones: data.milestones || [],
      files: [],
      pinnedMessagesCount: 0
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

  // Create Task
  const createTask = (data: Partial<Task>) => {
    const parentProj = projects.find((p) => p.id === data.projectId);
    const isPendingProj = parentProj?.approvalStatus === 'Pending Approval';

    const newTaskId = `tsk-${Date.now()}`;
    const newTask: Task = {
      id: newTaskId,
      taskNumber: `${parentProj?.code || 'TSK'}-${Math.floor(10 + Math.random() * 90)}`,
      projectId: data.projectId || projects[0]?.id || 'prj-1',
      title: data.title || 'Untitled Task',
      description: data.description || '',
      status: data.status || 'Todo',
      priority: data.priority || 'Medium',
      assigneeId: data.assigneeId || currentUser.id,
      creatorId: currentUser.id,
      dueDate: data.dueDate || new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
      estimatedHours: data.estimatedHours || 8,
      subtasks: data.subtasks || [],
      dependencies: data.dependencies || [],
      tags: data.tags || ['Task'],
      attachments: [],
      approvalStatus: isPendingProj ? 'Pending Approval' : 'Approved',
      createdAt: new Date().toISOString().split('T')[0]
    };

    setTasks((prev) => [newTask, ...prev]);
    pushActivity('Created task', 'Task', newTaskId, newTask.title);
  };

  // Update Task Status (Kanban & Details) with mandatory reason/summary handlers
  const updateTaskStatus = (
    taskId: string,
    newStatus: TaskStatus,
    extraInfo?: { workSummary?: string; completionSummary?: string; blockerReason?: string; reopenReason?: string }
  ) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    setTasks((prev) =>
      prev.map((t) => {
        if (t.id === taskId) {
          return {
            ...t,
            status: newStatus,
            workSummary: extraInfo?.workSummary ?? t.workSummary,
            completionSummary: extraInfo?.completionSummary ?? t.completionSummary,
            blockerReason: extraInfo?.blockerReason ?? t.blockerReason,
            reopenReason: extraInfo?.reopenReason ?? t.reopenReason
          };
        }
        return t;
      })
    );

    pushActivity(`Moved task to ${newStatus}`, 'Task', taskId, task.title, {
      field: 'status',
      oldVal: task.status,
      newVal: newStatus
    });
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

  // LocalStorage user sync effect
  useEffect(() => {
    try {
      const savedUsers = localStorage.getItem('worksync_users');
      if (savedUsers) {
        const parsed = JSON.parse(savedUsers);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setUsers(parsed);
        }
      }
    } catch (e) {
      console.error('Failed to load users from localStorage', e);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('worksync_users', JSON.stringify(users));
    } catch (e) {
      console.error('Failed to save users to localStorage', e);
    }
  }, [users]);

  // Team Members Module Functions (Intern 6)
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

    pushActivity(
      `Reassigned ${assignedTasks.length} task(s) from ${sourceUser?.name || sourceUserId} to ${targetUser?.name || targetUserId}`,
      'Task',
      sourceUserId,
      `Task Bulk Reassignment`
    );

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
    pushActivity(`Added new team member ${newUser.name} (${newUser.role})`, 'Settings', newUserId, newUser.name);
  };

  const updateTeamMember = (userId: string, data: Partial<User>) => {
    setUsers((prev) =>
      prev.map((u) => (u.id === userId ? { ...u, ...data } : u))
    );
    pushActivity(`Updated profile details for member ${data.name || userId}`, 'Settings', userId, data.name || 'Member');
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
    pushActivity(`Deleted team member ${targetUser.name}`, 'Settings', userId, targetUser.name);
    return { success: true, message: `Member ${targetUser.name} successfully deleted.` };
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

  // --- Module 09: Profile & Settings Actions (AbdulAzeemHashmi) ---
  const updateCurrentUserProfile = (data: Partial<Pick<User, 'name' | 'email' | 'title' | 'department' | 'status' | 'githubUsername'>>) => {
    setUsers((prev) => prev.map((u) => (u.id === currentUser.id ? { ...u, ...data } : u)));
    setCurrentUser((prev) => ({ ...prev, ...data }));
    pushActivity('Updated personal profile', 'Settings', currentUser.id, currentUser.name);
  };

  const updateSettings = (data: Partial<{ workingHours: { start: string; end: string }; breakLimitMinutes: number }>) => {
    setSettings((prev) => ({ ...prev, ...data }));
    pushActivity('Updated system settings', 'Settings', 'settings', 'System Settings');
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
        createTask,
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
        exportBackup,
        addTeamMember,
        updateTeamMember,
        deleteTeamMember,
        reassignMemberTasks,
        getMemberAssignedTasksCount,
        updateCurrentUserProfile,
        updateSettings
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
