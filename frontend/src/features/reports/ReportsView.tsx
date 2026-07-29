import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { GlassCard } from '../../components/common/GlassCard';
import { StatusBadge } from '../../components/common/StatusBadge';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
  AreaChart,
  Area
} from 'recharts';
import {
  BarChart3,
  FolderKanban,
  CheckSquare,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Users,
  Calendar,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  ChevronDown,
  ChevronUp,
  Activity,
  Target,
  UserCheck,
  UserX,
  Coffee,
  Hourglass,
  ListTodo,
  ArrowUpRight,
  ArrowDownRight,
  Paperclip,
  FileImage,
  Circle,
  Search,
  X,
  ArrowLeft,
  Filter,
  User,
  CalendarDays,
  History,
  ExternalLink,
  ClipboardList
} from 'lucide-react';

type ReportTab = 'overview' | 'projects' | 'teams' | 'tasks' | 'workload' | 'deadlines' | 'attendance' | 'export';

interface DateRange {
  from: string;
  to: string;
}

function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

function validateDateRange(from: string, to: string): string | null {
  const today = todayStr();
  if (from > today) return 'From Date cannot be in the future.';
  if (to > today) return 'To Date cannot be in the future.';
  if (to < from) return 'To Date cannot be earlier than From Date.';
  return null;
}

function isInDateRange(dateStr: string, from: string, to: string): boolean {
  if (!dateStr) return false;
  const d = dateStr.slice(0, 10);
  return d >= from && d <= to;
}

