import React, { useState, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { StatusBadge } from '../../components/common/StatusBadge';
import { GlassCard } from '../../components/common/GlassCard';
import { getTaskAssigneeIds } from '../tasks/taskRules';
import { fetchActivities } from '../activity/activityApi';
import { DEFAULT_ACTIVITY_FILTERS } from '../activity/activityTypes';
import { TaskStatus, ProjectStatus } from '../../types';
import { getOwnAccountChangeRequests, getSafeRequestedChangeLabel } from './accountChangeRequestHistory';
import {
  Mail, Briefcase, Shield, Save, AlertCircle,
  CheckCircle2, Calendar, Flag, Trophy, Loader2,
  FolderKanban, CheckSquare, Inbox, Bell, Clock, Eye,
  ChevronRight, AtSign,
  Activity as ActivityIcon, Send, Lock, User as UserIcon, Key
} from 'lucide-react';

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem('worksync_auth_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
};

const safeParseJSON = async (res: Response): Promise<Record<string, any>> => {
  const body = await res.text();
  try {
    return JSON.parse(body);
  } catch {
    return { success: false, message: `Unexpected response (${res.status})` };
  }
};

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0].toUpperCase())
    .join('');
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

// Mirrors NotificationsView: linkRoute may reference a pre-rename tab id (e.g. 'chat').
const NOTIFICATION_ROUTE_ALIASES: Record<string, string> = { chat: 'project-chats' };
function notificationTarget(linkRoute?: string): string {
  if (!linkRoute || linkRoute === 'notifications') return 'notifications';
  return NOTIFICATION_ROUTE_ALIASES[linkRoute] || linkRoute;
}

function validateDateRange(from: string, to: string): string | null {
  const today = todayStr();
  if (from > today) return 'From date cannot be in the future.';
  if (to > today) return 'To date cannot be in the future.';
  if (to < from) return 'To date cannot be earlier than From date.';
  return null;
}

function isInDateRange(dateStr: string, from: string, to: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const fromDate = new Date(from + 'T00:00:00');
  const toDate = new Date(to + 'T23:59:59');
  return d >= fromDate && d <= toDate;
}

type ProfileTab = 'overview' | 'my-projects' | 'my-tasks' | 'my-attendance' | 'upcoming-deadlines' | 'activity' | 'notifications' | 'account';

type TabDef = { id: ProfileTab; label: string; icon: React.ElementType };

const ROLE_TABS: Record<string, TabDef[]> = {
  Admin: [
    { id: 'overview', label: 'Overview', icon: Eye },
    { id: 'activity', label: 'Activity', icon: ActivityIcon },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'account', label: 'Account & Security', icon: Shield },
  ],
  HR: [
    { id: 'overview', label: 'Overview', icon: Eye },
    { id: 'my-attendance', label: 'My Attendance', icon: Clock },
    { id: 'activity', label: 'Activity', icon: ActivityIcon },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'account', label: 'Account & Security', icon: Shield },
  ],
  Team_Lead: [
    { id: 'overview', label: 'Overview', icon: Eye },
    { id: 'my-projects', label: 'My Projects', icon: FolderKanban },
    { id: 'my-tasks', label: 'My Tasks', icon: CheckSquare },
    { id: 'my-attendance', label: 'My Attendance', icon: Clock },
    { id: 'upcoming-deadlines', label: 'Upcoming Deadlines', icon: Calendar },
    { id: 'activity', label: 'Activity', icon: ActivityIcon },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'account', label: 'Account & Security', icon: Shield },
  ],
  Team_Member: [
    { id: 'overview', label: 'Overview', icon: Eye },
    { id: 'my-projects', label: 'My Projects', icon: FolderKanban },
    { id: 'my-tasks', label: 'My Tasks', icon: CheckSquare },
    { id: 'my-attendance', label: 'My Attendance', icon: Clock },
    { id: 'upcoming-deadlines', label: 'Upcoming Deadlines', icon: Calendar },
    { id: 'activity', label: 'Activity', icon: ActivityIcon },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'account', label: 'Account & Security', icon: Shield },
  ],
};

