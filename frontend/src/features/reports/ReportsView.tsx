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
  ArrowDownRight
} from 'lucide-react';

type ReportTab = 'overview' | 'projects' | 'teams' | 'workload' | 'deadlines' | 'attendance' | 'export';

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
        completion: p.completion,
      }));
    }
    const { projects: rp, tasks: rt } = roleFilteredLocal;
    return rp.map((p) => {
      const pTasks = rt.filter((t) => t.projectId === p.id);
      const done = pTasks.filter((t) => t.status === 'Done').length;
      const pct = pTasks.length > 0 ? Math.round((done / pTasks.length) * 100) : 0;
      return { name: p.title.length > 20 ? p.title.slice(0, 20) + '...' : p.title, progress: p.progress, completion: pct };
    });
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

  const workloadData = useMemo(() => {
    if (apiAvailable) {
      return (reportData.workload || []).map((w: any) => ({
        ...w,
        name: w.name || w.userId,
      }));
    }
    const { tasks: rt, projects: rp } = roleFilteredLocal;
    const memberMap: Record<string, { name: string; active: number; completed: number; review: number; overdue: number }> = {};
    rt.forEach((t) => {
      const uid = t.assigneeId;
      if (!memberMap[uid]) {
        const u = users.find((u) => u.id === uid);
        memberMap[uid] = { name: u?.name || uid, active: 0, completed: 0, review: 0, overdue: 0 };
      }
      if (t.status === 'Done') memberMap[uid].completed++;
      else if (t.status === 'Review') memberMap[uid].review++;
      else {
        memberMap[uid].active++;
        if (t.dueDate < todayStr()) memberMap[uid].overdue++;
      }
    });
    return Object.values(memberMap).sort((a, b) => b.active - a.active);
  }, [apiAvailable, reportData, roleFilteredLocal, users]);

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
        return ['overview', 'projects', 'teams', 'workload', 'deadlines', 'attendance', 'export'];
      case 'HR':
        return ['overview', 'attendance', 'export'];
      case 'Team_Lead':
        return ['overview', 'projects', 'workload', 'deadlines', 'export'];
      case 'Team_Member':
        return ['overview', 'projects', 'workload', 'deadlines'];
      default:
        return ['overview'];
    }
  }, [currentRole]);

  const tabLabels: Record<ReportTab, string> = {
    overview: 'Overview',
    projects: 'Projects',
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
      headers = ['Member', 'Active Tasks', 'Completed', 'In Review', 'Overdue'];
      rows = workloadData.map((w: any) => [w.name, String(w.active), String(w.completed), String(w.review), String(w.overdue)]);
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
        ['Active Members', String(kpiStats.activeMembers)]
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
      bodyHtml += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0;">`;
      bodyHtml += kpi('Active Tasks', workloadData.reduce((s: number, w: any) => s + (w.active || 0), 0));
      bodyHtml += kpi('Completed', workloadData.reduce((s: number, w: any) => s + (w.completed || 0), 0));
      bodyHtml += kpi('In Review', workloadData.reduce((s: number, w: any) => s + (w.review || 0), 0));
      bodyHtml += kpi('Overdue', workloadData.reduce((s: number, w: any) => s + (w.overdue || 0), 0));
      bodyHtml += kpi('Members', workloadData.length);
      bodyHtml += `</div>`;
      bodyHtml += section('Member Workload');
      bodyHtml += `<table style="width:100%;border-collapse:collapse;margin:8px 0;">`;
      bodyHtml += `<thead><tr>${th('Member')}${th('Active')}${th('Completed')}${th('Review')}${th('Overdue')}</tr></thead><tbody>`;
      workloadData.forEach((w: any) => {
        bodyHtml += `<tr>${td(w.name, '#0f172a')}${td(w.active)}${td(w.completed)}${td(w.review)}${td(w.overdue)}</tr>`;
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
        bodyHtml += kpi('Active Members', kpiStats.activeMembers);
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
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {renderKPICard('Total Projects', kpiStats.totalProjects, <FolderKanban size={14} className="text-cyan-400" />, 'cyan')}
            {renderKPICard('Active Tasks', kpiStats.activeTasks, <CheckSquare size={14} className="text-violet-400" />, 'violet')}
            {renderKPICard('Completed', kpiStats.completedTasks, <CheckCircle2 size={14} className="text-emerald-400" />, 'emerald')}
            {renderKPICard('Overdue', kpiStats.overdueTasks, <AlertTriangle size={14} className="text-amber-400" />, 'amber', kpiStats.overdueTasks > 0 ? renderInsightBadge(false, `${kpiStats.overdueTasks} need attention`) : undefined)}
            {renderKPICard('Completion Rate', `${kpiStats.completionRate}%`, <TrendingUp size={14} className="text-purple-400" />, 'magenta')}
            {renderKPICard('Members', kpiStats.activeMembers, <Users size={14} className="text-cyan-400" />, 'cyan')}
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
                      <Bar dataKey="completion" fill={chartColors.violet} radius={[4, 4, 0, 0]} name="Task Completion" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </GlassCard>

            <GlassCard glowColor="violet" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
              <div className="glass-panel p-4 rounded-lg">
                {renderSectionHeader(<TrendingUp size={16} className="text-violet-400" />, 'Task Completion Trend')}
                <div className="mt-3" style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={taskCompletionTrend} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                      <XAxis dataKey="date" tick={{ fill: chartTextColor, fontSize: 9 }} />
                      <YAxis tick={{ fill: chartTextColor, fontSize: 10 }} />
                      <Tooltip content={<CustomTooltip />} wrapperStyle={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, borderRadius: 0 }} />
                      <Area type="monotone" dataKey="Completed" stroke={chartColors.emerald} fill={chartColors.emerald} fillOpacity={0.15} />
                      <Area type="monotone" dataKey="Created" stroke={chartColors.cyan} fill={chartColors.cyan} fillOpacity={0.1} />
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
              <div className="mt-3 space-y-2">
                {deadlineData.dueToday.length === 0 && deadlineData.dueTomorrow.length === 0 && deadlineData.upcoming.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">No upcoming deadlines in this range</p>
                ) : (
                  [...deadlineData.dueToday, ...deadlineData.dueTomorrow, ...deadlineData.upcoming].slice(0, 8).map((t: any) => (
                    <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/60 border border-white/5 text-xs">
                      <div className="flex items-center gap-2 min-w-0">
                        <StatusBadge status={t.priority} size="sm" />
                        <span className="text-slate-200 truncate">{t.title}</span>
                      </div>
                      <span className={`font-mono text-[10px] shrink-0 ml-2 ${t.dueDate < todayStr() ? 'text-rose-400' : 'text-purple-300'}`}>
                        {t.dueDate}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </GlassCard>

          <GlassCard glowColor="violet" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Users size={16} className="text-violet-400" />, 'Member Workload')}
              <div className="mt-3" style={{ height: 260 }}>
                {workloadData.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">No workload data available</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={workloadData.slice(0, 10)} layout="vertical" margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                      <XAxis type="number" tick={{ fill: chartTextColor, fontSize: 10 }} />
                      <YAxis dataKey="name" type="category" tick={{ fill: chartTextColor, fontSize: 10 }} width={80} />
                      <Tooltip content={<CustomTooltip />} wrapperStyle={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, borderRadius: 0 }} />
                      <Bar dataKey="active" fill={chartColors.cyan} radius={[0, 4, 4, 0]} name="Active" stackId="a" />
                      <Bar dataKey="review" fill={chartColors.amber} radius={[0, 0, 0, 0]} name="Review" stackId="a" />
                      <Bar dataKey="completed" fill={chartColors.emerald} radius={[0, 0, 0, 0]} name="Completed" stackId="a" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </GlassCard>

          <GlassCard glowColor="amber" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<CheckCircle2 size={16} className="text-amber-400" />, 'Insights')}
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-900/60 border border-white/5 text-xs">
                  <span className="text-slate-400 block mb-1">Overall Progress</span>
                  <span className="text-white font-bold">
                    {kpiStats.completionRate}% tasks completed ({kpiStats.completedTasks}/{kpiStats.completedTasks + kpiStats.activeTasks})
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-900/60 border border-white/5 text-xs">
                  <span className="text-slate-400 block mb-1">Risk Factors</span>
                  <span className={`font-bold ${kpiStats.overdueTasks > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {kpiStats.overdueTasks > 0 ? `${kpiStats.overdueTasks} overdue tasks` : 'No overdue tasks'}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-900/60 border border-white/5 text-xs">
                  <span className="text-slate-400 block mb-1">Active Projects</span>
                  <span className="text-white font-bold">
                    {kpiStats.totalProjects} projects | {kpiStats.activeMembers} contributors
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-900/60 border border-white/5 text-xs">
                  <span className="text-slate-400 block mb-1">Task Distribution</span>
                  <span className="text-white font-bold">
                    {kpiStats.completedTasks + kpiStats.activeTasks} total | {taskStatusDist.find((d: any) => d.name === 'In Progress')?.value || 0} in progress
                  </span>
                </div>
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

          <GlassCard glowColor="amber" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Activity size={16} className="text-amber-400" />, 'Insights')}
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-900/60 border border-white/5 text-xs">
                  <span className="text-slate-400 block mb-1">Attendance Rate</span>
                  <span className="text-white font-bold">
                    {hrOverviewStats.presentToday > 0
                      ? `${Math.round((hrOverviewStats.presentToday / (hrOverviewStats.presentToday + hrOverviewStats.absentToday + hrOverviewStats.onLeaveToday + hrOverviewStats.lateToday || 1)) * 100)}% present`
                      : 'No records today'}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-900/60 border border-white/5 text-xs">
                  <span className="text-slate-400 block mb-1">Pending Actions</span>
                  <span className={`font-bold ${(hrOverviewStats.pendingLeaveReqs + hrOverviewStats.pendingCorrections) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {hrOverviewStats.pendingLeaveReqs + hrOverviewStats.pendingCorrections} pending requests
                  </span>
                </div>
              </div>
            </div>
          </GlassCard>
        </>
      )}
    </div>
  );

  const renderProjectsTab = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {renderKPICard('Total Projects', roleFiltered.projects.length, <FolderKanban size={14} className="text-cyan-400" />, 'cyan')}
        {renderKPICard('Avg Progress', roleFiltered.projects.length > 0 ? `${Math.round(roleFiltered.projects.reduce((s: number, p: any) => s + (p.progress || 0), 0) / roleFiltered.projects.length)}%` : '0%', <TrendingUp size={14} className="text-violet-400" />, 'violet')}
        {renderKPICard('Active', roleFiltered.projects.filter((p: any) => p.status === 'Active').length, <Activity size={14} className="text-emerald-400" />, 'emerald')}
        {renderKPICard('Completed', roleFiltered.projects.filter((p: any) => p.status === 'Completed').length, <CheckCircle2 size={14} className="text-emerald-400" />, 'magenta')}
      </div>

      <GlassCard glowColor="cyan" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
        <div className="glass-panel p-4 rounded-lg">
          {renderSectionHeader(<BarChart3 size={16} className="text-cyan-400" />, 'Project Progress & Completion')}
          <div className="mt-3" style={{ height: 300 }}>
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
                  <Bar dataKey="completion" fill={chartColors.violet} radius={[4, 4, 0, 0]} name="Task Completion %" />
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
                  <tr key={p.id}>
                    <td className="text-white font-medium">{p.title}</td>
                    <td className="text-slate-400 font-mono text-[10px]">{p.code}</td>
                    <td><StatusBadge status={p.status} size="sm" /></td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-slate-700">
                          <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500" style={{ width: `${p.progress || 0}%` }} />
                        </div>
                        <span className="text-[10px] font-mono text-slate-300">{p.progress || 0}%</span>
                      </div>
                    </td>
                    <td className="font-mono text-xs">{pTasksCount}</td>
                    <td className={`font-mono text-xs ${overdueCount > 0 ? 'text-rose-400' : 'text-slate-400'}`}>{overdueCount}</td>
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
  );

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

  const renderWorkloadTab = () => (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {renderKPICard('Active Tasks', workloadData.reduce((s: number, w: any) => s + (w.active || 0), 0), <Activity size={14} className="text-cyan-400" />, 'cyan')}
        {renderKPICard('Completed', workloadData.reduce((s: number, w: any) => s + (w.completed || 0), 0), <CheckCircle2 size={14} className="text-emerald-400" />, 'emerald')}
        {renderKPICard('In Review', workloadData.reduce((s: number, w: any) => s + (w.review || 0), 0), <Target size={14} className="text-violet-400" />, 'violet')}
        {renderKPICard('Overdue', workloadData.reduce((s: number, w: any) => s + (w.overdue || 0), 0), <AlertTriangle size={14} className="text-amber-400" />, 'amber')}
        {renderKPICard('Members', workloadData.length, <Users size={14} className="text-cyan-400" />, 'magenta')}
      </div>

      <GlassCard glowColor="violet" hover3dTilt={false} className="hover:-translate-y-0.5 hover:!shadow-[0_8px_24px_rgba(0,0,0,0.25)] hover:!border-white/20">
        <div className="glass-panel p-4 rounded-lg">
          {renderSectionHeader(<BarChart3 size={16} className="text-violet-400" />, 'Workload Distribution')}
          <div className="mt-3" style={{ height: 320 }}>
            {workloadData.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">No workload data available</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={workloadData.slice(0, 15)} layout="vertical" margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
                  <XAxis type="number" tick={{ fill: chartTextColor, fontSize: 10 }} />
                  <YAxis dataKey="name" type="category" tick={{ fill: chartTextColor, fontSize: 10 }} width={80} />
                  <Tooltip content={<CustomTooltip />} wrapperStyle={{ background: 'transparent', border: 'none', boxShadow: 'none', padding: 0, borderRadius: 0 }} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Bar dataKey="active" fill={chartColors.cyan} radius={[0, 4, 4, 0]} name="Active" stackId="a" />
                  <Bar dataKey="review" fill={chartColors.amber} radius={[0, 0, 0, 0]} name="Review" stackId="a" />
                  <Bar dataKey="completed" fill={chartColors.emerald} radius={[0, 0, 0, 0]} name="Completed" stackId="a" />
                  <Bar dataKey="overdue" fill={chartColors.rose} radius={[0, 0, 0, 0]} name="Overdue" stackId="a" />
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
              <th>Member</th>
              <th>Active</th>
              <th>Completed</th>
              <th>In Review</th>
              <th>Overdue</th>
              <th>Workload</th>
            </tr>
          </thead>
          <tbody>
            {workloadData.length === 0 ? (
              <tr><td colSpan={6} className="text-center text-slate-500 py-6">No data available</td></tr>
            ) : (
              workloadData.map((w: any) => {
                const total = (w.active || 0) + (w.completed || 0) + (w.review || 0);
                const wlLabel = total >= 8 ? 'Heavy' : total >= 4 ? 'Moderate' : 'Light';
                return (
                  <tr key={w.name || w.userId}>
                    <td className="text-white font-medium">{w.name || w.userId}</td>
                    <td className="font-mono text-xs">{w.active}</td>
                    <td className="font-mono text-xs text-emerald-400">{w.completed}</td>
                    <td className="font-mono text-xs text-amber-400">{w.review}</td>
                    <td className={`font-mono text-xs ${w.overdue > 0 ? 'text-rose-400' : 'text-slate-400'}`}>{w.overdue}</td>
                    <td>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                        wlLabel === 'Heavy' ? 'text-rose-400 bg-rose-500/10 border-rose-500/20' :
                        wlLabel === 'Moderate' ? 'text-amber-400 bg-amber-500/10 border-amber-500/20' :
                        'text-emerald-400 bg-emerald-500/10 border-emerald-500/20'
                      }`}>{wlLabel}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

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
          return renderProjectsTab();
        case 'teams':
          return renderTeamsTab();
        case 'workload':
          return renderWorkloadTab();
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