function prepareCsv(headers: string[], rows: string[][]): string {
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const headerLine = headers.map(escape).join(',');
  const rowLines = rows.map((row) => row.map(escape).join(','));
  return [headerLine, ...rowLines].join('\n');
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatDateLabel(value: string | number): string {
  if (!value) return '';
  const datePart = String(value).slice(0, 5);
  const [m, d] = datePart.split('-');
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${d}`;
}

function downloadBlob(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="glass-panel rounded-xl px-3 py-2 text-xs">
      <p className="font-mono text-slate-400 mb-1.5">{label}</p>
      {payload.map((entry: any, idx: number) => (
        <p key={idx} className="font-mono" style={{ color: entry.color }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

export const ReportsView: React.FC = () => {
  const { currentRole, currentUser, projects, tasks, users, attendanceRecords, hrRequests, theme } = useApp();

  const [activeTab, setActiveTab] = useState<ReportTab>('overview');
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const to = todayStr();
    const from = new Date(Date.now() - 29 * 86400000).toISOString().split('T')[0];
    return { from, to };
  });
  const [validationError, setValidationError] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [detailProject, setDetailProject] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<any>(null);
  const [detailTaskLoading, setDetailTaskLoading] = useState(false);
  const [taskSearchQuery, setTaskSearchQuery] = useState('');
  const [taskFilterStatus, setTaskFilterStatus] = useState('');
  const [taskFilterPriority, setTaskFilterPriority] = useState('');
  const [taskFilterProject, setTaskFilterProject] = useState('');
  const [taskFilterAssignee, setTaskFilterAssignee] = useState('');
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [detailMember, setDetailMember] = useState<any>(null);
  const [detailMemberLoading, setDetailMemberLoading] = useState(false);
  const [workloadSearchQuery, setWorkloadSearchQuery] = useState('');
  const [workloadFilterRole, setWorkloadFilterRole] = useState('');
  const [workloadFilterWorkload, setWorkloadFilterWorkload] = useState('');

  // ── API data fetch ──────────────────────────────────────────────────
  const [reportData, setReportData] = useState<any>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  useEffect(() => {
    const fetchReports = async () => {
      setReportLoading(true);
      setReportError(null);

      const token = localStorage.getItem('worksync_auth_token');
      if (!token) {
        setReportError('Sign in required to load report data.');
        setReportData(null);
        setReportLoading(false);
        return;
      }

      try {
        const res = await fetch(
          `/api/reports/data?from=${encodeURIComponent(dateRange.from)}&to=${encodeURIComponent(dateRange.to)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const json = await res.json();
        if (json.success) {
          setReportData(json.data);
        } else {
          setReportError(json.message || 'Failed to load report data.');
          setReportData(null);
        }
      } catch {
        setReportError('Report API unavailable — showing local fallback.');
        setReportData(null);
      }
      setReportLoading(false);
    };
    fetchReports();
  }, [dateRange.from, dateRange.to, currentRole]);

  const apiAvailable = reportData !== null;

  // ── Project detail fetch ─────────────────────────────────────────────
  useEffect(() => {
    if (!selectedProjectId) {
      setDetailProject(null);
      setDetailLoading(false);
      return;
    }
    const token = localStorage.getItem('worksync_auth_token');
    if (!token || !apiAvailable) {
      const p = (roleFiltered.projects as any[]).find((p: any) => p.id === selectedProjectId);
      setDetailProject(p || null);
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    fetch(`/api/projects/${selectedProjectId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => { setDetailProject(data.success ? data.data : null); })
      .catch(() => setDetailProject(null))
      .finally(() => setDetailLoading(false));
  }, [selectedProjectId, apiAvailable]);

  // ── Local fallback: date-filtered data ────────────────────────────────
  const filteredData = useMemo(() => {
    const { from, to } = dateRange;
    const validProjects = projects.filter(
      (p) => isInDateRange(p.startDate, from, to) || isInDateRange(p.targetDate, from, to) || p.status === 'Active'
    );
    const validTasks = tasks.filter(
      (t) => isInDateRange(t.dueDate, from, to) || isInDateRange(t.createdAt, from, to) || t.status !== 'Done'
    );
    const validAttendance = attendanceRecords.filter(
      (a) => isInDateRange(a.date, from, to)
    );
    const validHrRequests = hrRequests.filter(
      (r) => isInDateRange(r.submittedAt || r.date, from, to)
    );
    return { validProjects, validTasks, validAttendance, validHrRequests };
  }, [projects, tasks, attendanceRecords, hrRequests, dateRange]);

  const roleFilteredLocal = useMemo(() => {
    const { validProjects, validTasks, validAttendance, validHrRequests } = filteredData;
    const userId = currentUser.id;

    if (currentRole === 'Admin') {
      return { projects: validProjects, tasks: validTasks, attendance: validAttendance, hrRequests: validHrRequests };
    }
    if (currentRole === 'HR') {
      return {
        projects: validProjects.filter((p) => p.memberIds.includes(userId) || p.teamLeadId === userId),
        tasks: validTasks.filter((t) => t.assigneeId === userId),
        attendance: validAttendance,
        hrRequests: validHrRequests
      };
    }
    if (currentRole === 'Team_Lead') {
      const leadProjectIds = validProjects.filter((p) => p.teamLeadId === userId).map((p) => p.id);
      return {
        projects: validProjects.filter((p) => p.teamLeadId === userId),
        tasks: validTasks.filter((t) => leadProjectIds.includes(t.projectId)),
        attendance: validAttendance.filter((a) => leadProjectIds.some((_pid) => {
          const proj = validProjects.find((p) => p.id === _pid);
          return proj?.memberIds.includes(a.userId) || proj?.teamLeadId === a.userId;
        })),
        hrRequests: []
      };
    }
    return {
      projects: validProjects.filter((p) => p.memberIds.includes(userId)),
      tasks: validTasks.filter((t) => t.assigneeId === userId),
      attendance: validAttendance.filter((a) => a.userId === userId),
      hrRequests: validHrRequests.filter((r) => r.userId === userId)
    };
  }, [filteredData, currentRole, currentUser.id]);

  // ── Choose API or local fallback ──────────────────────────────────────
  const roleFiltered = useMemo(() => {
    if (apiAvailable) {
      // Build a roleFiltered-shaped object from API data
      return {
        projects: reportData.projects || [],
        tasks: tasks, // individual tasks not in API; keep local for fallback sections
        attendance: reportData.attendance?.records || [],
        hrRequests: roleFilteredLocal.hrRequests, // pending HR objects only local
      };
    }
    return roleFilteredLocal;
  }, [apiAvailable, reportData, roleFilteredLocal, tasks]);

  // ── Task detail fetch ────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedTaskId) {
      setDetailTask(null);
      setDetailTaskLoading(false);
      return;
    }
    const token = localStorage.getItem('worksync_auth_token');
    if (!token || !apiAvailable) {
      const t = roleFiltered.tasks.find((t: any) => t.id === selectedTaskId);
      setDetailTask(t || null);
      setDetailTaskLoading(false);
      return;
    }
    setDetailTaskLoading(true);
    fetch(`/api/tasks/${selectedTaskId}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => res.json())
      .then((data) => { setDetailTask(data.success ? data.data : null); })
      .catch(() => setDetailTask(null))
      .finally(() => setDetailTaskLoading(false));
  }, [selectedTaskId, apiAvailable, roleFiltered.tasks]);

  // ── Derived metrics from API when available, else from local ──────────
  const kpiStats = useMemo(() => {
    if (apiAvailable) {
      return reportData.overview;
    }
    const { projects: rp, tasks: rt } = roleFilteredLocal;
    const totalProjects = rp.length;
    const activeTasks = rt.filter((t) => t.status !== 'Done').length;
    const completedTasks = rt.filter((t) => t.status === 'Done').length;
    const overdueTasks = rt.filter((t) => t.status !== 'Done' && t.dueDate < todayStr()).length;
    const completionRate = rt.length > 0 ? Math.round((completedTasks / rt.length) * 100) : 0;
    const activeMembers = new Set(rp.flatMap((p) => p.memberIds).concat(rp.map((p) => p.teamLeadId))).size;
    return { totalProjects, activeTasks, completedTasks, overdueTasks, completionRate, activeMembers };
  }, [apiAvailable, reportData, roleFilteredLocal]);

  const projectHealthData = useMemo(() => {
    if (apiAvailable) {
      return (reportData.projects || []).map((p: any) => ({
        name: p.title.length > 20 ? p.title.slice(0, 20) + '...' : p.title,
        progress: p.progress,
      }));
    }
    const { projects: rp, tasks: rt } = roleFilteredLocal;
    return rp.map((p) => ({
      name: p.title.length > 20 ? p.title.slice(0, 20) + '...' : p.title,
      progress: p.progress,
    }));
  }, [apiAvailable, reportData, roleFilteredLocal]);

  const taskStatusDist = useMemo(() => {
    if (apiAvailable) {
      return reportData.tasks.statusDistribution;
    }
    const counts: Record<string, number> = { Todo: 0, 'In Progress': 0, Review: 0, Done: 0, Blocked: 0 };
    roleFilteredLocal.tasks.forEach((t) => { counts[t.status] = (counts[t.status] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [apiAvailable, reportData, roleFilteredLocal]);

  const taskPriorityDist = useMemo(() => {
    if (apiAvailable) {
      return reportData.tasks.priorityDistribution;
    }
    const counts: Record<string, number> = { Low: 0, Medium: 0, High: 0, Urgent: 0 };
    roleFilteredLocal.tasks.forEach((t) => { counts[t.priority] = (counts[t.priority] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [apiAvailable, reportData, roleFilteredLocal]);

  const taskCompletionTrend = useMemo(() => {
    if (apiAvailable) {
      return reportData.tasks.completionTrend;
    }
    const { from, to } = dateRange;
    const days: Record<string, { completed: number; created: number }> = {};
    const start = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0];
      days[key] = { completed: 0, created: 0 };
    }
    roleFilteredLocal.tasks.forEach((t) => {
      const cKey = t.createdAt?.slice(0, 10);
      if (cKey && days[cKey]) days[cKey].created++;
      if (t.status === 'Done' && t.dueDate && days[t.dueDate]) days[t.dueDate].completed++;
    });
    return Object.entries(days).map(([date, vals]) => ({
      date: date.slice(5),
      Completed: vals.completed,
      Created: vals.created
    }));
  }, [apiAvailable, reportData, dateRange, roleFilteredLocal]);

  // ── Tasks tab derived data ──────────────────────────────────────────
  const filteredTasks = useMemo(() => {
    const tasks = roleFiltered.tasks as any[];
    return tasks.filter((t: any) => {
      if (taskSearchQuery && !t.title.toLowerCase().includes(taskSearchQuery.toLowerCase()) && !t.taskNumber?.toLowerCase().includes(taskSearchQuery.toLowerCase())) return false;
      if (taskFilterStatus && t.status !== taskFilterStatus) return false;
      if (taskFilterPriority && t.priority !== taskFilterPriority) return false;
      if (taskFilterProject && t.projectId !== taskFilterProject) return false;
      if (taskFilterAssignee && t.assigneeId !== taskFilterAssignee) return false;
      return true;
    });
  }, [roleFiltered.tasks, taskSearchQuery, taskFilterStatus, taskFilterPriority, taskFilterProject, taskFilterAssignee]);

  const taskKpiStats = useMemo(() => {
    const tasks = roleFiltered.tasks as any[];
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === 'Done').length;
    const inProgress = tasks.filter((t) => t.status === 'In Progress').length;
    const overdue = tasks.filter((t) => t.status !== 'Done' && t.dueDate < todayStr()).length;
    const todo = tasks.filter((t) => t.status === 'Todo').length;
    const review = tasks.filter((t) => t.status === 'Review').length;
    const blocked = tasks.filter((t) => t.status === 'Blocked').length;
    return { total, completed, inProgress, overdue, todo, review, blocked };
  }, [roleFiltered.tasks]);

  const taskStatusDistData = useMemo(() => {
    const counts: Record<string, number> = { Todo: 0, 'In Progress': 0, Review: 0, Done: 0, Blocked: 0 };
    roleFiltered.tasks.forEach((t: any) => { counts[t.status] = (counts[t.status] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [roleFiltered.tasks]);

  const taskPriorityDistData = useMemo(() => {
    const counts: Record<string, number> = { Low: 0, Medium: 0, High: 0, Urgent: 0 };
    roleFiltered.tasks.forEach((t: any) => { counts[t.priority] = (counts[t.priority] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [roleFiltered.tasks]);

  const taskProjectOptions = useMemo(() => {
    const projectIds = new Set((roleFiltered.tasks as any[]).map((t: any) => t.projectId));
    return [...projectIds].map((pid) => {
      const p = roleFiltered.projects.find((p: any) => p.id === pid);
      return { id: pid, name: p?.title || pid };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [roleFiltered.tasks, roleFiltered.projects]);

  const taskAssigneeOptions = useMemo(() => {
    const assigneeIds = new Set((roleFiltered.tasks as any[]).map((t: any) => t.assigneeId).filter(Boolean));
    return [...assigneeIds].map((uid) => {
      const u = users.find((u: any) => u.id === uid);
      return { id: uid, name: u?.name || uid };
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [roleFiltered.tasks, users]);

  const workloadData = useMemo(() => {
    const baseTasks = roleFiltered.tasks as any[];
    const baseProjects = roleFiltered.projects as any[];

    // Build a member-centric workload map from tasks (always derived from roleFiltered tasks)
    const memberMap: Record<string, {
      userId: string; name: string; role: string; department: string; title: string;
      avatar: string; status: string;
      active: number; completed: number; review: number; overdue: number;
      projectIds: Set<string>;
    }> = {};

    baseTasks.forEach((t: any) => {
      const uid = t.assigneeId;
      if (!uid) return;
      if (!memberMap[uid]) {
        const u = users.find((u: any) => u.id === uid);
        memberMap[uid] = {
          userId: uid,
          name: u?.name || uid,
          role: u?.role || '',
          department: u?.department || '',
          title: u?.title || '',
          avatar: u?.avatar || '',
          status: u?.status || 'active',
          active: 0, completed: 0, review: 0, overdue: 0,
          projectIds: new Set(),
        };
      }
      memberMap[uid].projectIds.add(t.projectId);
      if (t.status === 'Done') memberMap[uid].completed++;
      else if (t.status === 'Review') memberMap[uid].review++;
      else {
        memberMap[uid].active++;
        if (t.dueDate && t.dueDate < todayStr()) memberMap[uid].overdue++;
      }
    });

    // Add members from projects who might have no tasks assigned
    baseProjects.forEach((p: any) => {
      const allMemberIds = [p.teamLeadId, ...(p.memberIds || [])].filter(Boolean);
      allMemberIds.forEach((uid: string) => {
        if (!memberMap[uid]) {
          const u = users.find((u: any) => u.id === uid);
          memberMap[uid] = {
            userId: uid,
            name: u?.name || uid,
            role: u?.role || '',
            department: u?.department || '',
            title: u?.title || '',
            avatar: u?.avatar || '',
            status: u?.status || 'active',
            active: 0, completed: 0, review: 0, overdue: 0,
            projectIds: new Set([p.id]),
          };
        } else {
          memberMap[uid].projectIds.add(p.id);
        }
      });
    });

    return Object.values(memberMap)
      .map((m) => ({
        ...m,
        projectIds: [...m.projectIds] as string[],
        projectCount: m.projectIds.size,
        totalTasks: m.active + m.completed + m.review + m.overdue,
        hasTasks: m.active + m.completed + m.review + m.overdue > 0,
      }))
      .sort((a: any, b: any) => (b.active + b.review) - (a.active + a.review));
  }, [roleFiltered.tasks, roleFiltered.projects, users]);

  const workloadKpiStats = useMemo(() => {
    const members = workloadData as any[];
    const totalMembers = members.length;
    const activeMembers = members.filter((m: any) => m.active > 0).length;
    const totalActiveTasks = members.reduce((s: number, m: any) => s + (m.active || 0), 0);
    const avgActiveTasks = totalMembers > 0 ? +(totalActiveTasks / totalMembers).toFixed(1) : 0;
    const membersWithOverdue = members.filter((m: any) => m.overdue > 0).length;
    return { totalMembers, activeMembers, totalActiveTasks, avgActiveTasks, membersWithOverdue };
  }, [workloadData]);

  const filteredWorkloadMembers = useMemo(() => {
    let members = workloadData as any[];
    if (workloadSearchQuery) {
      const q = workloadSearchQuery.toLowerCase();
      members = members.filter((m: any) =>
        m.name.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q) ||
        m.department.toLowerCase().includes(q)
      );
    }
    if (workloadFilterRole) {
      members = members.filter((m: any) => m.role === workloadFilterRole);
    }
    if (workloadFilterWorkload) {
      members = members.filter((m: any) => m.workloadLabel === workloadFilterWorkload);
    }
    return members;
  }, [workloadData, workloadSearchQuery, workloadFilterRole, workloadFilterWorkload]);

  const workloadRoleOptions = useMemo(() => {
    const roles = new Set((workloadData as any[]).map((m: any) => m.role).filter(Boolean));
    return [...roles].sort();
  }, [workloadData]);

  const workloadWorkloadOptions = ['Light', 'Moderate', 'Heavy'];

  // ── Member detail fetch ─────────────────────────────────────────────
  useEffect(() => {
    if (!selectedMemberId) {
      setDetailMember(null);
      setDetailMemberLoading(false);
      return;
    }
    const m = workloadData.find((w: any) => w.userId === selectedMemberId);
    setDetailMember(m || null);
    setDetailMemberLoading(false);
  }, [selectedMemberId, workloadData]);

  const deadlineData = useMemo(() => {
    if (apiAvailable) {
      return reportData.deadlines;
    }
    const { tasks: rt } = roleFilteredLocal;
    const today = todayStr();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];
    const dueToday = rt.filter((t) => t.status !== 'Done' && t.dueDate === today);
    const dueTomorrow = rt.filter((t) => t.status !== 'Done' && t.dueDate === tomorrow);
    const upcoming = rt.filter((t) => t.status !== 'Done' && t.dueDate > tomorrow && t.dueDate <= weekFromNow);
    const overdue = rt.filter((t) => t.status !== 'Done' && t.dueDate < today);
    return { dueToday, dueTomorrow, upcoming, overdue };
  }, [apiAvailable, reportData, roleFilteredLocal]);

  const attendanceStats = useMemo(() => {
    if (apiAvailable && reportData.attendance) {
      const a = reportData.attendance;
      return {
        present: a.present, late: a.late, absent: a.absent,
        onLeave: a.onLeave, halfDay: a.halfDay,
        avgHours: a.avgHours,
        total: a.total,
        pendingCorrections: a.pendingCorrections,
        pendingLeaves: a.pendingLeaves,
      };
    }
    const { attendance: att } = roleFilteredLocal;
    const present = att.filter((a) => a.status === 'Present').length;
    const late = att.filter((a) => a.status === 'Late').length;
    const absent = att.filter((a) => a.status === 'Absent').length;
    const onLeave = att.filter((a) => a.status === 'On Leave').length;
    const halfDay = att.filter((a) => a.status === 'Half Day').length;
    const totalHours = att.reduce((sum, a) => sum + (a.totalHours || 0), 0);
    const avgHours = att.length > 0 ? (totalHours / att.length).toFixed(1) : '0';
    const pendingCorrections = roleFilteredLocal.hrRequests.filter((r) => r.type === 'Correction' && r.status === 'Pending').length;
    const pendingLeaves = roleFilteredLocal.hrRequests.filter((r) => r.type === 'Leave' && r.status === 'Pending').length;
    return { present, late, absent, onLeave, halfDay, avgHours, total: att.length, pendingCorrections, pendingLeaves };
  }, [apiAvailable, reportData, roleFilteredLocal]);

  const hrOverviewStats = useMemo(() => {
    if (apiAvailable && reportData.hrOverviewStats) {
      return reportData.hrOverviewStats;
    }
    const today = todayStr();
    const todayAtt = filteredData.validAttendance.filter((a) => a.date === today);
    const presentToday = todayAtt.filter((a) => a.status === 'Present').length;
    const absentToday = todayAtt.filter((a) => a.status === 'Absent').length;
    const onLeaveToday = todayAtt.filter((a) => a.status === 'On Leave').length;
    const lateToday = todayAtt.filter((a) => a.status === 'Late').length;
    const avgHours = todayAtt.length > 0
      ? (todayAtt.reduce((s, a) => s + (a.totalHours || 0), 0) / todayAtt.length).toFixed(1)
      : '0';
    const pendingLeaveReqs = filteredData.validHrRequests.filter((r) => r.type === 'Leave' && r.status === 'Pending').length;
    const pendingCorrections = filteredData.validHrRequests.filter((r) => r.type === 'Correction' && r.status === 'Pending').length;
    return { presentToday, absentToday, onLeaveToday, lateToday, avgHours, pendingLeaveReqs, pendingCorrections };
  }, [apiAvailable, reportData, filteredData]);

  const teamStats = useMemo(() => {
    if (apiAvailable) {
      return reportData.teams || [];
    }
    const { projects: rp, tasks: rt } = roleFilteredLocal;
    const deptMap: Record<string, { members: Set<string>; projects: number; tasks: number; completed: number }> = {};
    rp.forEach((p) => {
      p.memberIds.forEach((mid) => {
        const u = users.find((u) => u.id === mid);
        const dept = u?.department || 'Unknown';
        if (!deptMap[dept]) deptMap[dept] = { members: new Set(), projects: 0, tasks: 0, completed: 0 };
        deptMap[dept].members.add(mid);
        deptMap[dept].projects++;
      });
    });
    rt.forEach((t) => {
      const p = rp.find((p) => p.id === t.projectId);
      if (p) {
        const u = users.find((u) => u.id === t.assigneeId);
        const dept = u?.department || 'Unknown';
        if (deptMap[dept]) {
          deptMap[dept].tasks++;
          if (t.status === 'Done') deptMap[dept].completed++;
        }
      }
    });
    return Object.entries(deptMap).map(([dept, data]) => ({
      department: dept,
      members: data.members.size,
      projects: data.projects,
      tasks: data.tasks,
      completed: data.completed,
      rate: data.tasks > 0 ? Math.round((data.completed / data.tasks) * 100) : 0
    }));
  }, [apiAvailable, reportData, roleFilteredLocal, users]);

  // ── Rest of the component: unchanged UI code ─────────────────────────

  const chartColors = useMemo(() => {
    if (theme === 'light') {
      return {
        cyan: '#86A78F',
        violet: '#8FA89C',
        magenta: '#a34a67',
        amber: '#7A5000',
        emerald: '#3E7B52',
        rose: '#9E2924',
        blue: '#5F806B',
        purple: '#8FA89C',
        pink: '#a34a67',
        slate: '#5E6B63',
      };
    }
    return {
      cyan: '#5B8A8F',
      violet: '#8B7E9C',
      magenta: '#C46B7A',
      amber: '#C4A047',
      emerald: '#6A9E7E',
      rose: '#C4757A',
      blue: '#6B8FBA',
      purple: '#9B8FAC',
      pink: '#C47B90',
      slate: '#8F9B92',
    };
  }, [theme]);

  const chartGridColor = useMemo(() => theme === 'light' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)', [theme]);
  const chartTextColor = useMemo(() => theme === 'light' ? '#5E6B63' : '#94a3b8', [theme]);
  const chartPieStroke = useMemo(() => theme === 'light' ? 'rgba(255,255,255,0.6)' : 'rgba(9,10,15,0.8)', [theme]);

  const pieColors = useMemo(() => [
    chartColors.emerald,
    chartColors.cyan,
    chartColors.amber,
    chartColors.violet,
    chartColors.rose,
    chartColors.magenta,
  ], [chartColors]);

  const visibleTabs = useMemo<ReportTab[]>(() => {
    switch (currentRole) {
      case 'Admin':
        return ['overview', 'projects', 'tasks', 'teams', 'workload', 'deadlines', 'attendance', 'export'];
      case 'HR':
        return ['overview', 'attendance', 'export'];
      case 'Team_Lead':
        return ['overview', 'projects', 'tasks', 'workload', 'deadlines', 'export'];
      case 'Team_Member':
        return ['overview', 'projects', 'tasks', 'workload', 'deadlines'];
      default:
        return ['overview'];
    }
  }, [currentRole]);

  const tabLabels: Record<ReportTab, string> = {
    overview: 'Overview',
    projects: 'Projects',
    tasks: 'Tasks',
    teams: 'Teams',
    workload: 'Workload',
    deadlines: 'Deadlines',
    attendance: 'Attendance',
    export: 'Export'
  };

  const handleDateChange = (field: 'from' | 'to', value: string) => {
    const next = { ...dateRange, [field]: value };
    setDateRange(next);
    const err = validateDateRange(next.from, next.to);
    setValidationError(err);
  };

  const hasError = validationError !== null;

  const handleCsvExport = () => {
    const tab = activeTab;
    let headers: string[] = [];
    let rows: string[][] = [];

    if (tab === 'projects') {
      headers = ['Project', 'Code', 'Status', 'Progress %', 'Start Date', 'Target Date', 'Members', 'Team Lead'];
      rows = roleFiltered.projects.map((p: any) => [
        p.title, p.code, p.status, String(p.progress), p.startDate, p.targetDate,
        String(p.memberIds?.length || 0), users.find((u) => u.id === p.teamLeadId)?.name || p.teamLeadId
      ]);
    } else if (tab === 'workload') {
      headers = ['Member', 'Role', 'Active', 'Completed', 'Overdue', 'Projects', 'Workload'];
      rows = workloadData.map((w: any) => {
        const total = (w.active || 0) + (w.completed || 0) + (w.review || 0) + (w.overdue || 0);
        const wl = total >= 8 ? 'Heavy' : total >= 4 ? 'Moderate' : 'Light';
        return [w.name, w.role || w.department || '', String(w.active), String(w.completed), String(w.overdue), String(w.projectCount || 0), wl];
      });
    } else if (tab === 'deadlines') {
      headers = ['Task', 'Status', 'Priority', 'Due Date', 'Assignee'];
      rows = [...deadlineData.overdue, ...deadlineData.dueToday, ...deadlineData.dueTomorrow, ...deadlineData.upcoming].map((t: any) => [
        t.title, t.status, t.priority, t.dueDate, users.find((u) => u.id === t.assigneeId)?.name || t.assigneeId
      ]);
    } else if (tab === 'attendance') {
      headers = ['User', 'Date', 'Status', 'Check In', 'Check Out', 'Total Hours'];
      rows = roleFiltered.attendance.map((a: any) => [
        users.find((u) => u.id === a.userId)?.name || a.userId, a.date, a.status, a.checkIn, a.checkOut || '\u2014', String(a.totalHours)
      ]);
    } else if (tab === 'teams') {
      headers = ['Department', 'Members', 'Projects', 'Tasks', 'Completed', 'Completion Rate'];
      rows = teamStats.map((t: any) => [t.department, String(t.members), String(t.projects), String(t.tasks), String(t.completed), `${t.rate}%`]);
    } else {
      headers = ['Metric', 'Value'];
      rows = [
        ['Total Projects', String(kpiStats.totalProjects)],
        ['Active Tasks', String(kpiStats.activeTasks)],
        ['Completed Tasks', String(kpiStats.completedTasks)],
        ['Overdue Tasks', String(kpiStats.overdueTasks)],
        ['Completion Rate', `${kpiStats.completionRate}%`],
        ['Contributors', String(kpiStats.activeMembers)]
      ];
    }

    const csv = prepareCsv(headers, rows);
    downloadBlob(csv, `report_${tab}_${dateRange.from}_${dateRange.to}.csv`, 'text/csv');
  };

  const handlePdfExport = () => {
    const tab = activeTab;
    const now = new Date().toLocaleString();
    const from = dateRange.from;
    const to = dateRange.to;

    const pdfTitles: Record<ReportTab, string> = {
      overview: 'Overall Summary Report',
      projects: 'Project Analytics Report',
      tasks: 'Tasks Report',
      teams: 'Team Analytics Report',
      workload: 'Member Workload Report',
      deadlines: 'Deadlines Report',
      attendance: 'Attendance Report',
      export: 'Export Summary',
    };

    const title = pdfTitles[tab];

    const kpi = (label: string, value: string | number) =>
      `<div style="flex:1;min-width:100px;padding:12px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;text-align:center;">
        <div style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
        <div style="font-size:20px;font-weight:700;color:#0f172a;margin-top:2px;">${value}</div>
      </div>`;

    const th = (text: string) => `<th style="background:#f1f5f9;padding:7px 10px;text-align:left;font-weight:600;border-bottom:2px solid #e2e8f0;color:#334155;font-size:10px;">${text}</th>`;
    const td = (text: string | number, cls?: string) =>
      `<td style="padding:5px 10px;border-bottom:1px solid #e2e8f0;color:${cls || '#475569'};font-size:10px;">${text}</td>`;
    const section = (title: string) =>
      `<h3 style="font-size:13px;font-weight:600;margin:20px 0 8px;color:#1e293b;border-left:3px solid #3b82f6;padding-left:8px;">${title}</h3>`;

    let bodyHtml = '';

    if (tab === 'projects') {
      bodyHtml += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0;">`;
      bodyHtml += kpi('Total Projects', roleFiltered.projects.length);
      const projArr = roleFiltered.projects as any[];
      const avgProg = projArr.length > 0 ? `${Math.round(projArr.reduce((s: number, p: any) => s + (p.progress || 0), 0) / projArr.length)}%` : '0%';
      bodyHtml += kpi('Avg Progress', avgProg);
      bodyHtml += kpi('Active', projArr.filter((p: any) => p.status === 'Active').length);
      bodyHtml += kpi('Completed', projArr.filter((p: any) => p.status === 'Completed').length);
      bodyHtml += `</div>`;
      bodyHtml += section('Project Details');
      bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
      bodyHtml += `<thead><tr>${th('Project')}${th('Code')}${th('Status')}${th('Progress')}${th('Tasks')}${th('Health')}</tr></thead><tbody>`;
      projArr.forEach((p: any) => {
        const health = (p.progress || 0) >= 70 ? 'On Track' : (p.progress || 0) >= 40 ? 'At Risk' : 'Needs Attention';
        bodyHtml += `<tr>${td(p.title, '#0f172a')}${td(p.code)}${td(p.status)}${td(`${p.progress || 0}%`)}${td(p.taskCount || 0)}${td(health)}</tr>`;
      });
      bodyHtml += `</tbody></table>`;
    } else if (tab === 'teams') {
      bodyHtml += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0;">`;
      bodyHtml += kpi('Departments', teamStats.length);
      bodyHtml += kpi('Total Tasks', teamStats.reduce((s: number, t: any) => s + (t.tasks || 0), 0));
      bodyHtml += kpi('Completed', teamStats.reduce((s: number, t: any) => s + (t.completed || 0), 0));
      const avgRate = teamStats.length > 0 ? `${Math.round(teamStats.reduce((s: number, t: any) => s + (t.rate || 0), 0) / teamStats.length)}%` : '0%';
      bodyHtml += kpi('Avg Rate', avgRate);
      bodyHtml += `</div>`;
      bodyHtml += section('Department Performance');
      bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
      bodyHtml += `<thead><tr>${th('Department')}${th('Members')}${th('Projects')}${th('Tasks')}${th('Completed')}${th('Rate')}</tr></thead><tbody>`;
      teamStats.forEach((t: any) => {
        bodyHtml += `<tr>${td(t.department, '#0f172a')}${td(t.members)}${td(t.projects)}${td(t.tasks)}${td(t.completed)}${td(`${t.rate}%`)}</tr>`;
      });
      bodyHtml += `</tbody></table>`;
    } else if (tab === 'workload') {
      const wlMembers = workloadData as any[];
      bodyHtml += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0;">`;
      bodyHtml += kpi('Team Members', wlMembers.length);
      bodyHtml += kpi('Active Members', wlMembers.filter((m: any) => m.active > 0).length);
      bodyHtml += kpi('Avg Active Tasks / Member', wlMembers.length > 0 ? +(wlMembers.reduce((s: number, m: any) => s + (m.active || 0), 0) / wlMembers.length).toFixed(1) : 0);
      bodyHtml += kpi('Members with Overdue', wlMembers.filter((m: any) => m.overdue > 0).length);
      bodyHtml += `</div>`;
      bodyHtml += section('Member Workload');
      bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
      bodyHtml += `<thead><tr>${th('Member')}${th('Role')}${th('Active')}${th('Completed')}${th('Overdue')}${th('Projects')}${th('Workload')}</tr></thead><tbody>`;
      wlMembers.forEach((w: any) => {
        const total = (w.active || 0) + (w.completed || 0) + (w.review || 0) + (w.overdue || 0);
        const wl = total >= 8 ? 'Heavy' : total >= 4 ? 'Moderate' : 'Light';
        bodyHtml += `<tr>${td(w.name, '#0f172a')}${td(w.role || w.department || '\u2014')}${td(w.active)}${td(w.completed)}${td(w.overdue > 0 ? `<span style="color:#991b1b;">${w.overdue}</span>` : '0')}${td(w.projectCount || 0)}${td(wl)}</tr>`;
      });
      bodyHtml += `</tbody></table>`;
    } else if (tab === 'deadlines') {
      bodyHtml += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0;">`;
      bodyHtml += kpi('Due Today', deadlineData.dueToday.length);
      bodyHtml += kpi('Due Tomorrow', deadlineData.dueTomorrow.length);
      bodyHtml += kpi('Upcoming', deadlineData.upcoming.length);
      bodyHtml += kpi('Overdue', deadlineData.overdue.length);
      bodyHtml += `</div>`;
      if (deadlineData.overdue.length > 0) {
        bodyHtml += section(`Overdue Tasks (${deadlineData.overdue.length})`);
        bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
        bodyHtml += `<thead><tr>${th('Task')}${th('Status')}${th('Priority')}${th('Due Date')}</tr></thead><tbody>`;
        deadlineData.overdue.forEach((t: any) => {
          bodyHtml += `<tr>${td(t.title, '#991b1b')}${td(t.status)}${td(t.priority)}${td(t.dueDate)}</tr>`;
        });
        bodyHtml += `</tbody></table>`;
      }
      if (deadlineData.dueToday.length > 0) {
        bodyHtml += section(`Due Today (${deadlineData.dueToday.length})`);
        bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
        bodyHtml += `<thead><tr>${th('Task')}${th('Status')}${th('Priority')}${th('Due Date')}</tr></thead><tbody>`;
        deadlineData.dueToday.forEach((t: any) => {
          bodyHtml += `<tr>${td(t.title, '#0f172a')}${td(t.status)}${td(t.priority)}${td(t.dueDate)}</tr>`;
        });
        bodyHtml += `</tbody></table>`;
      }
      if (deadlineData.dueTomorrow.length > 0) {
        bodyHtml += section(`Due Tomorrow (${deadlineData.dueTomorrow.length})`);
        bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
        bodyHtml += `<thead><tr>${th('Task')}${th('Status')}${th('Priority')}${th('Due Date')}</tr></thead><tbody>`;
        deadlineData.dueTomorrow.forEach((t: any) => {
          bodyHtml += `<tr>${td(t.title, '#0f172a')}${td(t.status)}${td(t.priority)}${td(t.dueDate)}</tr>`;
        });
        bodyHtml += `</tbody></table>`;
      }
      if (deadlineData.upcoming.length > 0) {
        bodyHtml += section(`Upcoming (${deadlineData.upcoming.length})`);
        bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
        bodyHtml += `<thead><tr>${th('Task')}${th('Status')}${th('Priority')}${th('Due Date')}</tr></thead><tbody>`;
        deadlineData.upcoming.forEach((t: any) => {
          bodyHtml += `<tr>${td(t.title, '#0f172a')}${td(t.status)}${td(t.priority)}${td(t.dueDate)}</tr>`;
        });
        bodyHtml += `</tbody></table>`;
      }
      if (deadlineData.overdue.length === 0 && deadlineData.dueToday.length === 0 && deadlineData.dueTomorrow.length === 0 && deadlineData.upcoming.length === 0) {
        bodyHtml += `<p style="text-align:center;color:#94a3b8;padding:20px;">No deadlines in the selected date range.</p>`;
      }
    } else if (tab === 'attendance') {
      const attStats = attendanceStats;
      bodyHtml += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0;">`;
      bodyHtml += kpi('Present', attStats.present);
      bodyHtml += kpi('Late', attStats.late);
      bodyHtml += kpi('Absent', attStats.absent);
      bodyHtml += kpi('On Leave', attStats.onLeave);
      bodyHtml += kpi('Half Day', attStats.halfDay);
      bodyHtml += kpi('Avg Hours', `${attStats.avgHours}h`);
      bodyHtml += kpi('Total Records', attStats.total);
      bodyHtml += `</div>`;
      bodyHtml += section('Attendance Records');
      bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
      bodyHtml += `<thead><tr>${th('User')}${th('Date')}${th('Status')}${th('Check In')}${th('Check Out')}${th('Hours')}</tr></thead><tbody>`;
      (roleFiltered.attendance || []).forEach((a: any) => {
        const userName = users.find((u) => u.id === a.userId)?.name || a.userId;
        bodyHtml += `<tr>${td(userName, '#0f172a')}${td(a.date)}${td(a.status)}${td(a.checkIn)}${td(a.checkOut || '\u2014')}${td(a.totalHours || 0)}</tr>`;
      });
      bodyHtml += `</tbody></table>`;
    } else {
      if (currentRole !== 'HR') {
        bodyHtml += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0;">`;
        bodyHtml += kpi('Total Projects', kpiStats.totalProjects);
        bodyHtml += kpi('Active Tasks', kpiStats.activeTasks);
        bodyHtml += kpi('Completed Tasks', kpiStats.completedTasks);
        bodyHtml += kpi('Overdue Tasks', kpiStats.overdueTasks);
        bodyHtml += kpi('Completion Rate', `${kpiStats.completionRate}%`);
        bodyHtml += kpi('Contributors', kpiStats.activeMembers);
        bodyHtml += `</div>`;
        bodyHtml += section('Task Status Distribution');
        bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
        bodyHtml += `<thead><tr>${th('Status')}${th('Count')}</tr></thead><tbody>`;
        taskStatusDist.forEach((s: any) => {
          bodyHtml += `<tr>${td(s.name)}${td(s.value)}</tr>`;
        });
        bodyHtml += `</tbody></table>`;
        bodyHtml += section('Priority Distribution');
        bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
        bodyHtml += `<thead><tr>${th('Priority')}${th('Count')}</tr></thead><tbody>`;
        taskPriorityDist.forEach((p: any) => {
          bodyHtml += `<tr>${td(p.name)}${td(p.value)}</tr>`;
        });
        bodyHtml += `</tbody></table>`;
      } else {
        bodyHtml += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0;">`;
        bodyHtml += kpi('Present Today', hrOverviewStats.presentToday);
        bodyHtml += kpi('Absent', hrOverviewStats.absentToday);
        bodyHtml += kpi('On Leave', hrOverviewStats.onLeaveToday);
        bodyHtml += kpi('Late', hrOverviewStats.lateToday);
        bodyHtml += kpi('Avg Hours', `${hrOverviewStats.avgHours}h`);
        bodyHtml += kpi('Pending Leaves', hrOverviewStats.pendingLeaveReqs);
        bodyHtml += kpi('Pending Corrections', hrOverviewStats.pendingCorrections);
        bodyHtml += `</div>`;
      }
    }

    const fullHtml = `<!DOCTYPE html><html><head><title>${title}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:40px;color:#1e293b;margin:0;}
.header{text-align:center;padding-bottom:16px;border-bottom:3px solid #3b82f6;margin-bottom:24px;}
.header h1{margin:0;font-size:22px;font-weight:700;color:#0f172a;}
.header .meta{font-size:11px;color:#64748b;margin-top:6px;}
.footer{text-align:center;margin-top:28px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;}
</style></head><body>
<div class="header"><h1>${title}</h1><div class="meta">${from} \u2014 ${to} &nbsp;|&nbsp; Generated ${now}</div></div>
${bodyHtml}
<div class="footer">${title} &middot; WorkSync Reports &middot; ${now}</div>
</body></html>`;

    const printFrame = document.createElement('iframe');
    printFrame.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;border:none;';
    document.body.appendChild(printFrame);
    const contentWindow = printFrame.contentWindow;
    if (!contentWindow) {
      document.body.removeChild(printFrame);
      return;
    }
    const doc = contentWindow.document;
    doc.open();
    doc.write(fullHtml);
    doc.close();
    setTimeout(() => {
      contentWindow.print();
      setTimeout(() => document.body.removeChild(printFrame), 1000);
    }, 300);
  };

  const handleTaskPdfExport = () => {
    const t = detailTask;
    if (!t) return;
    const now = new Date().toLocaleString();
    const assignee = users.find((u: any) => u.id === t.assigneeId);
    const creator = users.find((u: any) => u.id === t.creatorId);
    const project = roleFiltered.projects.find((p: any) => p.id === t.projectId);
    const history = t.statusHistory || [];

    const th = (text: string) => `<th style="background:#f1f5f9;padding:7px 10px;text-align:left;font-weight:600;border-bottom:2px solid #e2e8f0;color:#334155;font-size:10px;">${text}</th>`;
    const td = (text: string | number, cls?: string) =>
      `<td style="padding:5px 10px;border-bottom:1px solid #e2e8f0;color:${cls || '#475569'};font-size:10px;">${text}</td>`;
    const section = (title: string) =>
      `<h3 style="font-size:13px;font-weight:600;margin:20px 0 8px;color:#1e293b;border-left:3px solid #3b82f6;padding-left:8px;">${title}</h3>`;

    let bodyHtml = '';

    bodyHtml += `<div style="margin-bottom:16px;"><span style="font-size:10px;color:#64748b;">${t.taskNumber || t.id.slice(0, 8)}</span>`;
    bodyHtml += `<h2 style="margin:4px 0;font-size:18px;font-weight:700;color:#0f172a;">${t.title}</h2>`;
    bodyHtml += `<div style="display:flex;gap:6px;margin-top:4px;">`;
    bodyHtml += `<span style="display:inline-block;padding:2px 8px;font-size:10px;font-weight:600;border-radius:4px;background:#dbeafe;color:#1e40af;">${t.status}</span>`;
    bodyHtml += `<span style="display:inline-block;padding:2px 8px;font-size:10px;font-weight:600;border-radius:4px;background:#fce7f3;color:#9d174d;">${t.priority}</span>`;
    bodyHtml += `</div></div>`;

    bodyHtml += section('Details');
    bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
    bodyHtml += `<thead><tr>${th('Field')}${th('Value')}</tr></thead><tbody>`;
    bodyHtml += `<tr>${td('Assignee', '#0f172a')}${td(assignee?.name || '\u2014')}</tr>`;
    bodyHtml += `<tr>${td('Creator', '#0f172a')}${td(creator?.name || '\u2014')}</tr>`;
    bodyHtml += `<tr>${td('Project', '#0f172a')}${td(project?.title || '\u2014')}</tr>`;
    bodyHtml += `<tr>${td('Due Date', '#0f172a')}${td(t.dueDate ? t.dueDate.slice(0, 10) : '\u2014')}</tr>`;
    bodyHtml += `<tr>${td('Created', '#0f172a')}${td(t.createdAt ? t.createdAt.slice(0, 10) : '\u2014')}</tr>`;
    bodyHtml += `<tr>${td('Completed', '#0f172a')}${td(t.completedAt ? t.completedAt.slice(0, 10) : '\u2014')}</tr>`;
    bodyHtml += `</tbody></table>`;

    if (t.description) {
      bodyHtml += section('Description');
      bodyHtml += `<p style="font-size:11px;color:#334155;line-height:1.6;margin:4px 0;">${t.description.replace(/\n/g, '<br/>')}</p>`;
    }

    if (t.subtasks && t.subtasks.length > 0) {
      bodyHtml += section(`Subtasks (${t.subtasks.length})`);
      bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
      bodyHtml += `<thead><tr>${th('Title')}${th('Status')}${th('Priority')}</tr></thead><tbody>`;
      t.subtasks.forEach((st: any) => {
        bodyHtml += `<tr>${td(st.title, '#0f172a')}${td(st.status)}${td(st.priority)}</tr>`;
      });
      bodyHtml += `</tbody></table>`;
    }

    if (t.attachments && t.attachments.length > 0) {
      bodyHtml += section(`Attachments (${t.attachments.length})`);
      t.attachments.forEach((att: any) => {
        bodyHtml += `<p style="font-size:10px;color:#475569;margin:2px 0;">${att.fileName || att.name || 'File'}${att.fileSize ? ` (${(att.fileSize / 1024).toFixed(0)}KB)` : ''}</p>`;
      });
    }

    if (history.length > 0) {
      bodyHtml += section('Activity');
      bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
      bodyHtml += `<thead><tr>${th('Action')}${th('User')}${th('Date')}</tr></thead><tbody>`;
      history.forEach((h: any) => {
        const fromUser = users.find((u: any) => u.id === h.changedByUserId || u.id === h.userId);
        let action = h.action || h.eventType || 'Updated';
        if (h.fromStatus && h.toStatus) action = `${h.fromStatus} \u2192 ${h.toStatus}`;
        bodyHtml += `<tr>${td(action, '#0f172a')}${td(fromUser?.name || 'System')}${td(h.changedAt || h.createdAt || '')}</tr>`;
      });
      bodyHtml += `</tbody></table>`;
    }

    bodyHtml += section('Completion Summary');
    bodyHtml += `<p style="font-size:11px;color:#475569;margin:4px 0;">${t.completionSummary || 'No completion summary provided.'}</p>`;

    const fullHtml = `<!DOCTYPE html><html><head><title>Task - ${t.taskNumber || t.title}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:40px;color:#1e293b;margin:0;}
.header{text-align:center;padding-bottom:16px;border-bottom:3px solid #3b82f6;margin-bottom:24px;}
.header h1{margin:0;font-size:22px;font-weight:700;color:#0f172a;}
.header .meta{font-size:11px;color:#64748b;margin-top:6px;}
.footer{text-align:center;margin-top:28px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;}
</style></head><body>
<div class="header"><h1>Task Detail</h1><div class="meta">${t.taskNumber || t.id.slice(0, 8)} &middot; Generated ${now}</div></div>
${bodyHtml}
<div class="footer">Task ${t.taskNumber || t.id.slice(0, 8)} &middot; WorkSync Reports &middot; ${now}</div>
</body></html>`;

    const printFrame = document.createElement('iframe');
    printFrame.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;border:none;';
    document.body.appendChild(printFrame);
    const contentWindow = printFrame.contentWindow;
    if (!contentWindow) {
      document.body.removeChild(printFrame);
      return;
    }
    const doc = contentWindow.document;
    doc.open();
    doc.write(fullHtml);
    doc.close();
    setTimeout(() => {
      contentWindow.print();
      setTimeout(() => document.body.removeChild(printFrame), 1000);
    }, 300);
  };

  const handleMemberPdfExport = () => {
    const m = detailMember;
    if (!m) return;
    const now = new Date().toLocaleString();
    const memberTasks = (roleFiltered.tasks as any[]).filter((t: any) => t.assigneeId === m.userId);
    const activeTasks = memberTasks.filter((t: any) => t.status !== 'Done');
    const completedTasks = memberTasks.filter((t: any) => t.status === 'Done');
    const overdueTasks = memberTasks.filter((t: any) => t.status !== 'Done' && t.dueDate && t.dueDate < todayStr());
    const memberProjects = (roleFiltered.projects as any[]).filter((p: any) => m.projectIds?.includes(p.id));
    const completionRate = memberTasks.length > 0 ? Math.round((completedTasks.length / memberTasks.length) * 100) : 0;
    const upcomingDeadlines = activeTasks.filter((t: any) => t.dueDate && t.dueDate >= todayStr()).sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate));
    const memberActivity = memberTasks.flatMap((t: any) => (t.statusHistory || []).map((h: any) => ({ ...h, taskTitle: t.title }))).sort((a: any, b: any) => (b.timestamp || '').localeCompare(a.timestamp || ''));

    const kpi = (label: string, value: string | number) =>
      `<div style="flex:1;min-width:80px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;text-align:center;">
        <div style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
        <div style="font-size:18px;font-weight:700;color:#0f172a;margin-top:2px;">${value}</div>
      </div>`;
    const th = (text: string) => `<th style="background:#f1f5f9;padding:7px 10px;text-align:left;font-weight:600;border-bottom:2px solid #e2e8f0;color:#334155;font-size:10px;">${text}</th>`;
    const td = (text: string | number, cls?: string) => `<td style="padding:5px 10px;border-bottom:1px solid #e2e8f0;color:${cls || '#475569'};font-size:10px;">${text}</td>`;
    const section = (title: string) => `<h3 style="font-size:13px;font-weight:600;margin:20px 0 8px;color:#1e293b;border-left:3px solid #3b82f6;padding-left:8px;">${title}</h3>`;

    let bodyHtml = '';
    bodyHtml += `<h2 style="margin:0;font-size:18px;font-weight:700;color:#0f172a;">${m.name}</h2>`;
    bodyHtml += `<p style="margin:2px 0 16px;font-size:11px;color:#64748b;">${m.title || m.role || ''}${m.department ? ` &middot; ${m.department}` : ''}</p>`;

    bodyHtml += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;">`;
    bodyHtml += kpi('Active Tasks', m.active);
    bodyHtml += kpi('Completed', m.completed);
    bodyHtml += kpi('Overdue', m.overdue);
    bodyHtml += kpi('Projects', m.projectCount);
    bodyHtml += kpi('Completion Rate', `${completionRate}%`);
    bodyHtml += `</div>`;

    if (activeTasks.length > 0) {
      bodyHtml += section(`Current Tasks (${activeTasks.length})`);
      bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
      bodyHtml += `<thead><tr>${th('Task')}${th('Project')}${th('Priority')}${th('Status')}${th('Due Date')}</tr></thead><tbody>`;
      activeTasks.forEach((t: any) => {
        const projName = roleFiltered.projects.find((p: any) => p.id === t.projectId)?.title || '';
        bodyHtml += `<tr>${td(t.title, '#0f172a')}${td(projName)}${td(t.priority)}${td(t.status)}${td(t.dueDate?.slice(0, 10) || '\u2014')}</tr>`;
      });
      bodyHtml += `</tbody></table>`;
    }

    if (memberProjects.length > 0) {
      bodyHtml += section(`Projects (${memberProjects.length})`);
      bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
      bodyHtml += `<thead><tr>${th('Project')}${th('Role')}${th('Status')}</tr></thead><tbody>`;
      memberProjects.forEach((p: any) => {
        const isLead = p.teamLeadId === m.userId;
        bodyHtml += `<tr>${td(p.title, '#0f172a')}${td(isLead ? 'Lead' : 'Member')}${td(p.status)}</tr>`;
      });
      bodyHtml += `</tbody></table>`;
    }

    if (completedTasks.length > 0) {
      bodyHtml += section(`Completed Work (${completedTasks.length})`);
      bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
      bodyHtml += `<thead><tr>${th('Task')}${th('Priority')}${th('Completed')}</tr></thead><tbody>`;
      completedTasks.forEach((t: any) => {
        bodyHtml += `<tr>${td(t.title, '#0f172a')}${td(t.priority)}${td(t.createdAt?.slice(0, 10) || '\u2014')}</tr>`;
      });
      bodyHtml += `</tbody></table>`;
    }

    if (upcomingDeadlines.length > 0) {
      bodyHtml += section(`Upcoming Deadlines (${upcomingDeadlines.length})`);
      upcomingDeadlines.forEach((t: any) => {
        bodyHtml += `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:10px;border-bottom:1px solid #f1f5f9;">
          <span style="color:#0f172a;">${t.title}</span>
          <span style="color:#64748b;">${t.dueDate?.slice(0, 10) || ''}</span>
        </div>`;
      });
    }

    if (memberActivity.length > 0) {
      bodyHtml += section(`Activity (${memberActivity.length})`);
      bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
      bodyHtml += `<thead><tr>${th('Action')}${th('User')}${th('Date')}</tr></thead><tbody>`;
      memberActivity.slice(0, 50).forEach((h: any) => {
        let action = `${h.taskTitle || ''} ${h.fromStatus ? `${h.fromStatus} \u2192 ${h.toStatus}` : ''}`;
        if (!h.fromStatus) action = h.action || h.eventType || '';
        bodyHtml += `<tr>${td(action || 'Updated', '#0f172a')}${td(h.changedByName || h.changedBy || 'System')}${td(h.timestamp || h.changedAt || h.createdAt || '')}</tr>`;
      });
      bodyHtml += `</tbody></table>`;
    }

    const fullHtml = `<!DOCTYPE html><html><head><title>Member - ${m.name}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:40px;color:#1e293b;margin:0;}
.header{text-align:center;padding-bottom:16px;border-bottom:3px solid #3b82f6;margin-bottom:24px;}
.header h1{margin:0;font-size:22px;font-weight:700;color:#0f172a;}
.header .meta{font-size:11px;color:#64748b;margin-top:6px;}
.footer{text-align:center;margin-top:28px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:9px;color:#94a3b8;}
</style></head><body>
<div class="header"><h1>Member Workload Details</h1><div class="meta">${m.name} &middot; Generated ${now}</div></div>
${bodyHtml}
<div class="footer">${m.name} &middot; WorkSync Reports &middot; ${now}</div>
</body></html>`;

    const printFrame = document.createElement('iframe');
    printFrame.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;border:none;';
    document.body.appendChild(printFrame);
    const contentWindow = printFrame.contentWindow;
    if (!contentWindow) { document.body.removeChild(printFrame); return; }
    const doc = contentWindow.document;
    doc.open(); doc.write(fullHtml); doc.close();
    setTimeout(() => { contentWindow.print(); setTimeout(() => document.body.removeChild(printFrame), 1000); }, 300);
  };

  const handleProjectPdfExport = (
    project: any,
    projectTasks: any[],
    teamLeadUser: any,
    memberUsers: any[],
    totalTasks: number,
    completedTasks: number,
    activeTasks: number,
    overdueTasks: number,
    completionRate: number,
    statusCounts: Record<string, number>,
    milestones: any[] = [],
    attachments: any[] = []
  ) => {
    const now = new Date().toLocaleString();
    const from = dateRange.from;
    const to = dateRange.to;

    const kpi = (label: string, value: string | number) =>
      `<div style="flex:1;min-width:80px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;text-align:center;">
        <div style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
        <div style="font-size:18px;font-weight:700;color:#0f172a;margin-top:2px;">${value}</div>
      </div>`;

    const th = (text: string) => `<th style="background:#f1f5f9;padding:6px 8px;text-align:left;font-weight:600;border-bottom:2px solid #e2e8f0;color:#334155;font-size:9px;">${text}</th>`;
    const td = (text: string | number, cls?: string) =>
      `<td style="padding:4px 8px;border-bottom:1px solid #e2e8f0;color:${cls || '#475569'};font-size:9px;">${text}</td>`;
    const section = (title: string) =>
      `<h3 style="font-size:12px;font-weight:600;margin:16px 0 6px;color:#1e293b;border-left:3px solid #3b82f6;padding-left:8px;">${title}</h3>`;

    const formatDate = (d: string | undefined) => {
      if (!d) return '\u2014';
      return new Date(d.slice(0, 10) + 'T00:00:00').toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const formatFileSize = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    const healthLabel = (project.progress || 0) >= 70 ? 'On Track' : (project.progress || 0) >= 40 ? 'At Risk' : 'Needs Attention';

    const statusOrder = ['Todo', 'In Progress', 'Review', 'Done', 'Blocked'];

    let bodyHtml = '';

    bodyHtml += `<div style="display:flex;align-items:center;justify-content:space-between;margin:16px 0 8px;">
      <div><div style="font-size:14px;font-weight:700;color:#0f172a;">${project.code}</div>
      <div style="font-size:11px;color:#64748b;">${project.title}</div></div>
      <div style="font-size:10px;color:#64748b;">${healthLabel} | ${project.progress || 0}% progress</div>
    </div>`;

    if (project.description) {
      bodyHtml += `<div style="font-size:10px;color:#475569;margin:0 0 12px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:6px;line-height:1.5;white-space:pre-wrap;">${project.description}</div>`;
    }

    bodyHtml += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0;">`;
    bodyHtml += kpi('Total Tasks', totalTasks);
    bodyHtml += kpi('Completed', completedTasks);
    bodyHtml += kpi('Active', activeTasks);
    bodyHtml += kpi('Overdue', overdueTasks);
    bodyHtml += kpi('Completion Rate', `${completionRate}%`);
    bodyHtml += `</div>`;

    bodyHtml += section('Timeline');
    bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:6px 0;">`;
    bodyHtml += `<thead><tr>${th('Metric')}${th('Value')}</tr></thead><tbody>`;
    bodyHtml += `<tr>${td('Created')}${td(formatDate(project.createdAt || project.startDate))}</tr>`;
    bodyHtml += `<tr>${td('Start Date')}${td(formatDate(project.startDate))}</tr>`;
    bodyHtml += `<tr>${td('Deadline')}${td(formatDate(project.targetDate))}</tr>`;
    if (project.creationReason) bodyHtml += `<tr>${td('Reason')}${td(project.creationReason)}</tr>`;
    bodyHtml += `</tbody></table>`;

    bodyHtml += section('Team');
    bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:6px 0;">`;
    bodyHtml += `<thead><tr>${th('Role')}${th('Name')}</tr></thead><tbody>`;
    bodyHtml += `<tr>${td('Project Lead')}${td(teamLeadUser?.name || project.teamLeadId || '\u2014')}</tr>`;
    memberUsers.forEach((u: any) => {
      bodyHtml += `<tr>${td('Member')}${td(u.name || u.id)}</tr>`;
    });
    bodyHtml += `</tbody></table>`;

    bodyHtml += section('Task Status Breakdown');
    bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:6px 0;">`;
    bodyHtml += `<thead><tr>${th('Status')}${th('Count')}</tr></thead><tbody>`;
    statusOrder.forEach((status) => {
      bodyHtml += `<tr>${td(status)}${td(statusCounts[status] || 0)}</tr>`;
    });
    bodyHtml += `</tbody></table>`;

    if (projectTasks.length > 0) {
      bodyHtml += section(`Tasks (${totalTasks})`);
      bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:6px 0;">`;
      bodyHtml += `<thead><tr>${th('Task')}${th('Status')}${th('Priority')}${th('Assignee')}${th('Due Date')}</tr></thead><tbody>`;
      projectTasks.forEach((t: any) => {
        const assignee = users.find((u: any) => u.id === t.assigneeId);
        const assigneeName = assignee?.name || t.assigneeId || '\u2014';
        bodyHtml += `<tr>${td(t.title, '#0f172a')}${td(t.status)}${td(t.priority)}${td(assigneeName)}${td(formatDate(t.dueDate))}</tr>`;
      });
      bodyHtml += `</tbody></table>`;
    }

    if (milestones.length > 0) {
      bodyHtml += section(`Milestones (${milestones.length})`);
      bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:6px 0;">`;
      bodyHtml += `<thead><tr>${th('Milestone')}${th('Status')}${th('Due Date')}${th('Completed')}</tr></thead><tbody>`;
      milestones.forEach((m: any) => {
        bodyHtml += `<tr>${td(m.title, '#0f172a')}${td(m.completed ? 'Done' : 'Active')}${td(formatDate(m.dueDate))}${td(m.completedAt ? formatDate(m.completedAt) : '\u2014')}</tr>`;
      });
      bodyHtml += `</tbody></table>`;
    }

    if (attachments.length > 0) {
      bodyHtml += section(`Attachments (${attachments.length})`);
      bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:6px 0;">`;
      bodyHtml += `<thead><tr>${th('File')}${th('Type')}${th('Size')}${th('Uploaded')}</tr></thead><tbody>`;
      attachments.forEach((f: any) => {
        const uploader = users.find((u: any) => u.id === f.uploadedBy);
        const fileSize = f.size != null ? (typeof f.size === 'number' ? formatFileSize(f.size) : f.size) : '';
        const fileType = f.mimeType || f.type || '';
        bodyHtml += `<tr>${td(f.name, '#0f172a')}${td(fileType)}${td(fileSize)}${td(`${uploader?.name || f.uploadedBy || ''} ${f.uploadedAt ? formatDate(f.uploadedAt) : ''}`)}</tr>`;
      });
      bodyHtml += `</tbody></table>`;
    }

    const fullHtml = `<!DOCTYPE html><html><head><title>Project Detail - ${project.code}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:40px;color:#1e293b;margin:0;}
.header{text-align:center;padding-bottom:16px;border-bottom:3px solid #3b82f6;margin-bottom:24px;}
.header h1{margin:0;font-size:20px;font-weight:700;color:#0f172a;}
.header .meta{font-size:10px;color:#64748b;margin-top:6px;}
.footer{text-align:center;margin-top:24px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:8px;color:#94a3b8;}
</style></head><body>
<div class="header"><h1>${project.title}</h1><div class="meta">${project.code} &nbsp;|&nbsp; ${from} \u2014 ${to} &nbsp;|&nbsp; Generated ${now}</div></div>
${bodyHtml}
<div class="footer">Project Detail &middot; ${project.code} &middot; WorkSync Reports &middot; ${now}</div>
</body></html>`;

    const printFrame = document.createElement('iframe');
    printFrame.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;border:none;';
    document.body.appendChild(printFrame);
    const contentWindow = printFrame.contentWindow;
    if (!contentWindow) {
      document.body.removeChild(printFrame);
      return;
    }
    const doc = contentWindow.document;
    doc.open();
    doc.write(fullHtml);
    doc.close();
    setTimeout(() => {
      contentWindow.print();
      setTimeout(() => document.body.removeChild(printFrame), 1000);
    }, 300);
  };

  const renderTabButton = (tab: ReportTab) => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all border ${
        activeTab === tab
          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
          : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-white/5'
      }`}
    >
      {tabLabels[tab]}
    </button>
  );

  const renderInsightBadge = (positive: boolean, text: string) => (
    <div className={`flex items-center gap-1.5 text-[11px] font-mono ${positive ? 'text-emerald-400' : 'text-rose-400'}`}>
      {positive ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
      <span>{text}</span>
    </div>
  );

  const kpiBgClasses: Record<string, string> = {
    cyan: 'p-1.5 rounded-lg bg-cyan-500/20',
    violet: 'p-1.5 rounded-lg bg-purple-500/20',
    emerald: 'p-1.5 rounded-lg bg-emerald-500/20',
    amber: 'p-1.5 rounded-lg bg-amber-500/20',
    magenta: 'p-1.5 rounded-lg bg-pink-500/20',
    rose: 'p-1.5 rounded-lg bg-rose-500/20'
  };

  const renderKPICard = (
    label: string,
    value: string | number,
    icon: React.ReactNode,
    glow: 'cyan' | 'violet' | 'emerald' | 'amber' | 'magenta' | 'rose' = 'cyan',
    insight?: React.ReactNode
  ) => (
    <GlassCard glowColor={glow === 'rose' ? 'magenta' : glow} hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono text-slate-400">{label}</span>
        <div className={kpiBgClasses[glow] || kpiBgClasses.cyan}>
          {icon}
        </div>
      </div>
      <div className="text-xl font-bold text-white mb-1">{value}</div>
      {insight}
    </GlassCard>
  );

  const renderSectionHeader = (icon: React.ReactNode, title: string, subtitle?: string) => (
    <div className="flex items-center justify-between pb-3 border-b border-white/10">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="font-bold text-sm text-white">{title}</h3>
      </div>
      {subtitle && <span className="text-[10px] text-slate-400 font-mono">{subtitle}</span>}
    </div>
  );

  const renderOverviewTab = () => (
    <div className="space-y-6">
      {currentRole !== 'HR' ? (
        <>
          <div className="flex overflow-x-auto gap-3 pb-1 scrollbar-thin">
            <div className="flex-1 shrink-0 min-w-[155px]">{renderKPICard('Total Projects', kpiStats.totalProjects, <FolderKanban size={14} className="text-cyan-400" />, 'cyan')}</div>
            <div className="flex-1 shrink-0 min-w-[155px]">{renderKPICard('Active Tasks', kpiStats.activeTasks, <CheckSquare size={14} className="text-violet-400" />, 'violet')}</div>
            <div className="flex-1 shrink-0 min-w-[155px]">{renderKPICard('Completed', kpiStats.completedTasks, <CheckCircle2 size={14} className="text-emerald-400" />, 'emerald')}</div>
            <div className="flex-1 shrink-0 min-w-[155px]">{renderKPICard('Overdue Tasks', kpiStats.overdueTasks, <AlertTriangle size={14} className="text-amber-400" />, 'amber', kpiStats.overdueTasks > 0 ? renderInsightBadge(false, `${kpiStats.overdueTasks} need attention`) : undefined)}</div>
            <div className="flex-1 shrink-0 min-w-[155px]">{renderKPICard('Completion Rate', `${kpiStats.completionRate}%`, <TrendingUp size={14} className="text-purple-400" />, 'magenta')}</div>
            <div className="flex-1 shrink-0 min-w-[155px]">{renderKPICard('Contributors', kpiStats.activeMembers, <Users size={14} className="text-cyan-400" />, 'cyan')}</div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <GlassCard glowColor="cyan" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
              <div className="glass-panel p-4 rounded-lg">
                {renderSectionHeader(<Activity size={16} className="text-cyan-400" />, 'Project Health')}
                <div className="mt-3" style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={projectHealthData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                      <XAxis dataKey="name" tick={{ fill: chartTextColor, fontSize: 10 }} angle={-25} textAnchor="end" height={60} />
                      <YAxis tick={{ fill: chartTextColor, fontSize: 10 }} domain={[0, 100]} />
                      <Tooltip content={<CustomTooltip />} wrapperStyle={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, borderRadius: 0 }} />
                      <Bar dataKey="progress" fill={chartColors.cyan} radius={[4, 4, 0, 0]} name="Progress" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </GlassCard>

            <GlassCard glowColor="violet" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
              <div className="glass-panel p-4 rounded-lg">
                {renderSectionHeader(<TrendingUp size={16} className="text-violet-400" />, 'Task Activity Trend')}
                <div className="mt-3" style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={taskCompletionTrend} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                      <XAxis dataKey="date" tick={{ fill: chartTextColor, fontSize: 9 }} tickFormatter={formatDateLabel} />
                      <YAxis tick={{ fill: chartTextColor, fontSize: 10 }} />
                      <Tooltip content={({ active, payload, label }) => <CustomTooltip active={active} payload={payload} label={formatDateLabel(label)} />} wrapperStyle={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, borderRadius: 0 }} />
                      <Area type="monotone" dataKey="Created" stroke={chartColors.blue} fill={chartColors.blue} fillOpacity={0.2} />
                      <Area type="monotone" dataKey="Completed" stroke={chartColors.emerald} fill={chartColors.emerald} fillOpacity={0.3} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <GlassCard glowColor="emerald" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
              <div className="glass-panel p-4 rounded-lg">
                {renderSectionHeader(<Target size={16} className="text-emerald-400" />, 'Task Status Distribution')}
                <div className="mt-3 flex items-center justify-center" style={{ height: 260 }}>
                  {taskStatusDist.length === 0 || taskStatusDist.every((d: any) => d.value === 0) ? (
                    <p className="text-xs text-slate-500">No task data available for this period</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={taskStatusDist} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={3}>
                          {taskStatusDist.map((_entry: any, idx: number) => (
                            <Cell key={idx} fill={pieColors[idx % pieColors.length]} stroke={chartPieStroke} strokeWidth={2} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} wrapperStyle={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, borderRadius: 0 }} />
                        <Legend wrapperStyle={{ fontSize: '10px', color: chartTextColor }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </GlassCard>

            <GlassCard glowColor="magenta" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
              <div className="glass-panel p-4 rounded-lg">
                {renderSectionHeader(<AlertTriangle size={16} className="text-amber-400" />, 'Task Priority Distribution')}
                <div className="mt-3 flex items-center justify-center" style={{ height: 260 }}>
                  {taskPriorityDist.length === 0 || taskPriorityDist.every((d: any) => d.value === 0) ? (
                    <p className="text-xs text-slate-500">No task data available for this period</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={taskPriorityDist} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={3}>
                          {taskPriorityDist.map((_entry: any, idx: number) => (
                            <Cell key={idx} fill={[chartColors.amber, chartColors.cyan, chartColors.violet, chartColors.rose][idx % 4]} stroke={chartPieStroke} strokeWidth={2} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} wrapperStyle={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, borderRadius: 0 }} />
                        <Legend wrapperStyle={{ fontSize: '10px', color: chartTextColor }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </GlassCard>
          </div>

          <GlassCard glowColor="cyan" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Clock size={16} className="text-cyan-400" />, 'Upcoming Deadlines', `${deadlineData.dueToday.length + deadlineData.dueTomorrow.length + deadlineData.upcoming.length} upcoming`)}
              <div className="mt-3">
                {(() => {
                  const grouped: Record<string, any[]> = {};
                  const allItems = [...deadlineData.dueToday, ...deadlineData.dueTomorrow, ...deadlineData.upcoming];
                  allItems.forEach((t: any) => {
                    const d = t.dueDate;
                    if (!grouped[d]) grouped[d] = [];
                    grouped[d].push(t);
                  });
                  const sortedDates = Object.keys(grouped).sort();
                  if (sortedDates.length === 0) {
                    return <p className="text-xs text-slate-500 text-center py-4">No upcoming deadlines in this range</p>;
                  }
                  return (
                    <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
                      {sortedDates.map((date) => (
                        <div key={date}>
                          <div className="text-[10px] font-mono text-slate-400 mb-1.5 flex items-center gap-2">
                            <span>{date}</span>
                            {date === todayStr() && <span className="text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded text-[9px]">TODAY</span>}
                          </div>
                          {grouped[date].map((t: any) => (
                            <div key={t.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-white/5 text-xs mb-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <StatusBadge status={t.priority} size="sm" />
                                <span className="text-slate-200 truncate">{t.title}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </GlassCard>

          <GlassCard glowColor="violet" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Users size={16} className="text-violet-400" />, 'Member Workload')}
              <div className="mt-3 overflow-y-auto max-h-72">
                {workloadData.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">No workload data available</p>
                ) : (
                  <div style={{ height: Math.max(workloadData.length * 40, 200) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={workloadData} layout="vertical" margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                        <XAxis type="number" tick={{ fill: chartTextColor, fontSize: 10 }} />
                        <YAxis dataKey="name" type="category" tick={{ fill: chartTextColor, fontSize: 10 }} width={80} />
                        <Tooltip content={<CustomTooltip />} wrapperStyle={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, borderRadius: 0 }} />
                        <Bar dataKey="active" fill={chartColors.cyan} radius={[0, 4, 4, 0]} name="Active" stackId="a" />
                        <Bar dataKey="review" fill={chartColors.amber} radius={[0, 0, 0, 0]} name="Review" stackId="a" />
                        <Bar dataKey="completed" fill={chartColors.emerald} radius={[0, 0, 0, 0]} name="Completed" stackId="a" />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </GlassCard>

        </>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            {renderKPICard('Present Today', hrOverviewStats.presentToday, <UserCheck size={14} className="text-emerald-400" />, 'emerald')}
            {renderKPICard('Absent', hrOverviewStats.absentToday, <UserX size={14} className="text-rose-400" />, 'rose')}
            {renderKPICard('On Leave', hrOverviewStats.onLeaveToday, <Coffee size={14} className="text-cyan-400" />, 'cyan')}
            {renderKPICard('Late', hrOverviewStats.lateToday, <Clock size={14} className="text-amber-400" />, 'amber')}
            {renderKPICard('Avg Hours', `${hrOverviewStats.avgHours}h`, <Hourglass size={14} className="text-violet-400" />, 'violet')}
            {renderKPICard('Pending Leaves', hrOverviewStats.pendingLeaveReqs, <FileSpreadsheet size={14} className="text-purple-400" />, 'magenta')}
            {renderKPICard('Pending Corrections', hrOverviewStats.pendingCorrections, <ListTodo size={14} className="text-amber-400" />, 'amber')}
          </div>

          <GlassCard glowColor="cyan" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Users size={16} className="text-cyan-400" />, 'Today Attendance Overview')}
              <div className="mt-3" style={{ height: 260 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={[
                    { name: 'Present', value: hrOverviewStats.presentToday },
                    { name: 'Absent', value: hrOverviewStats.absentToday },
                    { name: 'On Leave', value: hrOverviewStats.onLeaveToday },
                    { name: 'Late', value: hrOverviewStats.lateToday }
                  ]} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                    <XAxis dataKey="name" tick={{ fill: chartTextColor, fontSize: 10 }} />
                    <YAxis tick={{ fill: chartTextColor, fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} wrapperStyle={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, borderRadius: 0 }} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {[0, 1, 2, 3].map((i) => (
                        <Cell key={i} fill={[chartColors.emerald, chartColors.rose, chartColors.cyan, chartColors.amber][i]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </GlassCard>

        </>
      )}
    </div>
  );

  const renderProjectsTab = () => (
    <div className="space-y-5">
      <div className="flex overflow-x-auto gap-3 pb-1 scrollbar-thin">
        <div className="flex-1 shrink-0 min-w-[155px]">{renderKPICard('Total Projects', roleFiltered.projects.length, <FolderKanban size={14} className="text-cyan-400" />, 'cyan')}</div>
        <div className="flex-1 shrink-0 min-w-[155px]">{renderKPICard('Active', roleFiltered.projects.filter((p: any) => p.status === 'Active').length, <Activity size={14} className="text-emerald-400" />, 'emerald')}</div>
        <div className="flex-1 shrink-0 min-w-[155px]">{renderKPICard('Completed', roleFiltered.projects.filter((p: any) => p.status === 'Completed').length, <CheckCircle2 size={14} className="text-emerald-400" />, 'magenta')}</div>
        <div className="flex-1 shrink-0 min-w-[155px]">{renderKPICard('Avg Rate', roleFiltered.projects.length > 0 ? `${Math.round(roleFiltered.projects.reduce((s: number, p: any) => s + (p.progress || 0), 0) / roleFiltered.projects.length)}%` : '0%', <TrendingUp size={14} className="text-violet-400" />, 'violet')}</div>
      </div>

      <GlassCard glowColor="cyan" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
        <div className="glass-panel p-4 rounded-lg">
          {renderSectionHeader(<BarChart3 size={16} className="text-cyan-400" />, 'Project Progress')}
          <div className="mt-3 overflow-x-auto">
            <div style={{ minWidth: Math.max(projectHealthData.length * 80, 400), height: 300 }}>
              {projectHealthData.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">No project data available</p>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={projectHealthData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                    <XAxis dataKey="name" tick={{ fill: chartTextColor, fontSize: 10 }} angle={-25} textAnchor="end" height={60} />
                    <YAxis tick={{ fill: chartTextColor, fontSize: 10 }} domain={[0, 100]} />
                    <Tooltip content={<CustomTooltip />} wrapperStyle={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, borderRadius: 0 }} />
                    <Legend wrapperStyle={{ fontSize: '10px' }} />
                    <Bar dataKey="progress" fill={chartColors.cyan} radius={[4, 4, 0, 0]} name="Progress %" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </div>
      </GlassCard>

      <GlassCard glowColor="violet" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
        <div className="glass-panel p-4 rounded-lg">
          {renderSectionHeader(<BarChart3 size={16} className="text-violet-400" />, 'Project Details')}
          <div className="overflow-y-auto max-h-[400px] mt-3">
            <table className="density-table w-full" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '28%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '8%' }} />
              </colgroup>
              <thead className="sticky top-0 z-10">
                <tr>
                  <th>Project</th>
                  <th>Code</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Tasks</th>
                  <th>Overdue</th>
                  <th>Health</th>
                </tr>
              </thead>
              <tbody>
                {(roleFiltered.projects || []).length === 0 ? (
                  <tr><td colSpan={7} className="text-center text-slate-500 py-6">No projects in range</td></tr>
                ) : (
                  (roleFiltered.projects as any[]).map((p: any) => {
                    const pTasksCount = p.taskCount || 0;
                    const overdueCount = p.overdueCount || 0;
                    const healthLabel = p.healthLabel || ((p.progress || 0) >= 70 ? 'On Track' : (p.progress || 0) >= 40 ? 'At Risk' : 'Needs Attention');
                    return (
                      <tr key={p.id} onClick={() => setSelectedProjectId(p.id)} className="cursor-pointer hover:bg-white/5 transition-colors">
                        <td className="text-white font-medium truncate">{p.title}</td>
                        <td className="text-slate-400 font-mono text-[10px] truncate">{p.code}</td>
                        <td><StatusBadge status={p.status} size="sm" /></td>
                        <td>
                          <div className="flex items-center gap-2">
                            <div className="w-12 h-1.5 rounded-full bg-slate-700 shrink-0">
                              <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500" style={{ width: `${p.progress || 0}%` }} />
                            </div>
                            <span className="text-[10px] font-mono text-slate-300">{p.progress || 0}%</span>
                          </div>
                        </td>
                        <td className="font-mono text-xs text-center">{pTasksCount}</td>
                        <td className={`font-mono text-xs text-center ${overdueCount > 0 ? 'text-rose-400' : 'text-slate-400'}`}>{overdueCount}</td>
                        <td>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                            healthLabel === 'On Track' ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                            healthLabel === 'At Risk' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                            'text-rose-400 bg-rose-500/10 border-rose-500/20'
                          }`}>{healthLabel}</span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </GlassCard>
    </div>
  );

  const renderProjectDetail = () => {
    if (detailLoading) {
      return (
        <div className="text-center py-12 text-slate-500">
          <p className="text-xs text-slate-400">Loading project details...</p>
          <button onClick={() => setSelectedProjectId(null)} className="mt-3 text-xs text-cyan-400 hover:underline">Back to projects</button>
        </div>
      );
    }

    const project = detailProject || (roleFiltered.projects as any[]).find((p: any) => p.id === selectedProjectId);
    if (!project) {
      return (
        <div className="text-center py-12 text-slate-500">
          <p className="text-xs">Project not found.</p>
          <button onClick={() => setSelectedProjectId(null)} className="mt-3 text-xs text-cyan-400 hover:underline">Back to projects</button>
        </div>
      );
    }

    const projectTasks = roleFiltered.tasks.filter((t: any) => t.projectId === selectedProjectId);
    const memberUsers = users.filter((u: any) => (project.memberIds || []).includes(u.id));
    const teamLeadUser = users.find((u: any) => u.id === project.teamLeadId);
    const milestones = detailProject?.milestones || project.milestones || [];
    const attachments = detailProject?.files || project.files || [];

    const totalTasks = projectTasks.length;
    const completedTasks = projectTasks.filter((t: any) => t.status === 'Done').length;
    const activeTasks = projectTasks.filter((t: any) => t.status !== 'Done').length;
    const overdueTasks = projectTasks.filter((t: any) => t.status !== 'Done' && t.dueDate < todayStr()).length;
    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    const statusOrder = ['Todo', 'In Progress', 'Review', 'Done', 'Blocked'];
    const statusCounts: Record<string, number> = {};
    const statusColorMap: Record<string, string> = {
      Todo: 'text-slate-400',
      'In Progress': 'text-cyan-400',
      Review: 'text-amber-400',
      Done: 'text-emerald-400',
      Blocked: 'text-rose-400',
    };
    projectTasks.forEach((t: any) => { statusCounts[t.status] = (statusCounts[t.status] || 0) + 1; });

    const formatHumanDate = (d: string | undefined) => {
      if (!d) return '\u2014';
      const date = new Date(d.slice(0, 10) + 'T00:00:00');
      return date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const formatFileSize = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    };

    return (
      <div className="space-y-5">
        <button onClick={() => setSelectedProjectId(null)} className="flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300 transition-colors">
          <span>&larr;</span> Back to Projects
        </button>

        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 p-5 glass-panel-glow border-cyan-500/30 rounded-xl">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30">{project.code}</span>
              <StatusBadge status={project.status} size="sm" />
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                (project.progress || 0) >= 70 ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20' :
                (project.progress || 0) >= 40 ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                'text-rose-400 bg-rose-500/10 border-rose-500/20'
              }`}>{project.healthLabel || ((project.progress || 0) >= 70 ? 'On Track' : (project.progress || 0) >= 40 ? 'At Risk' : 'Needs Attention')}</span>
            </div>
            <h2 className="text-lg font-bold text-white">{project.title}</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-slate-500">Progress</span>
            <div className="w-24 h-2 rounded-full bg-slate-700">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500" style={{ width: `${project.progress || 0}%` }} />
            </div>
            <span className="text-sm font-bold text-white">{project.progress || 0}%</span>
          </div>
        </div>

        {project.description ? (
          <GlassCard glowColor="cyan" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<FileText size={16} className="text-cyan-400" />, 'Description')}
              <p className="mt-3 text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{project.description}</p>
            </div>
          </GlassCard>
        ) : null}

        <div className="flex overflow-x-auto gap-3 pb-1 scrollbar-thin">
          <div className="flex-1 shrink-0 min-w-[120px]">{renderKPICard('Total Tasks', totalTasks, <CheckSquare size={14} className="text-cyan-400" />, 'cyan')}</div>
          <div className="flex-1 shrink-0 min-w-[120px]">{renderKPICard('Completed', completedTasks, <CheckCircle2 size={14} className="text-emerald-400" />, 'emerald')}</div>
          <div className="flex-1 shrink-0 min-w-[120px]">{renderKPICard('Active', activeTasks, <Activity size={14} className="text-violet-400" />, 'violet')}</div>
          <div className="flex-1 shrink-0 min-w-[120px]">{renderKPICard('Overdue', overdueTasks, <AlertTriangle size={14} className="text-amber-400" />, 'amber', overdueTasks > 0 ? renderInsightBadge(false, `${overdueTasks} overdue`) : undefined)}</div>
          <div className="flex-1 shrink-0 min-w-[120px]">{renderKPICard('Completion Rate', `${completionRate}%`, <TrendingUp size={14} className="text-purple-400" />, 'magenta')}</div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <GlassCard glowColor="cyan" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Calendar size={16} className="text-cyan-400" />, 'Timeline')}
              <div className="mt-3 space-y-2.5 text-xs">
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-slate-400">Created</span>
                  <span className="text-slate-200 font-mono">{formatHumanDate(project.createdAt || project.startDate)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-slate-400">Start Date</span>
                  <span className="text-slate-200 font-mono">{formatHumanDate(project.startDate)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-slate-400">Deadline</span>
                  <span className="text-slate-200 font-mono">{formatHumanDate(project.targetDate)}</span>
                </div>
                {project.creationReason && (
                  <div className="flex justify-between py-1.5">
                    <span className="text-slate-400">Reason</span>
                    <span className="text-slate-200 text-right max-w-[60%]">{project.creationReason}</span>
                  </div>
                )}
              </div>
            </div>
          </GlassCard>

          <GlassCard glowColor="violet" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Users size={16} className="text-violet-400" />, 'Team')}
              <div className="mt-3 space-y-2.5 text-xs">
                <div className="flex justify-between py-1.5 border-b border-white/5">
                  <span className="text-slate-400">Project Lead</span>
                  <span className="text-slate-200 font-mono">{teamLeadUser?.name || project.teamLeadId || '\u2014'}</span>
                </div>
                {memberUsers.length > 0 ? (
                  <div className="pt-1">
                    <span className="text-slate-400 block mb-2">Members ({memberUsers.length})</span>
                    <div className="max-h-[200px] overflow-y-auto space-y-1.5 pr-1">
                      {memberUsers.map((u: any) => (
                        <div key={u.id} className="flex items-center justify-between py-1 px-2 rounded bg-slate-900/40">
                          <span className="text-slate-200">{u.name || u.id}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 text-center pt-2">No members assigned</p>
                )}
              </div>
            </div>
          </GlassCard>
        </div>

        <GlassCard glowColor="emerald" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
          <div className="glass-panel p-4 rounded-lg">
            {renderSectionHeader(<Target size={16} className="text-emerald-400" />, 'Task Status Breakdown')}
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
              {statusOrder.map((status) => (
                <div key={status} className="p-3 rounded-lg bg-slate-900/60 border border-white/5 text-center">
                  <div className={`text-lg font-bold ${statusColorMap[status] || 'text-slate-300'}`}>{statusCounts[status] || 0}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{status}</div>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>

        <GlassCard glowColor="magenta" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
          <div className="glass-panel p-4 rounded-lg">
            {renderSectionHeader(<ListTodo size={16} className="text-purple-400" />, 'Tasks', `${totalTasks} tasks`)}
            <div className="overflow-y-auto max-h-80 mt-3">
              {totalTasks === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">No tasks for this project</p>
              ) : (
                <table className="density-table w-full" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '30%' }} />
                    <col style={{ width: '15%' }} />
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '18%' }} />
                    <col style={{ width: '13%' }} />
                    <col style={{ width: '12%' }} />
                  </colgroup>
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th>Task</th>
                      <th>Status</th>
                      <th>Priority</th>
                      <th>Assignee</th>
                      <th>Due Date</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projectTasks.map((t: any) => {
                      const assignee = users.find((u: any) => u.id === t.assigneeId);
                      return (
                        <tr key={t.id}>
                          <td className="text-slate-200 font-medium truncate" title={t.title}>{t.title}</td>
                          <td><StatusBadge status={t.status} size="sm" /></td>
                          <td><StatusBadge status={t.priority} size="sm" /></td>
                          <td className="text-xs text-slate-400 truncate">{assignee?.name || t.assigneeId || '\u2014'}</td>
                          <td className="text-xs font-mono text-slate-400">{t.dueDate ? formatHumanDate(t.dueDate) : '\u2014'}</td>
                          <td className="text-xs font-mono text-slate-400">{t.createdAt ? formatHumanDate(t.createdAt) : '\u2014'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </GlassCard>

        {milestones.length > 0 && (
          <GlassCard glowColor="amber" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Target size={16} className="text-amber-400" />, 'Milestones', `${milestones.length} milestone${milestones.length !== 1 ? 's' : ''}`)}
              <div className="overflow-y-auto max-h-[260px] mt-3 space-y-1.5 pr-1">
                {milestones.map((m: any) => (
                  <div key={m.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-white/5">
                    <div className="flex items-start gap-2 min-w-0">
                      <span className={`mt-0.5 shrink-0 ${m.completed ? 'text-emerald-400' : 'text-slate-500'}`}>
                        {m.completed ? <CheckCircle2 size={14} /> : <Circle size={14} />}
                      </span>
                      <div className="min-w-0">
                        <span className={`text-xs font-medium ${m.completed ? 'text-emerald-300' : 'text-slate-200'}`}>{m.title}</span>
                        {m.description && <p className="text-[10px] text-slate-500 mt-0.5 truncate">{m.description}</p>}
                      </div>
                    </div>
                    <div className="shrink-0 flex items-center gap-2 pl-2">
                      {m.dueDate && <span className="text-[10px] font-mono text-slate-500">{formatHumanDate(m.dueDate)}</span>}
                      {m.completedAt && <span className="text-[9px] text-emerald-500/70">Completed {formatHumanDate(m.completedAt)}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        )}

        {attachments.length > 0 && (
          <GlassCard glowColor="violet" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Paperclip size={16} className="text-violet-400" />, 'Attachments', `${attachments.length} file${attachments.length !== 1 ? 's' : ''}`)}
              <div className="overflow-y-auto max-h-[260px] mt-3 space-y-1.5 pr-1">
                {attachments.map((f: any) => {
                  const uploader = users.find((u: any) => u.id === f.uploadedBy);
                  const fileSize = f.size != null ? (typeof f.size === 'number' ? formatFileSize(f.size) : f.size) : '';
                  const fileType = f.mimeType || f.type || '';
                  const isImage = fileType.startsWith('image/');
                  return (
                    <div key={f.id} className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60 border border-white/5">
                      <div className="flex items-center gap-2 min-w-0">
                        {isImage ? <FileImage size={14} className="text-cyan-400 shrink-0" /> : <Paperclip size={14} className="text-slate-500 shrink-0" />}
                        <span className="text-xs text-slate-200 truncate" title={f.name}>{f.name}</span>
                      </div>
                      <div className="shrink-0 flex items-center gap-2 pl-2 text-[10px] text-slate-500 font-mono">
                        {fileSize && <span>{fileSize}</span>}
                        {uploader?.name && <span>{uploader.name}</span>}
                        {f.uploadedAt && <span>{formatHumanDate(f.uploadedAt)}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </GlassCard>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={() => handleProjectPdfExport(
              project, projectTasks, teamLeadUser, memberUsers,
              totalTasks, completedTasks, activeTasks, overdueTasks,
              completionRate, statusCounts, milestones, attachments
            )}
            className="px-3 py-2 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            <FileText size={12} />
            Export Project PDF
          </button>
        </div>
      </div>
    );
  };

  const renderTeamsTab = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {renderKPICard('Departments', teamStats.length, <Users size={14} className="text-cyan-400" />, 'cyan')}
        {renderKPICard('Total Tasks', teamStats.reduce((s: number, t: any) => s + (t.tasks || 0), 0), <CheckSquare size={14} className="text-violet-400" />, 'violet')}
        {renderKPICard('Completed', teamStats.reduce((s: number, t: any) => s + (t.completed || 0), 0), <CheckCircle2 size={14} className="text-emerald-400" />, 'emerald')}
        {renderKPICard('Avg Rate', teamStats.length > 0 ? `${Math.round(teamStats.reduce((s: number, t: any) => s + (t.rate || 0), 0) / teamStats.length)}%` : '0%', <Target size={14} className="text-emerald-400" />, 'magenta')}
      </div>

      <GlassCard glowColor="cyan" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
        <div className="glass-panel p-4 rounded-lg">
          {renderSectionHeader(<BarChart3 size={16} className="text-cyan-400" />, 'Department Performance')}
          <div className="mt-3" style={{ height: 300 }}>
            {teamStats.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">No department data available</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamStats} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="department" tick={{ fill: chartTextColor, fontSize: 9 }} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: chartTextColor, fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} wrapperStyle={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, borderRadius: 0 }} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Bar dataKey="tasks" fill={chartColors.cyan} radius={[4, 4, 0, 0]} name="Tasks" />
                  <Bar dataKey="completed" fill={chartColors.emerald} radius={[4, 4, 0, 0]} name="Completed" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </GlassCard>

      <div className="overflow-x-auto">
        <table className="density-table">
          <thead>
            <tr>
              <th>Department</th>
              <th>Members</th>
              <th>Projects</th>
              <th>Tasks</th>
              <th>Completed</th>
              <th>Completion Rate</th>
            </tr>
          </thead>
          <tbody>
            {teamStats.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-slate-500 py-6">No data available</td></tr>
            ) : (
              teamStats.map((t: any) => (
                <tr key={t.department}>
                  <td className="text-white font-medium">{t.department}</td>
                  <td className="font-mono text-xs">{t.members}</td>
                  <td className="font-mono text-xs">{t.projects}</td>
                  <td className="font-mono text-xs">{t.tasks}</td>
                  <td className="font-mono text-xs text-emerald-400">{t.completed}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-1.5 rounded-full bg-slate-700">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${t.rate}%` }} />
                      </div>
                      <span className="text-[10px] font-mono text-slate-300">{t.rate}%</span>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderWorkloadTab = () => {
    const members = filteredWorkloadMembers;
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {renderKPICard('Team Members', workloadKpiStats.totalMembers, <Users size={14} className="text-cyan-400" />, 'cyan')}
          {renderKPICard('Active Members', workloadKpiStats.activeMembers, <Activity size={14} className="text-emerald-400" />, 'emerald')}
          {renderKPICard('Avg Active Tasks / Member', workloadKpiStats.avgActiveTasks, <BarChart3 size={14} className="text-violet-400" />, 'violet')}
          {renderKPICard('Members with Overdue', workloadKpiStats.membersWithOverdue, <AlertTriangle size={14} className="text-rose-400" />, 'rose',
            workloadKpiStats.membersWithOverdue > 0 ? renderInsightBadge(false, `${workloadKpiStats.membersWithOverdue} need attention`) : undefined
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <GlassCard>
            <div className="p-4">
              {renderSectionHeader(<BarChart3 size={16} className="text-cyan-400" />, 'Tasks Per Member')}
              <div className="h-60">
                {members.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-slate-500 text-xs">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={members} layout="vertical" margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                      <XAxis type="number" tick={{ fill: chartTextColor, fontSize: 10 }} />
                      <YAxis dataKey="name" type="category" tick={{ fill: chartTextColor, fontSize: 10 }} width={80} />
                      <Tooltip content={<CustomTooltip />} wrapperStyle={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, borderRadius: 0 }} />
                      <Legend wrapperStyle={{ fontSize: '10px' }} />
                      <Bar dataKey="active" fill={chartColors.cyan} radius={[0, 4, 4, 0]} name="Active" stackId="a" />
                      <Bar dataKey="review" fill={chartColors.amber} radius={[0, 0, 0, 0]} name="Review" stackId="a" />
                      <Bar dataKey="overdue" fill={chartColors.rose} radius={[0, 0, 0, 0]} name="Overdue" stackId="a" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <div className="p-4">
              {renderSectionHeader(<CheckCircle2 size={16} className="text-emerald-400" />, 'Completion By Member')}
              <div className="h-60">
                {members.length === 0 ? (
                  <div className="flex items-center justify-center h-full text-slate-500 text-xs">No data</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={members.map((m: any) => ({
                      name: m.name,
                      rate: m.totalTasks > 0 ? Math.round((m.completed / m.totalTasks) * 100) : 0,
                    }))} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                      <XAxis type="number" tick={{ fill: chartTextColor, fontSize: 10 }} domain={[0, 100]} />
                      <YAxis dataKey="name" type="category" tick={{ fill: chartTextColor, fontSize: 10 }} width={80} />
                      <Tooltip formatter={(value: any) => `${value}%`} />
                      <Bar dataKey="rate" fill={chartColors.emerald} radius={[0, 4, 4, 0]} name="Completion Rate" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </GlassCard>
        </div>

        <GlassCard>
          <div className="p-4 space-y-3">
            {renderSectionHeader(<Filter size={16} className="text-cyan-400" />, 'Filters')}
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[160px]">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                <input
                  type="text"
                  value={workloadSearchQuery}
                  onChange={(e) => setWorkloadSearchQuery(e.target.value)}
                  placeholder="Search members..."
                  className="w-full pl-7 pr-7 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/60 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50 transition-colors"
                />
                {workloadSearchQuery && (
                  <button onClick={() => setWorkloadSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                    <X size={12} />
                  </button>
                )}
              </div>
              <select
                value={workloadFilterRole}
                onChange={(e) => setWorkloadFilterRole(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/60 text-xs text-slate-300 outline-none focus:border-cyan-500/50 min-w-[100px]"
              >
                <option value="">All Roles</option>
                {workloadRoleOptions.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <select
                value={workloadFilterWorkload}
                onChange={(e) => setWorkloadFilterWorkload(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/60 text-xs text-slate-300 outline-none focus:border-cyan-500/50 min-w-[100px]"
              >
                <option value="">All Workload</option>
                {workloadWorkloadOptions.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
              {(workloadSearchQuery || workloadFilterRole || workloadFilterWorkload) && (
                <button
                  onClick={() => { setWorkloadSearchQuery(''); setWorkloadFilterRole(''); setWorkloadFilterWorkload(''); }}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-all flex items-center gap-1"
                >
                  <X size={11} /> Clear
                </button>
              )}
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <div className="p-4">
            {renderSectionHeader(<Users size={16} className="text-violet-400" />, `Member Workload (${members.length})`)}
            <div className="max-h-[400px] overflow-y-auto mt-3 custom-scrollbar">
              {members.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <Users size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No members available</p>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-700/30 sticky top-0 bg-slate-900 z-10">
                      <th className="pb-2 pr-2 font-semibold">Member</th>
                      <th className="pb-2 pr-2 font-semibold">Role</th>
                      <th className="pb-2 pr-2 font-semibold text-center">Active</th>
                      <th className="pb-2 pr-2 font-semibold text-center">Completed</th>
                      <th className="pb-2 pr-2 font-semibold text-center">Overdue</th>
                      <th className="pb-2 pr-2 font-semibold text-center">Projects</th>
                      <th className="pb-2 font-semibold text-center">Workload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {members.map((m: any) => {
                      const total = m.totalTasks;
                      const wlLabel = total >= 8 ? 'Heavy' : total >= 4 ? 'Moderate' : 'Light';
                      return (
                        <tr
                          key={m.userId}
                          onClick={() => setSelectedMemberId(m.userId)}
                          className="cursor-pointer border-b border-slate-700/20 hover:bg-slate-700/20 transition-colors group"
                        >
                          <td className="py-2 pr-2">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-slate-700 overflow-hidden shrink-0">
                                {m.avatar ? <img src={m.avatar} alt="" className="w-full h-full object-cover" /> : <User size={12} className="text-slate-400 m-auto" />}
                              </div>
                              <span className="text-slate-200 font-medium group-hover:text-cyan-300 transition-colors">{m.name}</span>
                            </div>
                          </td>
                          <td className="py-2 pr-2 text-slate-400">{m.role || m.department || '\u2014'}</td>
                          <td className="py-2 pr-2 text-center font-mono">{m.active}</td>
                          <td className="py-2 pr-2 text-center font-mono text-emerald-400">{m.completed}</td>
                          <td className={`py-2 pr-2 text-center font-mono ${m.overdue > 0 ? 'text-rose-400' : 'text-slate-400'}`}>{m.overdue > 0 ? m.overdue : 0}</td>
                          <td className="py-2 pr-2 text-center font-mono text-slate-400">{m.projectCount}</td>
                          <td className="py-2 text-center">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                              wlLabel === 'Heavy' ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' :
                              wlLabel === 'Moderate' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                              'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                            }`}>{wlLabel}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <div className="p-4">
            {renderSectionHeader(<Users size={16} className="text-cyan-400" />, `Team Members (${members.length})`)}
            <div className="max-h-[420px] overflow-y-auto mt-3 custom-scrollbar">
              {members.length === 0 ? (
                <div className="text-center py-12 text-slate-500">
                  <Users size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-xs">No members match the current filters</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {members.map((m: any) => {
                    const total = m.totalTasks;
                    const wlLabel = total >= 8 ? 'Heavy' : total >= 4 ? 'Moderate' : 'Light';
                    const barWidth = Math.min(total / 12, 1) * 100;
                    return (
                      <div
                        key={m.userId}
                        onClick={() => setSelectedMemberId(m.userId)}
                        className="p-3 rounded-xl bg-slate-800/40 border border-slate-700/30 hover:bg-slate-700/30 hover:border-cyan-500/30 cursor-pointer transition-all group"
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div className="w-8 h-8 rounded-full bg-slate-700 overflow-hidden shrink-0">
                            {m.avatar ? <img src={m.avatar} alt="" className="w-full h-full object-cover" /> : <User size={14} className="text-slate-400 m-auto" />}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs text-slate-200 font-medium truncate group-hover:text-cyan-300 transition-colors">{m.name}</div>
                            <div className="text-[10px] text-slate-500 truncate">{m.title || m.role || m.department || '\u2014'}</div>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                          <span className="text-slate-500">Active</span>
                          <span className="text-slate-200 font-mono text-right">{m.active}</span>
                          <span className="text-slate-500">Completed</span>
                          <span className="text-emerald-400 font-mono text-right">{m.completed}</span>
                          <span className="text-slate-500">Overdue</span>
                          <span className={`font-mono text-right ${m.overdue > 0 ? 'text-rose-400' : 'text-slate-400'}`}>{m.overdue > 0 ? m.overdue : 0}</span>
                          <span className="text-slate-500">Projects</span>
                          <span className="text-slate-200 font-mono text-right">{m.projectCount}</span>
                        </div>
                        {total > 0 && (
                          <div className="mt-2">
                            <div className="flex justify-between text-[9px] text-slate-500 mb-1">
                              <span>Current workload</span>
                              <span className={wlLabel === 'Heavy' ? 'text-rose-400' : wlLabel === 'Moderate' ? 'text-amber-400' : 'text-emerald-400'}>{wlLabel}</span>
                            </div>
                            <div className="h-1.5 rounded-full bg-slate-700/50 overflow-hidden">
                              <div className={`h-full rounded-full transition-all duration-300 ${
                                wlLabel === 'Heavy' ? 'bg-rose-500' : wlLabel === 'Moderate' ? 'bg-amber-500' : 'bg-emerald-500'
                              }`} style={{ width: `${barWidth}%` }} />
                            </div>
                          </div>
                        )}
                        <div className="mt-2 text-right">
                          <span className="text-[10px] text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity">View Details \u2192</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </GlassCard>
      </div>
    );
  };

  const renderDeadlinesTab = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {renderKPICard('Due Today', deadlineData.dueToday.length, <Clock size={14} className="text-cyan-400" />, 'cyan')}
        {renderKPICard('Due Tomorrow', deadlineData.dueTomorrow.length, <Calendar size={14} className="text-violet-400" />, 'violet')}
        {renderKPICard('Upcoming', deadlineData.upcoming.length, <Target size={14} className="text-emerald-400" />, 'emerald')}
        {renderKPICard('Overdue', deadlineData.overdue.length, <AlertTriangle size={14} className="text-amber-400" />, 'amber',
          deadlineData.overdue.length > 0 ? renderInsightBadge(false, `${deadlineData.overdue.length} overdue`) : undefined
        )}
      </div>

      <div className="space-y-4">
        {deadlineData.dueToday.length > 0 && (
          <GlassCard glowColor="cyan" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Clock size={16} className="text-cyan-400" />, 'Due Today', `${deadlineData.dueToday.length} tasks`)}
              <div className="mt-3 space-y-2">
                {deadlineData.dueToday.map((t: any) => (
                  <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/60 border border-cyan-500/20 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusBadge status={t.priority} size="sm" />
                      <span className="text-slate-200 truncate">{t.title}</span>
                    </div>
                    <StatusBadge status={t.status} size="sm" />
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        )}

        {deadlineData.dueTomorrow.length > 0 && (
          <GlassCard glowColor="violet" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Calendar size={16} className="text-violet-400" />, 'Due Tomorrow', `${deadlineData.dueTomorrow.length} tasks`)}
              <div className="mt-3 space-y-2">
                {deadlineData.dueTomorrow.map((t: any) => (
                  <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/60 border border-purple-500/20 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusBadge status={t.priority} size="sm" />
                      <span className="text-slate-200 truncate">{t.title}</span>
                    </div>
                    <StatusBadge status={t.status} size="sm" />
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        )}

        {deadlineData.upcoming.length > 0 && (
          <GlassCard glowColor="emerald" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Target size={16} className="text-emerald-400" />, 'Upcoming Deadlines', `${deadlineData.upcoming.length} tasks`)}
              <div className="mt-3 space-y-2">
                {deadlineData.upcoming.map((t: any) => (
                  <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/60 border border-emerald-500/20 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusBadge status={t.priority} size="sm" />
                      <span className="text-slate-200 truncate">{t.title}</span>
                    </div>
                    <span className="font-mono text-[10px] text-purple-300">{t.dueDate}</span>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        )}

        {deadlineData.overdue.length > 0 && (
          <GlassCard glowColor="amber" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg border border-rose-500/20">
              {renderSectionHeader(<AlertTriangle size={16} className="text-rose-400" />, 'Overdue Tasks', `${deadlineData.overdue.length} overdue`)}
              <div className="mt-3 space-y-2">
                {deadlineData.overdue.map((t: any) => (
                  <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/60 border border-rose-500/20 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <StatusBadge status={t.priority} size="sm" />
                      <span className="text-slate-200 truncate">{t.title}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={t.status} size="sm" />
                      <span className="font-mono text-[10px] text-rose-400">{t.dueDate}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        )}

        {deadlineData.dueToday.length === 0 && deadlineData.dueTomorrow.length === 0 && deadlineData.upcoming.length === 0 && deadlineData.overdue.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <Calendar size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-xs">No deadlines in the selected date range</p>
          </div>
        )}
      </div>
    </div>
  );

  // ── Tasks tab ─────────────────────────────────────────────────────
  const renderTasksTab = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {renderKPICard('Total', taskKpiStats.total, <ClipboardList size={14} className="text-cyan-400" />, 'cyan')}
        {renderKPICard('Todo', taskKpiStats.todo, <ListTodo size={14} className="text-cyan-400" />, 'cyan')}
        {renderKPICard('In Progress', taskKpiStats.inProgress, <Clock size={14} className="text-amber-400" />, 'amber')}
        {renderKPICard('Review', taskKpiStats.review, <Activity size={14} className="text-amber-400" />, 'amber')}
        {renderKPICard('Done', taskKpiStats.completed, <CheckCircle2 size={14} className="text-emerald-400" />, 'emerald')}
        {renderKPICard('Blocked', taskKpiStats.blocked, <AlertTriangle size={14} className="text-rose-400" />, 'magenta')}
        {renderKPICard('Overdue', taskKpiStats.overdue, <AlertTriangle size={14} className="text-rose-400" />, 'magenta')}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <GlassCard>
          <div className="p-4">
            {renderSectionHeader(<Activity size={16} className="text-cyan-400" />, 'Status Distribution')}
            <div className="h-52">
              {taskStatusDistData.every((d) => d.value === 0) ? (
                <div className="flex items-center justify-center h-full text-slate-500 text-xs">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={taskStatusDistData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {taskStatusDistData.map((entry, idx) => (
                        <Cell key={idx} fill={['#22d3ee', '#f59e0b', '#f59e0b', '#10b981', '#f43f5e'][idx % 5]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </GlassCard>

        <GlassCard>
          <div className="p-4">
            {renderSectionHeader(<BarChart3 size={16} className="text-violet-400" />, 'Priority Distribution')}
            <div className="h-52">
              {taskPriorityDistData.every((d) => d.value === 0) ? (
                <div className="flex items-center justify-center h-full text-slate-500 text-xs">No data</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={taskPriorityDistData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {taskPriorityDistData.map((entry, idx) => (
                        <Cell key={idx} fill={['#10b981', '#f59e0b', '#f97316', '#f43f5e'][idx % 4]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        </GlassCard>
      </div>

      <GlassCard>
        <div className="p-4 space-y-3">
          {renderSectionHeader(<Filter size={16} className="text-cyan-400" />, 'Filters')}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[160px]">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
              <input
                type="text"
                value={taskSearchQuery}
                onChange={(e) => setTaskSearchQuery(e.target.value)}
                placeholder="Search tasks..."
                className="w-full pl-7 pr-7 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/60 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500/50 transition-colors"
              />
              {taskSearchQuery && (
                <button onClick={() => setTaskSearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                  <X size={12} />
                </button>
              )}
            </div>
            <select
              value={taskFilterStatus}
              onChange={(e) => setTaskFilterStatus(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/60 text-xs text-slate-300 outline-none focus:border-cyan-500/50 min-w-[100px]"
            >
              <option value="">All Statuses</option>
              <option value="Todo">Todo</option>
              <option value="In Progress">In Progress</option>
              <option value="Review">Review</option>
              <option value="Done">Done</option>
              <option value="Blocked">Blocked</option>
            </select>
            <select
              value={taskFilterPriority}
              onChange={(e) => setTaskFilterPriority(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/60 text-xs text-slate-300 outline-none focus:border-cyan-500/50 min-w-[100px]"
            >
              <option value="">All Priorities</option>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
              <option value="Urgent">Urgent</option>
            </select>
            <select
              value={taskFilterProject}
              onChange={(e) => setTaskFilterProject(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/60 text-xs text-slate-300 outline-none focus:border-cyan-500/50 min-w-[120px]"
            >
              <option value="">All Projects</option>
              {taskProjectOptions.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <select
              value={taskFilterAssignee}
              onChange={(e) => setTaskFilterAssignee(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800/50 border border-slate-700/60 text-xs text-slate-300 outline-none focus:border-cyan-500/50 min-w-[120px]"
            >
              <option value="">All Assignees</option>
              {taskAssigneeOptions.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {(taskSearchQuery || taskFilterStatus || taskFilterPriority || taskFilterProject || taskFilterAssignee) && (
              <button
                onClick={() => { setTaskSearchQuery(''); setTaskFilterStatus(''); setTaskFilterPriority(''); setTaskFilterProject(''); setTaskFilterAssignee(''); }}
                className="px-2.5 py-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-all flex items-center gap-1"
              >
                <X size={11} /> Clear
              </button>
            )}
          </div>
        </div>
      </GlassCard>

      <GlassCard>
        <div className="p-4">
          {renderSectionHeader(<ListTodo size={16} className="text-cyan-400" />, `Tasks (${filteredTasks.length})`)}
          <div className="max-h-[420px] overflow-y-auto mt-3 space-y-1 custom-scrollbar">
            {filteredTasks.length === 0 ? (
              <div className="text-center py-12 text-slate-500">
                <ClipboardList size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-xs">No tasks match the current filters</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-700/30">
                    <th className="pb-2 pr-2 font-semibold">Task</th>
                    <th className="pb-2 pr-2 font-semibold">Title</th>
                    <th className="pb-2 pr-2 font-semibold">Status</th>
                    <th className="pb-2 pr-2 font-semibold">Priority</th>
                    <th className="pb-2 pr-2 font-semibold">Assignee</th>
                    <th className="pb-2 pr-2 font-semibold">Due Date</th>
                    <th className="pb-2 font-semibold">Project</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map((t: any) => {
                    const assignee = users.find((u: any) => u.id === t.assigneeId);
                    const project = roleFiltered.projects.find((p: any) => p.id === t.projectId);
                    return (
                      <tr
                        key={t.id}
                        onClick={() => setSelectedTaskId(t.id)}
                        className="cursor-pointer border-b border-slate-700/20 hover:bg-slate-700/20 transition-colors group"
                      >
                        <td className="py-2 pr-2 text-slate-400 font-mono">{t.taskNumber || t.id.slice(0, 8)}</td>
                        <td className="py-2 pr-2 text-slate-200 group-hover:text-cyan-300 transition-colors max-w-[200px] truncate">{t.title}</td>
                        <td className="py-2 pr-2"><StatusBadge status={t.status} size="sm" /></td>
                        <td className="py-2 pr-2"><StatusBadge status={t.priority} size="sm" /></td>
                        <td className="py-2 pr-2 text-slate-400">{assignee?.name || '—'}</td>
                        <td className="py-2 pr-2 text-slate-400 whitespace-nowrap">{t.dueDate ? t.dueDate.slice(0, 10) : '—'}</td>
                        <td className="py-2 text-slate-400 max-w-[120px] truncate">{project?.title || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </GlassCard>
    </div>
  );

  const renderTaskDetail = () => {
    if (detailTaskLoading) {
      return (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full" />
        </div>
      );
    }
    if (!detailTask) {
      return (
        <div className="text-center py-20 text-slate-500">
          <ClipboardList size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Task not found</p>
          <button onClick={() => setSelectedTaskId(null)} className="mt-4 text-xs text-cyan-400 hover:text-cyan-300 underline">Back to tasks</button>
        </div>
      );
    }
    const t = detailTask;
    const assignee = users.find((u: any) => u.id === t.assigneeId);
    const creator = users.find((u: any) => u.id === t.creatorId);
    const project = roleFiltered.projects.find((p: any) => p.id === t.projectId);
    const projectName = project?.title || '—';
    const history = t.statusHistory || [];

    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedTaskId(null)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft size={14} /> Back to Tasks
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleTaskPdfExport}
              className="px-2.5 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"
            >
              <FileText size={11} />
              Export Task PDF
            </button>
            {project && (
              <button
                onClick={() => { setSelectedProjectId(project.id); setActiveTab('projects'); }}
                className="px-2.5 py-1.5 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"
              >
                <ExternalLink size={11} />
                View Project
              </button>
            )}
          </div>
        </div>

        <GlassCard>
          <div className="p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="text-[10px] text-slate-500 font-mono mb-1">{t.taskNumber || t.id.slice(0, 8)}</div>
                <h2 className="text-lg font-bold text-slate-100">{t.title}</h2>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <StatusBadge status={t.status} />
                <StatusBadge status={t.priority} />
              </div>
            </div>

            {t.description && (
              <div>
                <div className="text-xs text-slate-400 mb-1">Description</div>
                <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{t.description}</p>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-slate-700/30">
              <div>
                <div className="text-[10px] text-slate-500 mb-0.5">Assignee</div>
                <div className="text-xs text-slate-300 flex items-center gap-1">
                  <User size={10} className="text-cyan-400" /> {assignee?.name || '—'}
                </div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-0.5">Creator</div>
                <div className="text-xs text-slate-300">{creator?.name || '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-0.5">Project</div>
                <div className="text-xs text-slate-300">{projectName}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-0.5">Due Date</div>
                <div className="text-xs text-slate-300">{t.dueDate ? t.dueDate.slice(0, 10) : '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-0.5">Created</div>
                <div className="text-xs text-slate-300">{t.createdAt ? t.createdAt.slice(0, 10) : '—'}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-0.5">Completed</div>
                <div className="text-xs text-slate-300">{t.completedAt ? t.completedAt.slice(0, 10) : '—'}</div>
              </div>
              {t.completionSummary && (
                <div className="col-span-2">
                  <div className="text-[10px] text-slate-500 mb-0.5">Completion Summary</div>
                  <div className="text-xs text-slate-300">{t.completionSummary}</div>
                </div>
              )}
            </div>
          </div>
        </GlassCard>

        {t.subtasks && t.subtasks.length > 0 && (
          <GlassCard>
            <div className="p-4">
              {renderSectionHeader(<ListTodo size={16} className="text-cyan-400" />, `Subtasks (${t.subtasks.length})`)}
              <div className="mt-3 space-y-1.5">
                {t.subtasks.map((st: any) => (
                  <div key={st.id} className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/30 border border-slate-700/20">
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${st.status === 'Done' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                    <span className="text-xs text-slate-200 flex-1 truncate">{st.title}</span>
                    <StatusBadge status={st.status} size="sm" />
                    <StatusBadge status={st.priority} size="sm" />
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        )}

        {t.attachments && t.attachments.length > 0 && (
          <GlassCard>
            <div className="p-4">
              {renderSectionHeader(<Paperclip size={16} className="text-cyan-400" />, `Attachments (${t.attachments.length})`)}
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {t.attachments.map((att: any) => (
                  <div key={att.id} className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/30 border border-slate-700/20">
                    <FileImage size={12} className="text-slate-400 shrink-0" />
                    <span className="text-xs text-slate-300 truncate flex-1">{att.fileName || att.name || 'File'}</span>
                    <span className="text-[10px] text-slate-500 shrink-0">{att.fileSize ? `${(att.fileSize / 1024).toFixed(0)}KB` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        )}

        {history.length > 0 && (
          <GlassCard>
            <div className="p-4">
              {renderSectionHeader(<History size={16} className="text-cyan-400" />, 'Activity')}
              <div className="mt-3 space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar">
                {history.map((h: any, idx: number) => {
                  const fromUser = users.find((u: any) => u.id === h.changedByUserId || u.id === h.userId);
                  return (
                    <div key={idx} className="flex items-start gap-2 p-2 rounded-lg bg-slate-800/20">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-slate-300">
                          {h.fromStatus && h.toStatus ? (
                            <>Status changed from <span className="text-amber-300">{h.fromStatus}</span> to <span className="text-emerald-300">{h.toStatus}</span></>
                          ) : (
                            <>{h.action || h.eventType || 'Updated'}</>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                          <span>{fromUser?.name || 'System'}</span>
                          <span>•</span>
                          <span>{h.changedAt || h.createdAt || ''}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </GlassCard>
        )}
      </div>
    );
  };

  // ── Member Workload Details ────────────────────────────────────────
  const renderMemberDetail = () => {
    if (!selectedMemberId) {
      return (
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin w-6 h-6 border-2 border-cyan-400 border-t-transparent rounded-full" />
        </div>
      );
    }
    const m = detailMember;
    if (!m) {
      return (
        <div className="text-center py-20 text-slate-500">
          <Users size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Member not found</p>
          <button onClick={() => setSelectedMemberId(null)} className="mt-4 text-xs text-cyan-400 hover:text-cyan-300 underline">Back to workload</button>
        </div>
      );
    }

    const memberTasks = (roleFiltered.tasks as any[]).filter((t: any) => t.assigneeId === m.userId);
    const activeTasks = memberTasks.filter((t: any) => t.status !== 'Done');
    const completedTasks = memberTasks.filter((t: any) => t.status === 'Done');
    const overdueTasks = memberTasks.filter((t: any) => t.status !== 'Done' && t.dueDate && t.dueDate < todayStr());
    const reviewTasks = memberTasks.filter((t: any) => t.status === 'Review');
    const completionRate = memberTasks.length > 0 ? Math.round((completedTasks.length / memberTasks.length) * 100) : 0;

    const memberProjects = (roleFiltered.projects as any[]).filter((p: any) =>
      m.projectIds.includes(p.id)
    );

    const upcomingDeadlines = activeTasks
      .filter((t: any) => t.dueDate && t.dueDate >= todayStr())
      .sort((a: any, b: any) => a.dueDate.localeCompare(b.dueDate));

    const priorityDist = { High: 0, Medium: 0, Low: 0, Urgent: 0 };
    memberTasks.forEach((t: any) => { if (priorityDist.hasOwnProperty(t.priority)) priorityDist[t.priority as keyof typeof priorityDist]++; });

    const memberActivity = memberTasks
      .flatMap((t: any) => (t.statusHistory || []).map((h: any) => ({ ...h, taskTitle: t.title, taskNumber: t.taskNumber })))
      .sort((a: any, b: any) => (b.timestamp || b.changedAt || '').localeCompare(a.timestamp || a.changedAt || ''));

    const total = m.totalTasks;
    const wlLabel = total >= 8 ? 'Heavy' : total >= 4 ? 'Moderate' : 'Light';
    const barWidth = Math.min(total / 12, 1) * 100;

    return (
      <div className="space-y-5">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setSelectedMemberId(null)}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            <ArrowLeft size={14} /> Back to Workload
          </button>
          <button
            onClick={handleMemberPdfExport}
            className="px-2.5 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            <FileText size={11} />
            Export Member PDF
          </button>
        </div>

        <GlassCard>
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-slate-700 overflow-hidden shrink-0">
                {m.avatar ? <img src={m.avatar} alt="" className="w-full h-full object-cover" /> : <User size={18} className="text-slate-400 m-auto" />}
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-100">{m.name}</h2>
                <p className="text-xs text-slate-400">{m.title || m.role || m.department || '\u2014'} {m.department ? `\u00B7 ${m.department}` : ''}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-3 border-t border-slate-700/30">
              <div>
                <div className="text-[10px] text-slate-500 mb-0.5">Active Tasks</div>
                <div className="text-sm font-bold text-cyan-400">{m.active}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-0.5">Completed</div>
                <div className="text-sm font-bold text-emerald-400">{m.completed}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-0.5">Overdue</div>
                <div className={`text-sm font-bold ${m.overdue > 0 ? 'text-rose-400' : 'text-slate-400'}`}>{m.overdue > 0 ? m.overdue : 0}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-0.5">Projects</div>
                <div className="text-sm font-bold text-slate-200">{m.projectCount}</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 mb-0.5">Completion Rate</div>
                <div className="text-sm font-bold text-violet-400">{memberTasks.length > 0 ? `${completionRate}%` : '\u2014'}</div>
              </div>
            </div>
            {total > 0 && (
              <div className="pt-2 border-t border-slate-700/30">
                <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                  <span>Workload Level</span>
                  <span className={wlLabel === 'Heavy' ? 'text-rose-400 font-semibold' : wlLabel === 'Moderate' ? 'text-amber-400 font-semibold' : 'text-emerald-400 font-semibold'}>{wlLabel}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-700/50 overflow-hidden">
                  <div className={`h-full rounded-full ${wlLabel === 'Heavy' ? 'bg-rose-500' : wlLabel === 'Moderate' ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${barWidth}%` }} />
                </div>
              </div>
            )}
          </div>
        </GlassCard>

        <GlassCard>
          <div className="p-4">
            {renderSectionHeader(<ListTodo size={16} className="text-cyan-400" />, `Current Tasks (${activeTasks.length})`)}
            <div className="max-h-[320px] overflow-y-auto mt-3 custom-scrollbar">
              {activeTasks.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-6">No active tasks</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-700/30 sticky top-0 bg-slate-900 z-10">
                      <th className="pb-2 pr-2 font-semibold">Task</th>
                      <th className="pb-2 pr-2 font-semibold">Project</th>
                      <th className="pb-2 pr-2 font-semibold">Priority</th>
                      <th className="pb-2 pr-2 font-semibold">Status</th>
                      <th className="pb-2 font-semibold">Due</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTasks.map((t: any) => {
                      const proj = roleFiltered.projects.find((p: any) => p.id === t.projectId);
                      return (
                        <tr
                          key={t.id}
                          onClick={() => setSelectedTaskId(t.id)}
                          className="cursor-pointer border-b border-slate-700/20 hover:bg-slate-700/20 transition-colors group"
                        >
                          <td className="py-2 pr-2">
                            <span className="text-slate-200 group-hover:text-cyan-300 transition-colors">{t.title}</span>
                          </td>
                          <td className="py-2 pr-2 text-slate-400 truncate max-w-[120px]">{proj?.title || '\u2014'}</td>
                          <td className="py-2 pr-2"><StatusBadge status={t.priority} size="sm" /></td>
                          <td className="py-2 pr-2"><StatusBadge status={t.status} size="sm" /></td>
                          <td className="py-2 font-mono text-slate-400">{t.dueDate ? t.dueDate.slice(0, 10) : '\u2014'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </GlassCard>

        {memberProjects.length > 0 && (
          <GlassCard>
            <div className="p-4">
              {renderSectionHeader(<FolderKanban size={16} className="text-violet-400" />, `Projects (${memberProjects.length})`)}
              <div className="max-h-[240px] overflow-y-auto mt-3 custom-scrollbar">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-700/30 sticky top-0 bg-slate-900 z-10">
                      <th className="pb-2 pr-2 font-semibold">Project</th>
                      <th className="pb-2 pr-2 font-semibold">Role</th>
                      <th className="pb-2 pr-2 font-semibold">Status</th>
                      <th className="pb-2 font-semibold">Tasks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberProjects.map((p: any) => {
                      const isLead = p.teamLeadId === m.userId;
                      const memberTasksCount = memberTasks.filter((t: any) => t.projectId === p.id).length;
                      return (
                        <tr
                          key={p.id}
                          onClick={() => { setSelectedProjectId(p.id); setActiveTab('projects'); }}
                          className="cursor-pointer border-b border-slate-700/20 hover:bg-slate-700/20 transition-colors group"
                        >
                          <td className="py-2 pr-2 text-slate-200 group-hover:text-cyan-300 transition-colors truncate max-w-[160px]">{p.title}</td>
                          <td className="py-2 pr-2 text-slate-400">{isLead ? 'Lead' : 'Member'}</td>
                          <td className="py-2 pr-2"><StatusBadge status={p.status} size="sm" /></td>
                          <td className="py-2 font-mono text-slate-400">{memberTasksCount}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </GlassCard>
        )}

        {memberTasks.length > 0 && (
          <GlassCard>
            <div className="p-4">
              {renderSectionHeader(<BarChart3 size={16} className="text-amber-400" />, 'Task Priority Distribution')}
              <div className="mt-3 max-h-[200px] overflow-y-auto custom-scrollbar">
                {(['Urgent', 'High', 'Medium', 'Low'] as const).map((p) => {
                  const count = priorityDist[p] || 0;
                  const maxCount = Math.max(...Object.values(priorityDist), 1);
                  const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
                  return (
                    <div key={p} className="flex items-center gap-2 py-1.5">
                      <span className="text-xs text-slate-400 w-14">{p}</span>
                      <div className="flex-1 h-4 rounded bg-slate-700/50 overflow-hidden">
                        <div className={`h-full rounded ${
                          p === 'Urgent' ? 'bg-rose-500' : p === 'High' ? 'bg-orange-500' : p === 'Medium' ? 'bg-amber-500' : 'bg-emerald-500'
                        }`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs font-mono text-slate-400 w-6 text-right">{count}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </GlassCard>
        )}

        {completedTasks.length > 0 && (
          <GlassCard>
            <div className="p-4">
              {renderSectionHeader(<CheckCircle2 size={16} className="text-emerald-400" />, `Completed Work (${completedTasks.length})`)}
              <div className="max-h-[240px] overflow-y-auto mt-3 custom-scrollbar">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-700/30 sticky top-0 bg-slate-900 z-10">
                      <th className="pb-2 pr-2 font-semibold">Task</th>
                      <th className="pb-2 pr-2 font-semibold">Project</th>
                      <th className="pb-2 pr-2 font-semibold">Priority</th>
                      <th className="pb-2 font-semibold">Completed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {completedTasks.map((t: any) => {
                      const proj = roleFiltered.projects.find((p: any) => p.id === t.projectId);
                      return (
                        <tr
                          key={t.id}
                          onClick={() => setSelectedTaskId(t.id)}
                          className="cursor-pointer border-b border-slate-700/20 hover:bg-slate-700/20 transition-colors group"
                        >
                          <td className="py-2 pr-2 text-slate-300 group-hover:text-cyan-300 transition-colors truncate max-w-[200px]">{t.title}</td>
                          <td className="py-2 pr-2 text-slate-500 truncate max-w-[120px]">{proj?.title || '\u2014'}</td>
                          <td className="py-2 pr-2"><StatusBadge status={t.priority} size="sm" /></td>
                          <td className="py-2 font-mono text-xs text-slate-400">{t.createdAt ? t.createdAt.slice(0, 10) : '\u2014'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </GlassCard>
        )}

        {upcomingDeadlines.length > 0 && (
          <GlassCard>
            <div className="p-4">
              {renderSectionHeader(<CalendarDays size={16} className="text-amber-400" />, `Upcoming Deadlines (${upcomingDeadlines.length})`)}
              <div className="max-h-[240px] overflow-y-auto mt-3 custom-scrollbar">
                {upcomingDeadlines.map((t: any) => (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTaskId(t.id)}
                    className="flex items-center gap-2 p-2 rounded-lg bg-slate-800/30 border border-slate-700/20 mb-1.5 cursor-pointer hover:bg-slate-700/30 transition-colors"
                  >
                    <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.dueDate === todayStr() ? 'bg-rose-400' : 'bg-amber-400'}`} />
                    <span className="text-xs text-slate-200 flex-1 truncate">{t.title}</span>
                    <StatusBadge status={t.priority} size="sm" />
                    <span className={`text-[10px] font-mono shrink-0 ${t.dueDate === todayStr() ? 'text-rose-400' : 'text-slate-400'}`}>
                      {t.dueDate === todayStr() ? 'Today' : t.dueDate?.slice(0, 10) || ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        )}

        {memberActivity.length > 0 && (
          <GlassCard>
            <div className="p-4">
              {renderSectionHeader(<History size={16} className="text-cyan-400" />, `Activity (${memberActivity.length})`)}
              <div className="max-h-[240px] overflow-y-auto mt-3 custom-scrollbar">
                {memberActivity.map((h: any, idx: number) => (
                  <div key={idx} className="flex items-start gap-2 p-2 rounded-lg bg-slate-800/20 mb-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-slate-300">
                        {h.fromStatus && h.toStatus ? (
                          <><span className="text-slate-400">{h.taskTitle || h.taskNumber}:</span> {h.fromStatus} \u2192 {h.toStatus}</>
                        ) : (
                          <>{h.action || h.eventType || 'Updated'} {h.taskTitle ? `- ${h.taskTitle}` : ''}</>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-0.5">
                        <span>{h.changedByName || h.changedBy || 'System'}</span>
                        <span>\u2022</span>
                        <span>{h.timestamp || h.changedAt || h.createdAt || ''}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        )}

        {memberActivity.length === 0 && completedTasks.length === 0 && upcomingDeadlines.length === 0 && (
          <div className="text-center py-12 text-slate-500">
            <Users size={32} className="mx-auto mb-2 opacity-30" />
            <p className="text-xs">No workload details available for this member</p>
          </div>
        )}
      </div>
    );
  };

  const renderAttendanceTab = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        {renderKPICard('Present', attendanceStats.present, <UserCheck size={14} className="text-emerald-400" />, 'emerald')}
        {renderKPICard('Late', attendanceStats.late, <Clock size={14} className="text-amber-400" />, 'amber')}
        {renderKPICard('Absent', attendanceStats.absent, <UserX size={14} className="text-rose-400" />, 'magenta')}
        {renderKPICard('On Leave', attendanceStats.onLeave, <Coffee size={14} className="text-cyan-400" />, 'cyan')}
        {renderKPICard('Half Day', attendanceStats.halfDay, <Hourglass size={14} className="text-violet-400" />, 'violet')}
        {renderKPICard('Avg Hours', `${attendanceStats.avgHours}h`, <Target size={14} className="text-emerald-400" />, 'emerald')}
        {renderKPICard('Total Records', attendanceStats.total, <FileSpreadsheet size={14} className="text-cyan-400" />, 'cyan')}
      </div>

      <GlassCard glowColor="cyan" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
        <div className="glass-panel p-4 rounded-lg">
          {renderSectionHeader(<BarChart3 size={16} className="text-cyan-400" />, 'Attendance Distribution')}
          <div className="mt-3" style={{ height: 260 }}>
            {(roleFiltered.attendance || []).length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">No attendance data for this period</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={[
                  { name: 'Present', value: attendanceStats.present },
                  { name: 'Late', value: attendanceStats.late },
                  { name: 'Absent', value: attendanceStats.absent },
                  { name: 'On Leave', value: attendanceStats.onLeave },
                  { name: 'Half Day', value: attendanceStats.halfDay }
                ]} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis dataKey="name" tick={{ fill: chartTextColor, fontSize: 10 }} />
                  <YAxis tick={{ fill: chartTextColor, fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} wrapperStyle={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, borderRadius: 0 }} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {[chartColors.emerald, chartColors.amber, chartColors.rose, chartColors.cyan, chartColors.violet].map((color, i) => (
                      <Cell key={i} fill={color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </GlassCard>

      <div className="overflow-x-auto">
        <table className="density-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Date</th>
              <th>Status</th>
              <th>Check In</th>
              <th>Check Out</th>
              <th>Hours</th>
              <th>Breaks</th>
            </tr>
          </thead>
          <tbody>
            {(roleFiltered.attendance || []).length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-500 py-6">No records in range</td></tr>
            ) : (
              (roleFiltered.attendance as any[]).map((a: any) => (
                <tr key={a.id || `${a.userId}-${a.date}`}>
                  <td className="text-white font-medium text-xs">{users.find((u) => u.id === a.userId)?.name || a.userId}</td>
                  <td className="font-mono text-[10px]">{a.date}</td>
                  <td><StatusBadge status={a.status} size="sm" /></td>
                  <td className="font-mono text-xs">{a.checkIn || '\u2014'}</td>
                  <td className="font-mono text-xs text-slate-400">{a.checkOut || '\u2014'}</td>
                  <td className="font-mono text-xs">{a.totalHours || 0}h</td>
                  <td className="font-mono text-xs text-slate-400">{a.breaksCount || 0}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {roleFiltered.hrRequests.length > 0 && (
        <GlassCard glowColor="amber" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
          <div className="glass-panel p-4 rounded-lg">
            {renderSectionHeader(<ListTodo size={16} className="text-amber-400" />, 'Pending HR Requests', `${roleFiltered.hrRequests.length} pending`)}
            <div className="mt-3 space-y-2">
              {roleFiltered.hrRequests.map((r: any) => (
                <div key={r.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/60 border border-white/5 text-xs">
                  <div className="flex items-center gap-2">
                    <StatusBadge status={r.type.replace('_', ' ')} size="sm" />
                    <span className="text-slate-300">{r.reason.slice(0, 60)}{r.reason.length > 60 ? '...' : ''}</span>
                  </div>
                  <span className="font-mono text-[10px] text-slate-400">{r.submittedAt || r.date}</span>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>
      )}
    </div>
  );

  const renderExportTab = () => (
    <div className="space-y-5">
      <div className="p-6 text-center space-y-4 bg-slate-900/30 border border-white/10 rounded-xl">
        <FileSpreadsheet size={40} className="mx-auto text-cyan-400" />
        <div>
          <h3 className="text-sm font-bold text-white">CSV Export</h3>
          <p className="text-xs text-slate-400 mt-1">Export the current report as a CSV spreadsheet</p>
        </div>
        <div className="text-[10px] text-slate-500 font-mono">
          {tabLabels[activeTab]} Report | {dateRange.from} \u2013 {dateRange.to}
        </div>
        <button
          onClick={handleCsvExport}
          disabled={hasError}
          className="w-full py-2.5 rounded-xl glass-button-neon text-xs font-bold flex items-center justify-center gap-2 shadow"
        >
          <Download size={14} />
          <span>Download CSV</span>
        </button>
      </div>

      <GlassCard glowColor="cyan" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
        <div className="glass-panel p-4 rounded-lg">
          {renderSectionHeader(<FileSpreadsheet size={16} className="text-cyan-400" />, 'Export Summary')}
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-slate-900/60 border border-white/5">
              <span className="text-slate-400 block mb-1">Current View</span>
              <span className="text-white font-bold">{tabLabels[activeTab]}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/60 border border-white/5">
              <span className="text-slate-400 block mb-1">Date Range</span>
              <span className="text-white font-bold font-mono text-[10px]">{dateRange.from} \u2013 {dateRange.to}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/60 border border-white/5">
              <span className="text-slate-400 block mb-1">Role</span>
              <span className="text-white font-bold">{currentRole.replace('_', ' ')}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/60 border border-white/5">
              <span className="text-slate-400 block mb-1">Data Records</span>
              <span className="text-white font-bold">
                {activeTab === 'projects' ? roleFiltered.projects.length :
                 activeTab === 'workload' ? workloadData.length :
                 activeTab === 'deadlines' ? deadlineData.dueToday.length + deadlineData.dueTomorrow.length + deadlineData.upcoming.length + deadlineData.overdue.length :
                 activeTab === 'attendance' ? roleFiltered.attendance.length :
                 activeTab === 'teams' ? teamStats.length : (kpiStats.completedTasks + kpiStats.activeTasks)}
              </span>
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );

  const renderTabContent = () => {
    const tabContent = (() => {
      switch (activeTab) {
        case 'overview':
          return renderOverviewTab();
        case 'projects':
          return selectedProjectId ? renderProjectDetail() : renderProjectsTab();
        case 'tasks':
          return selectedTaskId ? renderTaskDetail() : renderTasksTab();
        case 'teams':
          return renderTeamsTab();
        case 'workload':
          return selectedMemberId ? renderMemberDetail() : renderWorkloadTab();
        case 'deadlines':
          return renderDeadlinesTab();
        case 'attendance':
          return renderAttendanceTab();
        case 'export':
          return renderExportTab();
        default:
          return renderOverviewTab();
      }
    })();

    return (
      <>
        {activeTab !== 'export' && (
          <div className="flex justify-end">
            <button
              onClick={handlePdfExport}
              className="px-2.5 py-1.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"
            >
              <FileText size={11} />
              Export PDF
            </button>
          </div>
        )}
        {reportLoading && (
          <div className="text-xs text-slate-400 text-center py-2">Loading report data...</div>
        )}
        {reportError && !reportLoading && !apiAvailable && (
          <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 text-center">
            {reportError}
          </div>
        )}
        {tabContent}
      </>
    );
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-5 glass-panel-glow border-cyan-500/30">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30">
              REPORTING
            </span>
            <span className="text-xs text-slate-400 font-mono">{currentRole.replace('_', ' ')} View</span>
          </div>
          <h1 className="text-xl font-extrabold text-white">
            <span className="text-gradient-neon">Analytics</span> & Reports
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-mono text-slate-400 uppercase">From</label>
            <input
              type="date"
              value={dateRange.from}
              max={todayStr()}
              onChange={(e) => handleDateChange('from', e.target.value)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-mono border transition-colors ${
                validationError ? 'border-rose-500/60 bg-rose-500/10 text-rose-300' : 'bg-slate-900/60 border-white/10 text-slate-200 hover:border-white/20'
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
                validationError ? 'border-rose-500/60 bg-rose-500/10 text-rose-300' : 'bg-slate-900/60 border-white/10 text-slate-200 hover:border-white/20'
              } focus:outline-none focus:border-cyan-500/50`}
            />
          </div>
        </div>
      </div>

      {validationError && (
        <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-center gap-2 text-xs text-rose-300">
          <AlertTriangle size={14} />
          <span>{validationError}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-slate-900/60 border border-white/5">
        {visibleTabs.map(renderTabButton)}
      </div>

      {renderTabContent()}
    </div>
  );
};