export const ProfileView: React.FC<{ onNavigate?: (tab: string, filterId?: string) => void }> = ({ onNavigate }) => {
  const {
    currentUser,
    tasks,
    projects,
    notifications,
    accountChangeRequests,
    updateCurrentUser,
    submitAccountChangeRequest
  } = useApp();
  const tabs = ROLE_TABS[currentUser.role] || ROLE_TABS.Admin;
  const [activeTab, setActiveTab] = useState<ProfileTab>(tabs[0]?.id || 'overview');

  const [nameInput, setNameInput] = useState(currentUser.name);
  const [nameLoading, setNameLoading] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [passwordExpanded, setPasswordExpanded] = useState(false);

  const [usernameInput, setUsernameInput] = useState(currentUser.username || '');
  const [usernameLoading, setUsernameLoading] = useState(false);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [usernameSuccess, setUsernameSuccess] = useState<string | null>(null);

  const [emailInput, setEmailInput] = useState(currentUser.email);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);

  const [requestExpanded, setRequestExpanded] = useState(false);
  const [requestField, setRequestField] = useState<'name' | 'email' | 'username' | 'password' | ''>('');
  const [requestValue, setRequestValue] = useState('');
  const [requestCurrentPassword, setRequestCurrentPassword] = useState('');
  const [requestReason, setRequestReason] = useState('');
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSuccess, setRequestSuccess] = useState<string | null>(null);

  const [profileAttendance, setProfileAttendance] = useState<any[]>([]);
  const [profileAttendanceLoading, setProfileAttendanceLoading] = useState(false);
  const [profileAttendanceError, setProfileAttendanceError] = useState<string | null>(null);
  const [profileActivity, setProfileActivity] = useState<any[]>([]);
  const [profileActivityLoading, setProfileActivityLoading] = useState(false);
  const [profileActivityError, setProfileActivityError] = useState<string | null>(null);
  const [profileActivityTotal, setProfileActivityTotal] = useState(0);
  const [taskStatusFilter, setTaskStatusFilter] = useState<string>('');
  const [projectStatusFilter, setProjectStatusFilter] = useState<string>('');
  const [deadlineFilter, setDeadlineFilter] = useState<string>('all');

  useEffect(() => {
    setNameInput(currentUser.name);
  }, [currentUser.name]);

  useEffect(() => {
    setUsernameInput(currentUser.username || '');
  }, [currentUser.username]);

  useEffect(() => {
    setEmailInput(currentUser.email);
  }, [currentUser.email]);

  const [dateRange, setDateRange] = useState<{ from: string; to: string }>(() => {
    const to = todayStr();
    const from = new Date(Date.now() - 29 * 86400000).toISOString().split('T')[0];
    return { from, to };
  });
  const [dateError, setDateError] = useState<string | null>(null);

  const handleDateChange = (field: 'from' | 'to', value: string) => {
    const next = { ...dateRange, [field]: value };
    setDateRange(next);
    setDateError(validateDateRange(next.from, next.to));
  };

  const hasDateError = dateError !== null;

  const fetchProfileAttendance = async (from: string, to: string) => {
    setProfileAttendanceLoading(true);
    setProfileAttendanceError(null);
    try {
      const res = await fetch(`/api/attendance?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
        headers: getAuthHeaders(),
      });
      const data = await safeParseJSON(res);
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to load attendance records.');
      }
      const records = (data.data || []).map((r: any, idx: number) => ({
        id: `att-${idx}-${r.date}`,
        userId: r.userId,
        date: r.date,
        checkIn: r.checkIn || '',
        checkOut: r.checkOut || undefined,
        totalHours: r.totalHours,
        status: r.status,
        breaks: [] as any[],
      }));
      setProfileAttendance(records);
    } catch (err: any) {
      setProfileAttendanceError(err.message);
      setProfileAttendance([]);
    } finally {
      setProfileAttendanceLoading(false);
    }
  };

  const fetchProfileActivity = async (from: string, to: string) => {
    setProfileActivityLoading(true);
    setProfileActivityError(null);
    try {
      const { items, total } = await fetchActivities({
        ...DEFAULT_ACTIVITY_FILTERS,
        datePreset: 'Custom',
        customFrom: from,
        customTo: to,
        myActivityOnly: true,
        sort: 'newest',
      }, 1, 30);
      setProfileActivityTotal(Number(total) || 0);
      setProfileActivity((items || []).map((item: any) => ({
        id: `act-${item.id}`,
        userId: item.actor?.id || '',
        userName: item.actor?.name || 'System',
        action: item.action,
        targetType: item.entityType,
        targetId: item.entityId,
        targetTitle: item.entityName || item.description,
        // Keep the raw ISO timestamp for reliable date-range filtering; render the localized label.
        timestamp: item.timestamp,
        timestampLabel: new Date(item.timestamp).toLocaleString(),
        ...(item.changes?.[0] ? { diff: { field: item.changes[0].field, oldVal: item.changes[0].previousValue || '', newVal: item.changes[0].newValue || '' } } : {}),
      })));
    } catch (err: any) {
      setProfileActivityError(err.message);
      setProfileActivity([]);
      setProfileActivityTotal(0);
    } finally {
      setProfileActivityLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'my-attendance' || activeTab === 'overview') {
      // My Attendance follows the same calendar date-range filter as the rest of My Profile.
      fetchProfileAttendance(dateRange.from, dateRange.to);
    }
  }, [dateRange.from, dateRange.to, activeTab]);

  useEffect(() => {
    if (activeTab === 'activity' || activeTab === 'overview') {
      fetchProfileActivity(dateRange.from, dateRange.to);
    }
  }, [dateRange.from, dateRange.to, activeTab]);

  const myTasks = tasks.filter((t) => getTaskAssigneeIds(t).includes(currentUser.id));
  const myProjects = projects.filter(
    (p) => p.memberIds.includes(currentUser.id) || p.teamLeadId === currentUser.id
  );
  const myAttendance = profileAttendance.filter((r) => r.userId === currentUser.id);
  const myActivity = profileActivity;
  const myNotifications = notifications.filter((n) => n.userId === currentUser.id);
  const projectsLed = projects.filter((p) => p.teamLeadId === currentUser.id);

  const getProjectName = (projectId: string): string => {
    const p = projects.find((proj) => proj.id === projectId);
    return p ? p.title : 'Unknown Project';
  };

  const myUpcomingDeadlines = myTasks
    .filter((t) => t.status !== 'Done' && t.dueDate && t.dueDate >= todayStr())
    .map((t) => ({
      id: `task-${t.id}`,
      title: t.title,
      date: t.dueDate,
      type: 'task' as const,
      projectName: getProjectName(t.projectId),
      projectId: t.projectId,
      taskId: t.id,
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Dedicated deadline filter that bypasses the global date range (for Upcoming Deadlines tab)
  const filteredUpcomingDeadlines = myUpcomingDeadlines.filter((d) => {
    if (deadlineFilter === 'all') return true;
    const today = todayStr();
    const tomorrow = addDays(today, 1);
    const endDate = deadlineFilter === 'today' ? today
      : deadlineFilter === 'tomorrow' ? tomorrow
      : deadlineFilter === 'next7' ? addDays(today, 7)
      : deadlineFilter === 'next30' ? addDays(today, 30)
      : null;
    if (!endDate) return true;
    return d.date >= today && d.date <= endDate;
  });

  // Global date range filtered deadlines (for Overview tab)
  const dateFilteredDeadlines = hasDateError
    ? myUpcomingDeadlines
    : myUpcomingDeadlines.filter((d) => isInDateRange(d.date, dateRange.from, dateRange.to));

  const dateFilteredTasks = hasDateError
    ? myTasks
    : myTasks.filter((t) => isInDateRange(t.dueDate, dateRange.from, dateRange.to) || isInDateRange(t.createdAt, dateRange.from, dateRange.to));

  const dateFilteredProjects = hasDateError
    ? myProjects
    : myProjects.filter((p) => isInDateRange(p.startDate, dateRange.from, dateRange.to) || isInDateRange(p.targetDate, dateRange.from, dateRange.to));

  const dateFilteredAttendance = hasDateError
    ? myAttendance
    : myAttendance.filter((r) => isInDateRange(r.date, dateRange.from, dateRange.to));

  const dateFilteredActivity = hasDateError
    ? myActivity
    : myActivity.filter((l) => isInDateRange(l.timestamp, dateRange.from, dateRange.to) || isInDateRange(l.timestampLabel, dateRange.from, dateRange.to));

  const dateFilteredNotifications = hasDateError
    ? myNotifications
    : myNotifications.filter((n) => isInDateRange(n.createdAt || '', dateRange.from, dateRange.to));

  const daysUntil = (dateStr: string): string => {
    const now = new Date();
    const target = new Date(dateStr);
    const diff = Math.ceil((target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    if (diff < 0) return `${Math.abs(diff)}d overdue`;
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    return `${diff}d left`;
  };

  const handleDisplayNameSave = async () => {
    const sanitized = nameInput.replace(/<[^>]*>/g, '').trim();
    if (sanitized.length < 2) {
      setNameError('Display name must be at least 2 characters.');
      return;
    }
    if (sanitized.length > 100) {
      setNameError('Display name must not exceed 100 characters.');
      return;
    }
    setNameLoading(true);
    setNameError(null);
    setNameSuccess(null);

    try {
      const res = await fetch('/api/auth/profile/display-name', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ name: sanitized }),
      });
      const data = await safeParseJSON(res);
      if (!res.ok || !data.success) {
        console.error('[Profile] Display name update failed:', data.message || res.status);
        throw new Error('Something went wrong.');
      }
      updateCurrentUser({ name: sanitized });
      setNameSuccess('Display name updated successfully.');
    } catch (err: any) {
      setNameError(err.message === 'Something went wrong.' ? err.message : 'Couldn\'t update your display name. Please try again.');
    } finally {
      setNameLoading(false);
    }
  };

  const handlePasswordChange = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setPasswordError('All password fields are required.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('New password and confirmation do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setPasswordError('New password must be at least 6 characters long.');
      return;
    }

    setPasswordLoading(true);
    setPasswordError(null);
    setPasswordSuccess(null);

    try {
      const res = await fetch('/api/auth/profile/password', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      });
      const data = await safeParseJSON(res);
      if (!res.ok || !data.success) {
        throw new Error(data.message || 'Failed to change password.');
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccess('Password changed successfully.');
    } catch (err: any) {
      setPasswordError(err.message);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleUsernameSave = async () => {
    const sanitized = usernameInput.replace(/<[^>]*>/g, '').trim().toLowerCase();
    if (!sanitized) {
      setUsernameError('Username is required.');
      return;
    }
    if (sanitized.length < 3) {
      setUsernameError('Username must be at least 3 characters.');
      return;
    }
    if (sanitized.length > 80) {
      setUsernameError('Username must not exceed 80 characters.');
      return;
    }
    if (!/^[a-z0-9][a-z0-9._-]+$/.test(sanitized)) {
      setUsernameError('Username can only contain letters, numbers, dots, hyphens, and underscores.');
      return;
    }
    setUsernameLoading(true);
    setUsernameError(null);
    setUsernameSuccess(null);

    try {
      const res = await fetch('/api/auth/profile/username', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ username: sanitized }),
      });
      const data = await safeParseJSON(res);
      if (!res.ok || !data.success) {
        console.error('[Profile] Username update failed:', data.message || res.status);
        throw new Error('Something went wrong.');
      }
      updateCurrentUser({ username: sanitized });
      setUsernameSuccess('Username updated successfully.');
    } catch (err: any) {
      setUsernameError(err.message === 'Something went wrong.' ? err.message : 'Couldn\'t update your username. Please try again.');
    } finally {
      setUsernameLoading(false);
    }
  };

  const handleEmailSave = async () => {
    const sanitized = emailInput.replace(/<[^>]*>/g, '').trim().toLowerCase();
    if (!sanitized) {
      setEmailError('Email is required.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(sanitized)) {
      setEmailError('A valid email address is required.');
      return;
    }
    setEmailLoading(true);
    setEmailError(null);
    setEmailSuccess(null);

    try {
      const res = await fetch('/api/auth/profile/email', {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({ email: sanitized }),
      });
      const data = await safeParseJSON(res);
      if (!res.ok || !data.success) {
        console.error('[Profile] Email update failed:', data.message || res.status);
        throw new Error('Something went wrong.');
      }
      updateCurrentUser({ email: sanitized });
      setEmailSuccess('Email updated successfully.');
    } catch (err: any) {
      setEmailError(err.message === 'Something went wrong.' ? err.message : 'Couldn\'t update your email. Please try again.');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleRequestSubmit = async () => {
    const field = requestField;
    const trimmedValue = requestValue.trim();
    const trimmedReason = requestReason.trim();

    if (!field) {
      setRequestError('Select what you want to change.');
      return;
    }

    if (field !== 'password' && !trimmedValue) {
      setRequestError('Please enter the new value you want to request.');
      return;
    }

    if (!trimmedReason) {
      setRequestError('Please provide a reason for the change request.');
      return;
    }

    if (field === 'name' && (trimmedValue.length < 2 || trimmedValue.length > 170)) {
      setRequestError('Display name must be between 2 and 170 characters.');
      return;
    }

    if (field === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedValue)) {
      setRequestError('Enter a valid email address.');
      return;
    }

    if (field === 'username' && !/^[a-z0-9][a-z0-9._-]{2,79}$/i.test(trimmedValue)) {
      setRequestError('Username must be 3-80 letters, numbers, dots, hyphens, or underscores.');
      return;
    }

    if (field === 'password') {
      if (!requestCurrentPassword) {
        setRequestError('Enter your current password to verify the password change request.');
        return;
      }
    }

    setRequestLoading(true);
    setRequestError(null);
    setRequestSuccess(null);

    const result = await submitAccountChangeRequest(
      field,
      field === 'password' ? undefined : trimmedValue,
      trimmedReason,
      field === 'password' ? requestCurrentPassword : undefined
    );

    if (result.success) {
      setRequestField('');
      setRequestValue('');
      setRequestCurrentPassword('');
      setRequestReason('');
      setRequestExpanded(false);
      setRequestSuccess(result.message);
    } else {
      setRequestError(result.message);
      setRequestCurrentPassword('');
    }
    setRequestLoading(false);
  };

  /* ───────── Initials Badge Component ───────── */
  const InitialsBadge = ({ size = 'lg' }: { size?: 'lg' | 'md' }) => {
    const dimensions = size === 'lg' ? 'w-28 h-28' : 'w-20 h-20';
    const initials = getInitials(currentUser.name);
    const containerClass = `${dimensions} rounded-full overflow-hidden ring-1 ring-slate-500/20 shrink-0`;
    return (
      <div className={`${containerClass} bg-slate-800/60 flex items-center justify-center`}>
        <span
          className="text-2xl font-bold text-cyan-400 select-none"
          style={size === 'md' ? { fontSize: '1.1rem' } : undefined}
        >
          {initials || '?'}
        </span>
      </div>
    );
  };

  /* ───────── Empty State ───────── */
  const EmptyState = ({ icon: Icon, title, message }: { icon: React.ElementType; title: string; message: string }) => (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="p-4 rounded-full bg-slate-800/60 mb-4">
        <Icon size={28} className="text-slate-500" />
      </div>
      <p className="text-sm font-semibold text-slate-300 mb-1">{title}</p>
      <p className="text-xs text-slate-500 max-w-xs">{message}</p>
    </div>
  );

  /* ───────── Section Header ───────── */
  const SectionHeader = ({ icon: Icon, label, count }: { icon: React.ElementType; label: string; count?: number }) => (
    <div className="flex items-center gap-2.5 mb-5">
      <div className="p-2 rounded-lg bg-slate-800/80">
        <Icon size={16} className="text-cyan-400" />
      </div>
      <h2 className="text-sm font-bold text-white">
        {label}{count !== undefined ? ` (${count})` : ''}
      </h2>
    </div>
  );

  /* ───────── Compact Status Filter ───────── */
  const StatusFilter = ({
    value,
    onChange,
    options,
    allLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    options: string[];
    allLabel: string;
  }) => (
    <div className="mb-4 flex items-center gap-2">
      <span className="text-[11px] font-mono text-slate-500 shrink-0">Status</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/10 bg-slate-900/60 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500/40"
      >
        <option value="">{allLabel}</option>
        {options.map((status) => (
          <option key={status} value={status}>{status}</option>
        ))}
      </select>
    </div>
  );

  /* ───────── Compact Deadline Filter ───────── */
  const DeadlineFilter = ({
    value,
    onChange,
    allLabel,
  }: {
    value: string;
    onChange: (value: string) => void;
    allLabel: string;
  }) => (
    <div className="mb-4 flex items-center gap-2">
      <span className="text-[11px] font-mono text-slate-500 shrink-0">Deadline</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-white/10 bg-slate-900/60 px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500/40"
      >
        <option value="all">{allLabel}</option>
        <option value="today">Due Today</option>
        <option value="tomorrow">Due Tomorrow</option>
        <option value="next7">Next 7 Days</option>
        <option value="next30">Next 30 Days</option>
      </select>
    </div>
  );

  /* ───────── Tab Navigation ───────── */
  const renderTabNav = () => (
    <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-200 shrink-0 border ${
              isActive
                ? 'bg-slate-800 text-white border-slate-600/40 shadow-sm'
                : 'bg-white/[0.04] text-slate-400 border-white/[0.06] hover:bg-white/[0.08] hover:text-slate-200 hover:border-slate-500/20'
            }`}
          >
            <Icon size={14} className={isActive ? 'text-cyan-300' : 'text-slate-400'} />
            {tab.label}
          </button>
        );
      })}
    </div>
  );

  /* ───────── My Tasks Tab ───────── */
  const TASK_STATUSES: TaskStatus[] = ['Todo', 'In Progress', 'Review', 'Done', 'Blocked'];
  const renderMyTasks = () => {
    const filtered = taskStatusFilter ? dateFilteredTasks.filter((t) => t.status === taskStatusFilter) : dateFilteredTasks;
    return (
    <div>
      <SectionHeader icon={CheckSquare} label="My Tasks" count={filtered.length} />
      <StatusFilter value={taskStatusFilter} onChange={setTaskStatusFilter} options={TASK_STATUSES} allLabel="All statuses" />
      {filtered.length === 0 ? (
        <EmptyState icon={Inbox} title="No assigned tasks yet" message="Tasks assigned to you will appear here." />
      ) : (
        <div className="max-h-[450px] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((t) => (
              <GlassCard key={t.id} glowColor="violet" onClick={() => onNavigate?.('tasks')}>
                <div className="flex items-start justify-between gap-2 mb-2.5">
                  <span className="font-mono text-[11px] text-purple-400 font-bold shrink-0">{t.taskNumber}</span>
                  <StatusBadge status={t.status} size="sm" />
                </div>
                <h3 className="text-sm font-bold text-white mb-2 leading-snug">{t.title}</h3>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-mono text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <Flag size={12} className="text-fuchsia-400" />
                    {t.priority}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Calendar size={12} className="text-slate-500" />
                    {t.dueDate}
                  </span>
                </div>
                <div className="mt-2.5 pt-2.5 border-t border-white/5">
                  <span className="text-[11px] font-mono text-cyan-400">{getProjectName(t.projectId)}</span>
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
      )}
    </div>
    );
  };

  /* ───────── My Projects Tab ───────── */
  const PROJECT_STATUSES: ProjectStatus[] = ['Draft', 'Active', 'On Hold', 'Archived', 'Pending Approval', 'Completed'];
  const renderMyProjects = () => {
    const filtered = projectStatusFilter ? dateFilteredProjects.filter((p) => p.status === projectStatusFilter) : dateFilteredProjects;
    return (
    <div>
      <SectionHeader icon={FolderKanban} label="My Projects" count={filtered.length} />
      <StatusFilter value={projectStatusFilter} onChange={setProjectStatusFilter} options={PROJECT_STATUSES} allLabel="All statuses" />
      {filtered.length === 0 ? (
        <EmptyState icon={FolderKanban} title="No projects yet" message="Projects you belong to will appear here." />
      ) : (
        <div className="max-h-[450px] overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((p) => (
              <GlassCard key={p.id} glowColor="cyan" onClick={() => onNavigate?.('projects')}>
                <div className="flex items-start justify-between gap-2 mb-2.5">
                  <span className="font-mono text-[11px] text-cyan-400 font-bold shrink-0">{p.code}</span>
                  <StatusBadge status={p.status} size="sm" />
                </div>
                <h3 className="text-sm font-bold text-white mb-1.5">{p.title}</h3>
                <p className="text-[11px] text-slate-400 line-clamp-2 mb-3 leading-relaxed">{p.description}</p>
                <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500 flex-wrap pt-2.5 border-t border-white/5">
                  <span>{p.startDate} → {p.targetDate}</span>
                  {p.teamLeadId === currentUser.id && (
                    <span className="text-amber-400 flex items-center gap-1">
                      <Trophy size={11} /> Lead
                    </span>
                  )}
                </div>
              </GlassCard>
            ))}
          </div>
        </div>
      )}
    </div>
    );
  };

  /* ───────── Overview Tab ───────── */
  const renderOverview = () => {
    const today = new Date().toISOString().slice(0, 10);
    const todayAttendance = dateFilteredAttendance.find((r) => r.date === today);
    const recentActivity = dateFilteredActivity.slice(0, 5);
    const unreadCount = dateFilteredNotifications.filter((n) => !n.read).length;
    const rol = currentUser.role;

    if (rol === 'Admin') {
      return (
        <div className="space-y-5">
          <div className="glass-panel p-5 border border-white/5">
            <SectionHeader icon={Shield} label="Account Overview" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <p className="text-slate-500 font-semibold uppercase tracking-wider mb-1">Role</p>
                <p className="text-white font-bold">Administrator</p>
              </div>
              <div>
                <p className="text-slate-500 font-semibold uppercase tracking-wider mb-1">Department</p>
                <p className="text-white font-bold">{currentUser.department}</p>
              </div>
              <div>
                <p className="text-slate-500 font-semibold uppercase tracking-wider mb-1">Status</p>
                <StatusBadge status={currentUser.status} size="sm" />
              </div>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-1 gap-3">
            <div className="glass-panel p-4 border border-white/5">
              <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Unread Notifications</p>
              <p className="text-2xl font-bold text-white">{unreadCount}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{dateFilteredNotifications.length} total</p>
            </div>
          </div>
        </div>
      );
    }

    if (rol === 'HR') {
      return (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="glass-panel p-4 border border-white/5">
              <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-1">My Attendance</p>
              <p className="text-2xl font-bold text-white">
                {todayAttendance ? todayAttendance.status : '—'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">{dateFilteredAttendance.length} records total</p>
            </div>
            <div className="glass-panel p-4 border border-white/5">
              <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Notifications</p>
              <p className="text-2xl font-bold text-white">{dateFilteredNotifications.length}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{unreadCount} unread</p>
            </div>
          </div>
          <div className="glass-panel p-5 border border-white/5">
            <SectionHeader icon={Shield} label="Account Overview" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <p className="text-slate-500 font-semibold uppercase tracking-wider mb-1">Role</p>
                <p className="text-white font-bold">HR</p>
              </div>
              <div>
                <p className="text-slate-500 font-semibold uppercase tracking-wider mb-1">Department</p>
                <p className="text-white font-bold">{currentUser.department}</p>
              </div>
              <div>
                <p className="text-slate-500 font-semibold uppercase tracking-wider mb-1">Status</p>
                <StatusBadge status={currentUser.status} size="sm" />
              </div>
            </div>
          </div>
          {recentActivity.length > 0 && (
            <div className="glass-panel p-5 border border-white/5">
              <SectionHeader icon={ActivityIcon} label="Recent Activity" />
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {recentActivity.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 text-xs">
                    <span className="text-slate-500 font-mono shrink-0 w-16">{log.timestampLabel || log.timestamp}</span>
                    <span className="text-slate-300">{log.action}</span>
                    <span className="text-cyan-400 truncate">{log.targetTitle}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    if (rol === 'Team_Lead') {
      const activeProjects = projectsLed.filter((p) => p.status === 'Active');
      const activeTasks = dateFilteredTasks.filter((t) => t.status !== 'Done');
      const deadlinesSoon = dateFilteredDeadlines.slice(0, 5);
      return (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="glass-panel p-4 border border-white/5">
              <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Projects Led</p>
              <p className="text-2xl font-bold text-white">{projectsLed.length}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{activeProjects.length} active</p>
            </div>
            <div className="glass-panel p-4 border border-white/5">
              <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-1">My Tasks</p>
              <p className="text-2xl font-bold text-white">{dateFilteredTasks.length}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{activeTasks.length} active</p>
            </div>
            <div className="glass-panel p-4 border border-white/5">
              <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Attendance</p>
              <p className="text-2xl font-bold text-white">
                {todayAttendance ? todayAttendance.status : '—'}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">{dateFilteredAttendance.length} records</p>
            </div>
            <div className="glass-panel p-4 border border-white/5">
              <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Deadlines</p>
              <p className="text-2xl font-bold text-white">{dateFilteredDeadlines.length}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">{deadlinesSoon.length} upcoming</p>
            </div>
          </div>
          {recentActivity.length > 0 && (
            <div className="glass-panel p-5 border border-white/5">
              <SectionHeader icon={ActivityIcon} label="Recent Activity" />
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {recentActivity.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 text-xs">
                    <span className="text-slate-500 font-mono shrink-0 w-16">{log.timestampLabel || log.timestamp}</span>
                    <span className="text-slate-300">{log.action}</span>
                    <span className="text-cyan-400 truncate">{log.targetTitle}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="glass-panel p-4 border border-white/5">
            <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-1">My Projects</p>
            <p className="text-2xl font-bold text-white">{dateFilteredProjects.length}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {dateFilteredProjects.filter((p) => p.status === 'Active').length} active
            </p>
          </div>
          <div className="glass-panel p-4 border border-white/5">
            <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-1">My Tasks</p>
            <p className="text-2xl font-bold text-white">{dateFilteredTasks.length}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {dateFilteredTasks.filter((t) => t.status !== 'Done').length} active
            </p>
          </div>
          <div className="glass-panel p-4 border border-white/5">
            <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Attendance</p>
            <p className="text-2xl font-bold text-white">
              {todayAttendance ? todayAttendance.status : '—'}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">{dateFilteredAttendance.length} records</p>
          </div>
          <div className="glass-panel p-4 border border-white/5">
            <p className="text-[11px] text-slate-500 font-semibold uppercase tracking-wider mb-1">Notifications</p>
            <p className="text-2xl font-bold text-white">{dateFilteredNotifications.length}</p>
            <p className="text-[11px] text-slate-500 mt-0.5">{unreadCount} unread</p>
          </div>
        </div>
        {recentActivity.length > 0 && (
          <div className="glass-panel p-5 border border-white/5">
            <SectionHeader icon={ActivityIcon} label="Recent Activity" />
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {recentActivity.map((log) => (
                <div key={log.id} className="flex items-start gap-3 text-xs">
                  <span className="text-slate-500 font-mono shrink-0 w-16">{log.timestampLabel || log.timestamp}</span>
                  <span className="text-slate-300">{log.action}</span>
                  <span className="text-cyan-400 truncate">{log.targetTitle}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ───────── My Attendance Tab ───────── */
  const renderMyAttendance = () => (
    <div>
      <SectionHeader icon={Clock} label="My Attendance" count={dateFilteredAttendance.length} />
      {profileAttendanceLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={22} className="text-cyan-400 animate-spin" />
        </div>
      ) : profileAttendanceError ? (
        <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center gap-2 text-xs text-rose-300">
          <AlertCircle size={14} />
          <span>{profileAttendanceError}</span>
        </div>
      ) : dateFilteredAttendance.length === 0 ? (
        <EmptyState icon={Clock} title="No attendance records" message="Your attendance records in the selected date range will appear here." />
      ) : (
        <div className="max-h-[400px] overflow-y-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-slate-500 border-b border-white/5">
                <th className="text-left py-2 px-3 font-semibold sticky top-0 bg-[var(--surface-glass)]">Date</th>
                <th className="text-left py-2 px-3 font-semibold sticky top-0 bg-[var(--surface-glass)]">Check In</th>
                <th className="text-left py-2 px-3 font-semibold sticky top-0 bg-[var(--surface-glass)]">Check Out</th>
                <th className="text-left py-2 px-3 font-semibold sticky top-0 bg-[var(--surface-glass)]">Hours</th>
                <th className="text-left py-2 px-3 font-semibold sticky top-0 bg-[var(--surface-glass)]">Status</th>
                <th className="text-left py-2 px-3 font-semibold sticky top-0 bg-[var(--surface-glass)]">Breaks</th>
              </tr>
            </thead>
            <tbody>
              {dateFilteredAttendance.map((r) => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="py-2.5 px-3 text-white">{r.date}</td>
                  <td className="py-2.5 px-3 text-slate-300">{r.checkIn}</td>
                  <td className="py-2.5 px-3 text-slate-300">{r.checkOut || '—'}</td>
                  <td className="py-2.5 px-3 text-slate-300">{r.totalHours.toFixed(1)}h</td>
                  <td className="py-2.5 px-3">
                    <StatusBadge status={r.status} size="sm" />
                  </td>
                  <td className="py-2.5 px-3 text-slate-400">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  /* ───────── Upcoming Deadlines Tab ───────── */
  const renderUpcomingDeadlines = () => (
    <div>
      <SectionHeader icon={Calendar} label="Upcoming Deadlines" count={filteredUpcomingDeadlines.length} />
      <DeadlineFilter value={deadlineFilter} onChange={setDeadlineFilter} allLabel="All Deadlines" />
      {filteredUpcomingDeadlines.length === 0 ? (
        <EmptyState icon={Calendar} title="No upcoming deadlines" message="Deadlines from your assigned tasks will appear here." />
      ) : (
        <>
          <div className="max-h-[400px] overflow-y-auto space-y-2">
          {filteredUpcomingDeadlines.map((dl) => {
            const dayLabel = daysUntil(dl.date);
            const isOverdue = dayLabel.includes('overdue');
            const task = tasks.find((t) => t.id === dl.taskId);
            return (
              <div
                key={dl.id}
                role="button"
                tabIndex={0}
                onClick={() => onNavigate?.('tasks', dl.taskId)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate?.('tasks', dl.taskId); } }}
                className={`p-4 rounded-xl bg-slate-800/40 border flex items-start justify-between gap-4 cursor-pointer transition-colors hover:bg-slate-800/60 ${
                  isOverdue ? 'border-rose-500/25' : 'border-white/5'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2.5 mb-1">
                    <span className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full ${
                      isOverdue
                        ? 'bg-rose-500/15 text-rose-400'
                        : 'bg-fuchsia-500/15 text-fuchsia-400'
                    }`}>
                      Task
                    </span>
                    <span className="text-[11px] font-mono text-cyan-400 truncate">{dl.projectName}</span>
                  </div>
                  <h3 className="text-sm font-bold text-white truncate">{dl.title}</h3>
                  {task && (
                    <span className="text-[11px] text-slate-500 mt-1 block">
                      {task.status} · {task.priority}
                    </span>
                  )}
                </div>
                <span className={`text-[11px] font-mono shrink-0 font-bold mt-1 ${
                  isOverdue ? 'text-rose-400' : dayLabel === 'Today' ? 'text-amber-400' : 'text-emerald-400'
                }`}>
                  {dl.date}
                  <span className="block text-right">{dayLabel}</span>
                </span>
              </div>
            );
          })}
          </div>
          {onNavigate && (
            <button
              onClick={() => onNavigate('reports', 'deadlines')}
              className="mt-3 w-full py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs font-semibold text-cyan-300 hover:bg-white/[0.08] transition-colors"
            >
              View All Deadlines
            </button>
          )}
        </>
      )}
    </div>
  );

  /* ───────── Activity Tab ───────── */
  const renderActivity = () => (
    <div>
      <SectionHeader icon={ActivityIcon} label="Activity" count={dateFilteredActivity.length} />
      {profileActivityLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 size={22} className="text-cyan-400 animate-spin" />
        </div>
      ) : profileActivityError ? (
        <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center gap-2 text-xs text-rose-300">
          <AlertCircle size={14} />
          <span>{profileActivityError}</span>
        </div>
      ) : dateFilteredActivity.length === 0 ? (
        <EmptyState icon={ActivityIcon} title="No activity yet" message="Your recent activity will appear here." />
      ) : (
        <>
          <div className="max-h-[400px] overflow-y-auto space-y-1">
            {dateFilteredActivity.slice(0, 30).map((log) => (
              <div
                key={log.id}
                role="button"
                tabIndex={0}
                onClick={() => onNavigate?.('activity')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNavigate?.('activity'); } }}
                className="flex items-start gap-3 p-3 rounded-lg hover:bg-white/[0.02] cursor-pointer transition-colors"
              >
                <div className="p-1.5 rounded-full bg-slate-800/60 shrink-0 mt-0.5">
                  <ActivityIcon size={12} className="text-cyan-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-slate-300">
                    <span className="font-semibold text-white">{log.userName}</span>
                    {' '}{log.action}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {log.targetTitle}
                    {log.diff && ` — ${log.diff.field}: ${log.diff.oldVal} → ${log.diff.newVal}`}
                  </p>
                </div>
                <span className="text-[11px] text-slate-500 shrink-0 font-mono">{log.timestampLabel || log.timestamp}</span>
              </div>
            ))}
          </div>
          {(profileActivityTotal > 30 || dateFilteredActivity.length > 30) && onNavigate && (
            <button
              onClick={() => onNavigate('activity')}
              className="mt-3 w-full py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs font-semibold text-cyan-300 hover:bg-white/[0.08] transition-colors"
            >
              View All Activity
            </button>
          )}
        </>
      )}
    </div>
  );

  /* ───────── Notifications Tab ───────── */
  const renderNotifications = () => (
    <div>
      <SectionHeader icon={Bell} label="Notifications" count={dateFilteredNotifications.length} />
      {dateFilteredNotifications.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications" message="Your notifications will appear here." />
      ) : (
        <>
          <div className="max-h-[400px] overflow-y-auto space-y-1">
            {dateFilteredNotifications.slice(0, 30).map((n) => (
              <div
                key={n.id}
                role="button"
                tabIndex={0}
                onClick={() => onNavigate?.(notificationTarget(n.linkRoute))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onNavigate?.(notificationTarget(n.linkRoute));
                  }
                }}
                className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                  !n.read ? 'bg-cyan-500/5 border-l-2 border-cyan-500/40' : 'hover:bg-white/[0.02] border-l-2 border-transparent'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className={`text-xs ${!n.read ? 'text-white font-semibold' : 'text-slate-300'}`}>
                    {n.title}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-0.5">{n.message}</p>
                </div>
                <span className="text-[11px] text-slate-500 shrink-0 font-mono">{n.timestamp}</span>
              </div>
            ))}
          </div>
          {dateFilteredNotifications.length > 30 && onNavigate && (
            <button
              onClick={() => onNavigate('notifications')}
              className="mt-3 w-full py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs font-semibold text-cyan-300 hover:bg-white/[0.08] transition-colors"
            >
              View All Notifications
            </button>
          )}
        </>
      )}
    </div>
  );

  /* ───────── Account & Security Tab ───────── */
  const renderAccountSecurity = () => {
    const isAdmin = currentUser.role === 'Admin';
    const ownAccountChangeRequests = getOwnAccountChangeRequests(
      accountChangeRequests,
      currentUser.id
    );

    if (isAdmin) {
      return (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-panel p-6 border border-white/5">
            <div className="flex items-center gap-2.5 mb-6">
              <div className="p-2 rounded-lg bg-slate-800/80">
                <UserIcon size={16} className="text-cyan-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Profile Settings</h2>
                <p className="text-[11px] text-slate-500">Manage your display name, username, and email.</p>
              </div>
            </div>

            <div>
              <label className="text-[11px] text-slate-500 font-medium block mb-1">Display Name</label>
              <p className="text-[10px] text-slate-600 mb-3">This changes how your name appears across the application.</p>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => {
                  setNameInput(e.target.value);
                  setNameError(null);
                  setNameSuccess(null);
                }}
                className="w-full bg-slate-900/80 border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-500/50 transition-colors"
                placeholder="Enter new display name"
              />
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={handleDisplayNameSave}
                  disabled={nameLoading || !nameInput.trim()}
                  className="px-4 py-2 rounded-lg glass-button-neon text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-all"
                >
                  {nameLoading ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {nameLoading ? 'Saving...' : 'Save Changes'}
                </button>
                {nameSuccess && (
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={12} /> {nameSuccess}
                  </span>
                )}
              </div>
              {nameError && (
                <p className="text-[11px] text-rose-400 mt-2 flex items-center gap-1">
                  <AlertCircle size={12} /> {nameError}
                </p>
              )}
            </div>

            <div className="mt-6">
              <label className="text-[11px] text-slate-500 font-medium block mb-1">Username</label>
              <p className="text-[10px] text-slate-600 mb-3">This is your unique login identifier.</p>
              <input
                type="text"
                value={usernameInput}
                onChange={(e) => {
                  setUsernameInput(e.target.value);
                  setUsernameError(null);
                  setUsernameSuccess(null);
                }}
                className="w-full bg-slate-900/80 border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-500/50 transition-colors font-mono"
                placeholder="Enter new username"
              />
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={handleUsernameSave}
                  disabled={usernameLoading || !usernameInput.trim()}
                  className="px-4 py-2 rounded-lg glass-button-neon text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-all"
                >
                  {usernameLoading ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {usernameLoading ? 'Saving...' : 'Save Changes'}
                </button>
                {usernameSuccess && (
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={12} /> {usernameSuccess}
                  </span>
                )}
              </div>
              {usernameError && (
                <p className="text-[11px] text-rose-400 mt-2 flex items-center gap-1">
                  <AlertCircle size={12} /> {usernameError}
                </p>
              )}
            </div>

            <div className="mt-6">
              <label className="text-[11px] text-slate-500 font-medium block mb-1">Email</label>
              <p className="text-[10px] text-slate-600 mb-3">This changes your account email address.</p>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => {
                  setEmailInput(e.target.value);
                  setEmailError(null);
                  setEmailSuccess(null);
                }}
                className="w-full bg-slate-900/80 border border-white/10 rounded-lg px-3.5 py-2 text-sm text-white outline-none focus:border-cyan-500/50 transition-colors"
                placeholder="Enter new email address"
              />
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={handleEmailSave}
                  disabled={emailLoading || !emailInput.trim()}
                  className="px-4 py-2 rounded-lg glass-button-neon text-xs font-semibold flex items-center gap-1.5 disabled:opacity-40 transition-all"
                >
                  {emailLoading ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  {emailLoading ? 'Saving...' : 'Save Changes'}
                </button>
                {emailSuccess && (
                  <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={12} /> {emailSuccess}
                  </span>
                )}
              </div>
              {emailError && (
                <p className="text-[11px] text-rose-400 mt-2 flex items-center gap-1">
                  <AlertCircle size={12} /> {emailError}
                </p>
              )}
            </div>
          </div>

          <div className="glass-panel p-6 border border-white/5">
            <div className="flex items-center gap-2.5 mb-6">
              <div className="p-2 rounded-lg bg-slate-800/80">
                <Shield size={16} className="text-cyan-400" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-white">Security</h2>
                <p className="text-[11px] text-slate-500">Manage your password and account security.</p>
              </div>
            </div>

            <div>
              <button
                onClick={() => {
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setPasswordExpanded(!passwordExpanded);
                  setPasswordError(null);
                  setPasswordSuccess(null);
                }}
                className="w-full flex items-center justify-between py-2 text-left"
              >
                <div>
                  <h3 className="text-sm font-bold text-white">Change Password</h3>
                  <p className="text-[11px] text-slate-500">Update your account password.</p>
                </div>
                <ChevronRight size={16} className={`text-slate-400 transition-transform duration-200 ${passwordExpanded ? 'rotate-90' : ''}`} />
              </button>

              {passwordExpanded && (
                <div className="space-y-4 pt-4 mt-3 border-t border-white/5">
                  <div>
                    <label className="text-[11px] text-slate-500 font-medium block mb-1.5">Current Password</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      autoComplete="off"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-slate-200 text-xs placeholder-slate-600 focus:outline-none focus:border-cyan-400/50 transition-colors"
                      placeholder="Enter current password"
                      disabled={passwordLoading}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 font-medium block mb-1.5">New Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      autoComplete="new-password"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-slate-200 text-xs placeholder-slate-600 focus:outline-none focus:border-cyan-400/50 transition-colors"
                      placeholder="Enter new password (min 6 characters)"
                      disabled={passwordLoading}
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-slate-500 font-medium block mb-1.5">Confirm New Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={e => setConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-slate-200 text-xs placeholder-slate-600 focus:outline-none focus:border-cyan-400/50 transition-colors"
                      placeholder="Re-enter new password"
                      disabled={passwordLoading}
                    />
                  </div>
                  <button
                    onClick={handlePasswordChange}
                    disabled={passwordLoading}
                    className="w-full py-2.5 rounded-lg glass-button-neon text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 transition-all"
                  >
                    {passwordLoading ? (
                      <span className="flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" /> Updating...
                      </span>
                    ) : (
                      'Change Password'
                    )}
                  </button>
                  {passwordSuccess && (
                    <p className="text-[11px] text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 size={12} /> {passwordSuccess}
                    </p>
                  )}
                  {passwordError && (
                    <p className="text-[11px] text-rose-400 flex items-center gap-1">
                      <AlertCircle size={12} /> {passwordError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="glass-panel p-6 border border-white/5">
          <div className="flex items-center gap-2.5 mb-6">
            <div className="p-2 rounded-lg bg-slate-800/80">
              <Lock size={16} className="text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Account Information</h2>
              <p className="text-[11px] text-slate-500">Your account details are managed by administrators.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-[11px] text-slate-500 font-medium block mb-1">Display Name</label>
              <div className="w-full bg-slate-900/60 border border-white/5 rounded-lg px-3.5 py-2 text-sm text-slate-300">
                {currentUser.name}
              </div>
            </div>
            {currentUser.username && (
              <div>
                <label className="text-[11px] text-slate-500 font-medium block mb-1">Username</label>
                <div className="w-full bg-slate-900/60 border border-white/5 rounded-lg px-3.5 py-2 text-sm text-slate-300 font-mono">
                  {currentUser.username}
                </div>
              </div>
            )}
            <div>
              <label className="text-[11px] text-slate-500 font-medium block mb-1">Email</label>
              <div className="w-full bg-slate-900/60 border border-white/5 rounded-lg px-3.5 py-2 text-sm text-slate-300">
                {currentUser.email}
              </div>
            </div>
          </div>
        </div>

        {/* Collapsible Change Password — Admin only (hidden for HR, Lead, Member) */}
        {currentUser.role === 'Admin' && (
        <div>
          <button
            onClick={() => {
              setRequestExpanded(!requestExpanded);
              setRequestError(null);
              setRequestSuccess(null);
            }}
            className="w-full flex items-center justify-between py-2 text-left"
          >
            <div>
              <h3 className="text-sm font-bold text-white">Request a Change</h3>
              <p className="text-[11px] text-slate-500">Change your name, email, username, or password.</p>
            </div>
            <ChevronRight size={16} className={`text-slate-400 transition-transform duration-200 ${requestExpanded ? 'rotate-90' : ''}`} />
          </button>

          {requestExpanded && (
            <div className="space-y-4 pt-4 mt-3 border-t border-white/5">
              <div>
                <label className="text-[11px] text-slate-500 font-medium block mb-1.5">What do you want to change? <span className="text-rose-400">*</span></label>
                <select
                  value={requestField}
                  onChange={(e) => {
                    setRequestField(e.target.value as typeof requestField);
                    setRequestValue('');
                    setRequestCurrentPassword('');
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-slate-200 text-xs placeholder-slate-600 focus:outline-none focus:border-cyan-400/50 transition-colors"
                  disabled={requestLoading}
                >
                  <option value="">Select a field...</option>
                  <option value="name">Display Name</option>
                  <option value="email">Email</option>
                  <option value="username">Username</option>
                  <option value="password">Password</option>
                </select>
              </div>
              {requestField && requestField !== 'password' && (
                <div>
                  <label className="text-[11px] text-slate-500 font-medium block mb-1.5">
                    New {requestField === 'name' ? 'Display Name' : requestField === 'email' ? 'Email' : 'Username'} <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type={requestField === 'email' ? 'email' : 'text'}
                    value={requestValue}
                    onChange={e => setRequestValue(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-slate-200 text-xs placeholder-slate-600 focus:outline-none focus:border-cyan-400/50 transition-colors"
                    placeholder={requestField === 'email' ? 'Enter the new email address' : requestField === 'username' ? 'Enter the new username' : 'Enter the new display name'}
                    disabled={requestLoading}
                  />
                </div>
              )}
              {requestField === 'password' && (
                <div>
                  <label className="text-[11px] text-slate-500 font-medium block mb-1.5">Current Password <span className="text-rose-400">*</span></label>
                  <input
                    type="password"
                    value={requestCurrentPassword}
                    onChange={e => setRequestCurrentPassword(e.target.value)}
                    autoComplete="off"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-slate-200 text-xs placeholder-slate-600 focus:outline-none focus:border-cyan-400/50 transition-colors"
                    placeholder="Enter current password"
                    disabled={requestLoading}
                  />
                  <p className="text-[10px] text-slate-500 mt-1">Your current password is used only to verify your identity. The approved administrator will set your new password later.</p>
                </div>
              )}
              <div>
                <label className="text-[11px] text-slate-500 font-medium block mb-1.5">
                  Reason <span className="text-rose-400">*</span>
                </label>
                <textarea
                  value={requestReason}
                  onChange={e => setRequestReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-slate-200 text-xs placeholder-slate-600 focus:outline-none focus:border-cyan-400/50 transition-colors resize-none"
                  placeholder="Why do you need this change?"
                  rows={3}
                  disabled={requestLoading}
                />
              </div>
              <button
                onClick={handleRequestSubmit}
                disabled={requestLoading}
                className="w-full py-2.5 rounded-lg glass-button-neon text-xs font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 transition-all"
              >
                {requestLoading ? (
                  <span className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin" /> Submitting...
                  </span>
                ) : (
                  <>
                    <Send size={13} /> Submit Request
                  </>
                )}
              </button>
            </div>
          )}
        </div>
        )}
      </div>

        <div className="glass-panel border border-white/5 p-6 lg:col-span-2">
          <div className="mb-5 flex items-center gap-2.5">
            <div className="rounded-lg bg-slate-800/80 p-2">
              <Inbox size={16} className="text-cyan-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">My Change Requests</h2>
              <p className="text-[11px] text-slate-500">Track your submitted account change requests.</p>
            </div>
          </div>

          {ownAccountChangeRequests.length === 0 ? (
            <p className="rounded-lg border border-white/5 bg-slate-950/30 p-4 text-xs text-slate-500">
              You have not submitted any account change requests.
            </p>
          ) : (
            <div className="space-y-3">
              {ownAccountChangeRequests.map((request) => (
                <div key={request.id} className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold text-slate-200">
                        {getSafeRequestedChangeLabel(request)}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Submitted: {request.submittedAt}
                      </p>
                    </div>
                    <StatusBadge status={request.status} size="sm" />
                  </div>
                  {request.status === 'Rejected' && (
                    <div className="mt-3 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-rose-300">
                        Rejection reason
                      </p>
                      <p className="mt-1 text-xs leading-5 text-slate-300">
                        {request.decisionReason || 'No reason provided.'}
                      </p>
                      <p className="mt-2 text-[11px] text-slate-500">
                        Decided: {request.decidedAt || 'Not available'}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  /* ───────── Render ───────── */
  const renderTabContent = () => {
    switch (activeTab) {
      case 'overview': return renderOverview();
      case 'my-projects': return renderMyProjects();
      case 'my-tasks': return renderMyTasks();
      case 'my-attendance': return renderMyAttendance();
      case 'upcoming-deadlines': return renderUpcomingDeadlines();
      case 'activity': return renderActivity();
      case 'notifications': return renderNotifications();
      case 'account': return renderAccountSecurity();
      default: return null;
    }
  };

  return (
    <div className="space-y-8">
      {/* Hero Section */}
      <div className="glass-panel-glow p-6 sm:p-8 border-cyan-500/30">
        <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
          <InitialsBadge size="lg" />
          <div className="min-w-0 text-center sm:text-left">
            <div className="flex items-center justify-center sm:justify-start gap-2.5 mb-2 flex-wrap">
              <h1 className="text-2xl font-extrabold text-white">{currentUser.name}</h1>
              <StatusBadge status={currentUser.role.replace('_', ' ')} size="sm" />
            </div>
            <div className="flex flex-col sm:flex-row items-center sm:items-center gap-x-5 gap-y-1 text-sm text-slate-400 font-mono mt-1">
              <span className="flex items-center gap-1.5">
                <Mail size={14} className="text-cyan-400 shrink-0" />
                {currentUser.email}
              </span>
              <span className="hidden sm:inline text-slate-600">|</span>
              <span className="flex items-center gap-1.5">
                <Briefcase size={14} className="text-purple-400 shrink-0" />
                {currentUser.department}
              </span>
              {currentUser.title && (
                <>
                  <span className="hidden sm:inline text-slate-600">|</span>
                  <span className="flex items-center gap-1.5">
                    <Shield size={14} className="text-amber-400 shrink-0" />
                    {currentUser.title}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Date Range Filter ─────────────────────────────── */}
      <div className="glass-panel p-4 sm:p-5 border border-white/5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-mono text-slate-400 uppercase">From</label>
            <input
              type="date"
              value={dateRange.from}
              max={todayStr()}
              onChange={(e) => handleDateChange('from', e.target.value)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                dateError
                  ? 'border-rose-500/60 bg-rose-500/10 text-rose-300'
                  : 'bg-slate-900/60 border-white/10 text-slate-200 hover:border-white/20'
              } focus:outline-none focus:border-cyan-500/50`}
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-mono text-slate-400 uppercase">To</label>
            <input
              type="date"
              value={dateRange.to}
              max={todayStr()}
              onChange={(e) => handleDateChange('to', e.target.value)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                dateError
                  ? 'border-rose-500/60 bg-rose-500/10 text-rose-300'
                  : 'bg-slate-900/60 border-white/10 text-slate-200 hover:border-white/20'
              } focus:outline-none focus:border-cyan-500/50`}
            />
          </div>
        </div>
        {dateError && (
          <div className="mt-2 p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center gap-2 text-xs text-rose-300">
            <AlertCircle size={14} />
            <span>{dateError}</span>
          </div>
        )}
      </div>

      {/* Tabs & Content */}
      <div className="glass-panel p-4 sm:p-5 border border-white/5 space-y-5">
        {renderTabNav()}
        <div className="border-t border-white/5" />
        {renderTabContent()}
      </div>
    </div>
  );
};
