import React, { useState, useMemo } from 'react';
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

const CHART_COLORS = {
  cyan: '#00f2fe',
  violet: '#8a2be2',
  magenta: '#ff007f',
  amber: '#ffaa00',
  emerald: '#00ff88',
  rose: '#f43f5e',
  blue: '#3b82f6',
  purple: '#a855f7',
  pink: '#ec4899',
  slate: '#64748b'
};

const PIE_COLORS = [
  CHART_COLORS.emerald,
  CHART_COLORS.cyan,
  CHART_COLORS.amber,
  CHART_COLORS.violet,
  CHART_COLORS.rose,
  CHART_COLORS.magenta
];

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
    <div className="glass-panel p-3 text-xs border border-white/10 shadow-lg">
      <p className="font-mono text-slate-300 mb-1">{label}</p>
      {payload.map((entry: any, idx: number) => (
        <p key={idx} className="font-mono" style={{ color: entry.color }}>
          {entry.name}: {entry.value}
        </p>
      ))}
    </div>
  );
}

export const ReportsView: React.FC = () => {
  const { currentRole, currentUser, projects, tasks, users, attendanceRecords, hrRequests } = useApp();

  const [activeTab, setActiveTab] = useState<ReportTab>('overview');
  const [dateRange, setDateRange] = useState<DateRange>(() => {
    const to = todayStr();
    const from = new Date(Date.now() - 29 * 86400000).toISOString().split('T')[0];
    return { from, to };
  });
  const [validationError, setValidationError] = useState<string | null>(null);

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

  const roleFiltered = useMemo(() => {
    const { validProjects, validTasks, validAttendance, validHrRequests } = filteredData;
    const userId = currentUser.id;

    if (currentRole === 'Admin') {
      return {
        projects: validProjects,
        tasks: validTasks,
        attendance: validAttendance,
        hrRequests: validHrRequests
      };
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
      const leadProjectIds = validProjects
        .filter((p) => p.teamLeadId === userId)
        .map((p) => p.id);
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

  const kpiStats = useMemo(() => {
    const { projects: rp, tasks: rt } = roleFiltered;
    const totalProjects = rp.length;
    const activeTasks = rt.filter((t) => t.status !== 'Done').length;
    const completedTasks = rt.filter((t) => t.status === 'Done').length;
    const overdueTasks = rt.filter((t) => t.status !== 'Done' && t.dueDate < todayStr()).length;
    const completionRate = rt.length > 0 ? Math.round((completedTasks / rt.length) * 100) : 0;
    const activeMembers = new Set(rp.flatMap((p) => p.memberIds).concat(rp.map((p) => p.teamLeadId))).size;
    return { totalProjects, activeTasks, completedTasks, overdueTasks, completionRate, activeMembers };
  }, [roleFiltered]);

  const projectHealthData = useMemo(() => {
    const { projects: rp, tasks: rt } = roleFiltered;
    return rp.map((p) => {
      const pTasks = rt.filter((t) => t.projectId === p.id);
      const done = pTasks.filter((t) => t.status === 'Done').length;
      const pct = pTasks.length > 0 ? Math.round((done / pTasks.length) * 100) : 0;
      return { name: p.title.length > 20 ? p.title.slice(0, 20) + '...' : p.title, progress: p.progress, completion: pct };
    });
  }, [roleFiltered]);

  const taskStatusDist = useMemo(() => {
    const counts: Record<string, number> = { Todo: 0, 'In Progress': 0, Review: 0, Done: 0, Blocked: 0 };
    roleFiltered.tasks.forEach((t) => { counts[t.status] = (counts[t.status] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [roleFiltered]);

  const taskPriorityDist = useMemo(() => {
    const counts: Record<string, number> = { Low: 0, Medium: 0, High: 0, Urgent: 0 };
    roleFiltered.tasks.forEach((t) => { counts[t.priority] = (counts[t.priority] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [roleFiltered]);

  const taskCompletionTrend = useMemo(() => {
    const { from, to } = dateRange;
    const days: Record<string, { completed: number; created: number }> = {};
    const start = new Date(from + 'T00:00:00');
    const end = new Date(to + 'T00:00:00');
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().split('T')[0];
      days[key] = { completed: 0, created: 0 };
    }
    roleFiltered.tasks.forEach((t) => {
      const cKey = t.createdAt?.slice(0, 10);
      if (cKey && days[cKey]) days[cKey].created++;
      if (t.status === 'Done' && t.dueDate && days[t.dueDate]) days[t.dueDate].completed++;
    });
    return Object.entries(days).map(([date, vals]) => ({
      date: date.slice(5),
      Completed: vals.completed,
      Created: vals.created
    }));
  }, [roleFiltered, dateRange]);

  const workloadData = useMemo(() => {
    const { tasks: rt, projects: rp } = roleFiltered;
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
  }, [roleFiltered, users]);

  const deadlineData = useMemo(() => {
    const { tasks: rt } = roleFiltered;
    const today = todayStr();
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    const weekFromNow = new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0];

    const dueToday = rt.filter((t) => t.status !== 'Done' && t.dueDate === today);
    const dueTomorrow = rt.filter((t) => t.status !== 'Done' && t.dueDate === tomorrow);
    const upcoming = rt.filter((t) => t.status !== 'Done' && t.dueDate > tomorrow && t.dueDate <= weekFromNow);
    const overdue = rt.filter((t) => t.status !== 'Done' && t.dueDate < today);
    return { dueToday, dueTomorrow, upcoming, overdue };
  }, [roleFiltered]);

  const attendanceStats = useMemo(() => {
    const { attendance: att } = roleFiltered;
    const present = att.filter((a) => a.status === 'Present').length;
    const late = att.filter((a) => a.status === 'Late').length;
    const absent = att.filter((a) => a.status === 'Absent').length;
    const onLeave = att.filter((a) => a.status === 'On Leave').length;
    const halfDay = att.filter((a) => a.status === 'Half Day').length;
    const totalHours = att.reduce((sum, a) => sum + (a.totalHours || 0), 0);
    const avgHours = att.length > 0 ? (totalHours / att.length).toFixed(1) : '0';
    const pendingCorrections = roleFiltered.hrRequests.filter((r) => r.type === 'Correction' && r.status === 'Pending').length;
    const pendingLeaves = roleFiltered.hrRequests.filter((r) => r.type === 'Leave' && r.status === 'Pending').length;

    return { present, late, absent, onLeave, halfDay, avgHours, total: att.length, pendingCorrections, pendingLeaves };
  }, [roleFiltered]);

  const hrOverviewStats = useMemo(() => {
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
  }, [filteredData]);

  const teamStats = useMemo(() => {
    const { projects: rp, tasks: rt } = roleFiltered;
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
  }, [roleFiltered, users]);

  const handleCsvExport = () => {
    const tab = activeTab;
    let headers: string[] = [];
    let rows: string[][] = [];

    if (tab === 'projects') {
      headers = ['Project', 'Code', 'Status', 'Progress %', 'Start Date', 'Target Date', 'Members', 'Team Lead'];
      rows = roleFiltered.projects.map((p) => [
        p.title, p.code, p.status, String(p.progress), p.startDate, p.targetDate,
        String(p.memberIds.length), users.find((u) => u.id === p.teamLeadId)?.name || p.teamLeadId
      ]);
    } else if (tab === 'workload') {
      headers = ['Member', 'Active Tasks', 'Completed', 'In Review', 'Overdue'];
      rows = workloadData.map((w) => [w.name, String(w.active), String(w.completed), String(w.review), String(w.overdue)]);
    } else if (tab === 'deadlines') {
      headers = ['Task', 'Status', 'Priority', 'Due Date', 'Assignee'];
      rows = [...deadlineData.overdue, ...deadlineData.dueToday, ...deadlineData.dueTomorrow, ...deadlineData.upcoming].map((t) => [
        t.title, t.status, t.priority, t.dueDate, users.find((u) => u.id === t.assigneeId)?.name || t.assigneeId
      ]);
    } else if (tab === 'attendance') {
      headers = ['User', 'Date', 'Status', 'Check In', 'Check Out', 'Total Hours'];
      rows = roleFiltered.attendance.map((a) => [
        users.find((u) => u.id === a.userId)?.name || a.userId, a.date, a.status, a.checkIn, a.checkOut || '—', String(a.totalHours)
      ]);
    } else if (tab === 'teams') {
      headers = ['Department', 'Members', 'Projects', 'Tasks', 'Completed', 'Completion Rate'];
      rows = teamStats.map((t) => [t.department, String(t.members), String(t.projects), String(t.tasks), String(t.completed), `${t.rate}%`]);
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
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const tab = activeTab;
    const title = `${tabLabels[tab]} Report (${dateRange.from} – ${dateRange.to})`;

    let tableHtml = '<table style="width:100%;border-collapse:collapse;font-size:12px;font-family:sans-serif;">';

    if (tab === 'projects') {
      tableHtml += '<thead><tr><th style="border:1px solid #ccc;padding:6px;">Project</th><th style="border:1px solid #ccc;padding:6px;">Code</th><th style="border:1px solid #ccc;padding:6px;">Status</th><th style="border:1px solid #ccc;padding:6px;">Progress</th><th style="border:1px solid #ccc;padding:6px;">Start</th><th style="border:1px solid #ccc;padding:6px;">Target</th></tr></thead><tbody>';
      roleFiltered.projects.forEach((p) => {
        tableHtml += `<tr><td style="border:1px solid #ccc;padding:6px;">${p.title}</td><td style="border:1px solid #ccc;padding:6px;">${p.code}</td><td style="border:1px solid #ccc;padding:6px;">${p.status}</td><td style="border:1px solid #ccc;padding:6px;">${p.progress}%</td><td style="border:1px solid #ccc;padding:6px;">${p.startDate}</td><td style="border:1px solid #ccc;padding:6px;">${p.targetDate}</td></tr>`;
      });
      tableHtml += '</tbody>';
    } else if (tab === 'workload') {
      tableHtml += '<thead><tr><th style="border:1px solid #ccc;padding:6px;">Member</th><th style="border:1px solid #ccc;padding:6px;">Active</th><th style="border:1px solid #ccc;padding:6px;">Completed</th><th style="border:1px solid #ccc;padding:6px;">Review</th><th style="border:1px solid #ccc;padding:6px;">Overdue</th></tr></thead><tbody>';
      workloadData.forEach((w) => {
        tableHtml += `<tr><td style="border:1px solid #ccc;padding:6px;">${w.name}</td><td style="border:1px solid #ccc;padding:6px;">${w.active}</td><td style="border:1px solid #ccc;padding:6px;">${w.completed}</td><td style="border:1px solid #ccc;padding:6px;">${w.review}</td><td style="border:1px solid #ccc;padding:6px;">${w.overdue}</td></tr>`;
      });
      tableHtml += '</tbody>';
    } else if (tab === 'deadlines') {
      tableHtml += '<thead><tr><th style="border:1px solid #ccc;padding:6px;">Task</th><th style="border:1px solid #ccc;padding:6px;">Status</th><th style="border:1px solid #ccc;padding:6px;">Priority</th><th style="border:1px solid #ccc;padding:6px;">Due Date</th></tr></thead><tbody>';
      [...deadlineData.overdue, ...deadlineData.dueToday, ...deadlineData.dueTomorrow, ...deadlineData.upcoming].forEach((t) => {
        tableHtml += `<tr><td style="border:1px solid #ccc;padding:6px;">${t.title}</td><td style="border:1px solid #ccc;padding:6px;">${t.status}</td><td style="border:1px solid #ccc;padding:6px;">${t.priority}</td><td style="border:1px solid #ccc;padding:6px;">${t.dueDate}</td></tr>`;
      });
      tableHtml += '</tbody>';
    } else if (tab === 'attendance') {
      tableHtml += '<thead><tr><th style="border:1px solid #ccc;padding:6px;">User</th><th style="border:1px solid #ccc;padding:6px;">Date</th><th style="border:1px solid #ccc;padding:6px;">Status</th><th style="border:1px solid #ccc;padding:6px;">Check In</th><th style="border:1px solid #ccc;padding:6px;">Check Out</th><th style="border:1px solid #ccc;padding:6px;">Hours</th></tr></thead><tbody>';
      roleFiltered.attendance.forEach((a) => {
        tableHtml += `<tr><td style="border:1px solid #ccc;padding:6px;">${users.find((u) => u.id === a.userId)?.name || a.userId}</td><td style="border:1px solid #ccc;padding:6px;">${a.date}</td><td style="border:1px solid #ccc;padding:6px;">${a.status}</td><td style="border:1px solid #ccc;padding:6px;">${a.checkIn}</td><td style="border:1px solid #ccc;padding:6px;">${a.checkOut || '-'}</td><td style="border:1px solid #ccc;padding:6px;">${a.totalHours}</td></tr>`;
      });
      tableHtml += '</tbody>';
    } else {
      tableHtml += '<thead><tr><th style="border:1px solid #ccc;padding:6px;">Metric</th><th style="border:1px solid #ccc;padding:6px;">Value</th></tr></thead><tbody>';
      tableHtml += `<tr><td style="border:1px solid #ccc;padding:6px;">Total Projects</td><td style="border:1px solid #ccc;padding:6px;">${kpiStats.totalProjects}</td></tr>`;
      tableHtml += `<tr><td style="border:1px solid #ccc;padding:6px;">Active Tasks</td><td style="border:1px solid #ccc;padding:6px;">${kpiStats.activeTasks}</td></tr>`;
      tableHtml += `<tr><td style="border:1px solid #ccc;padding:6px;">Completed Tasks</td><td style="border:1px solid #ccc;padding:6px;">${kpiStats.completedTasks}</td></tr>`;
      tableHtml += `<tr><td style="border:1px solid #ccc;padding:6px;">Overdue Tasks</td><td style="border:1px solid #ccc;padding:6px;">${kpiStats.overdueTasks}</td></tr>`;
      tableHtml += `<tr><td style="border:1px solid #ccc;padding:6px;">Completion Rate</td><td style="border:1px solid #ccc;padding:6px;">${kpiStats.completionRate}%</td></tr>`;
      tableHtml += `<tr><td style="border:1px solid #ccc;padding:6px;">Active Members</td><td style="border:1px solid #ccc;padding:6px;">${kpiStats.activeMembers}</td></tr>`;
      tableHtml += '</tbody>';
    }

    tableHtml += '</table>';

    const html = `<!DOCTYPE html><html><head><title>${title}</title><style>body{font-family:sans-serif;padding:20px;}</style></head><body><h2>${title}</h2>${tableHtml}<p style="font-size:11px;color:#666;">Generated: ${new Date().toLocaleString()}</p></body></html>`;
    printWindow.document.write(html);
    printWindow.document.close();
    setTimeout(() => printWindow.print(), 300);
  };

  const renderTabButton = (tab: ReportTab) => (
    <button
      key={tab}
      onClick={() => setActiveTab(tab)}
      className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all border ${
        activeTab === tab
          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-[0_0_10px_rgba(0,242,254,0.15)]'
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
    <GlassCard glowColor={glow === 'rose' ? 'magenta' : glow}>
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
            {renderKPICard('Completion Rate', `${kpiStats.completionRate}%`, <TrendingUp size={14} className="text-fuchsia-400" />, 'magenta')}
            {renderKPICard('Members', kpiStats.activeMembers, <Users size={14} className="text-cyan-400" />, 'cyan')}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <GlassCard glowColor="cyan">
              <div className="glass-panel p-4 rounded-lg">
                {renderSectionHeader(<Activity size={16} className="text-cyan-400" />, 'Project Health')}
                <div className="mt-3" style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={projectHealthData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} angle={-25} textAnchor="end" height={60} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} domain={[0, 100]} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="progress" fill={CHART_COLORS.cyan} radius={[4, 4, 0, 0]} name="Progress" />
                      <Bar dataKey="completion" fill={CHART_COLORS.violet} radius={[4, 4, 0, 0]} name="Task Completion" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </GlassCard>

            <GlassCard glowColor="violet">
              <div className="glass-panel p-4 rounded-lg">
                {renderSectionHeader(<TrendingUp size={16} className="text-violet-400" />, 'Task Completion Trend')}
                <div className="mt-3" style={{ height: 260 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={taskCompletionTrend} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 9 }} />
                      <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <Tooltip content={<CustomTooltip />} />
                      <Area type="monotone" dataKey="Completed" stroke={CHART_COLORS.emerald} fill={CHART_COLORS.emerald} fillOpacity={0.15} />
                      <Area type="monotone" dataKey="Created" stroke={CHART_COLORS.cyan} fill={CHART_COLORS.cyan} fillOpacity={0.1} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </GlassCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            <GlassCard glowColor="emerald">
              <div className="glass-panel p-4 rounded-lg">
                {renderSectionHeader(<Target size={16} className="text-emerald-400" />, 'Task Status Distribution')}
                <div className="mt-3 flex items-center justify-center" style={{ height: 260 }}>
                  {roleFiltered.tasks.length === 0 ? (
                    <p className="text-xs text-slate-500">No task data available for this period</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={taskStatusDist} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={3}>
                          {taskStatusDist.map((_entry, idx) => (
                            <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} stroke="rgba(9,10,15,0.8)" strokeWidth={2} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontSize: '10px', color: '#94a3b8' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </GlassCard>

            <GlassCard glowColor="magenta">
              <div className="glass-panel p-4 rounded-lg">
                {renderSectionHeader(<AlertTriangle size={16} className="text-fuchsia-400" />, 'Task Priority Distribution')}
                <div className="mt-3 flex items-center justify-center" style={{ height: 260 }}>
                  {roleFiltered.tasks.length === 0 ? (
                    <p className="text-xs text-slate-500">No task data available for this period</p>
                  ) : (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={taskPriorityDist} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={3}>
                          {taskPriorityDist.map((_entry, idx) => (
                            <Cell key={idx} fill={[CHART_COLORS.amber, CHART_COLORS.cyan, CHART_COLORS.violet, CHART_COLORS.rose][idx % 4]} stroke="rgba(9,10,15,0.8)" strokeWidth={2} />
                          ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                        <Legend wrapperStyle={{ fontSize: '10px', color: '#94a3b8' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  )}
                </div>
              </div>
            </GlassCard>
          </div>

          <GlassCard glowColor="cyan">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Clock size={16} className="text-cyan-400" />, 'Upcoming Deadlines', `${deadlineData.dueToday.length + deadlineData.dueTomorrow.length + deadlineData.upcoming.length} upcoming`)}
              <div className="mt-3 space-y-2">
                {deadlineData.dueToday.length === 0 && deadlineData.dueTomorrow.length === 0 && deadlineData.upcoming.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">No upcoming deadlines in this range</p>
                ) : (
                  [...deadlineData.dueToday, ...deadlineData.dueTomorrow, ...deadlineData.upcoming].slice(0, 8).map((t) => (
                    <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/40 border border-white/5 text-xs">
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

          <GlassCard glowColor="violet">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Users size={16} className="text-violet-400" />, 'Member Workload')}
              <div className="mt-3" style={{ height: 260 }}>
                {workloadData.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-8">No workload data available</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={workloadData.slice(0, 10)} layout="vertical" margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                      <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                      <YAxis dataKey="name" type="category" tick={{ fill: '#94a3b8', fontSize: 10 }} width={80} />
                      <Tooltip content={<CustomTooltip />} />
                      <Bar dataKey="active" fill={CHART_COLORS.cyan} radius={[0, 4, 4, 0]} name="Active" stackId="a" />
                      <Bar dataKey="review" fill={CHART_COLORS.amber} radius={[0, 0, 0, 0]} name="Review" stackId="a" />
                      <Bar dataKey="completed" fill={CHART_COLORS.emerald} radius={[0, 0, 0, 0]} name="Completed" stackId="a" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </GlassCard>

          <GlassCard glowColor="amber">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<CheckCircle2 size={16} className="text-amber-400" />, 'Insights')}
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-900/40 border border-white/5 text-xs">
                  <span className="text-slate-400 block mb-1">Overall Progress</span>
                  <span className="text-white font-bold">
                    {kpiStats.completionRate}% tasks completed ({kpiStats.completedTasks}/{roleFiltered.tasks.length})
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-900/40 border border-white/5 text-xs">
                  <span className="text-slate-400 block mb-1">Risk Factors</span>
                  <span className={`font-bold ${kpiStats.overdueTasks > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                    {kpiStats.overdueTasks > 0 ? `${kpiStats.overdueTasks} overdue tasks` : 'No overdue tasks'}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-900/40 border border-white/5 text-xs">
                  <span className="text-slate-400 block mb-1">Active Projects</span>
                  <span className="text-white font-bold">
                    {kpiStats.totalProjects} projects | {kpiStats.activeMembers} contributors
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-900/40 border border-white/5 text-xs">
                  <span className="text-slate-400 block mb-1">Task Distribution</span>
                  <span className="text-white font-bold">
                    {roleFiltered.tasks.length} total | {roleFiltered.tasks.filter((t) => t.status === 'In Progress').length} in progress
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
            {renderKPICard('Pending Leaves', hrOverviewStats.pendingLeaveReqs, <FileSpreadsheet size={14} className="text-fuchsia-400" />, 'magenta')}
            {renderKPICard('Pending Corrections', hrOverviewStats.pendingCorrections, <ListTodo size={14} className="text-amber-400" />, 'amber')}
          </div>

          <GlassCard glowColor="cyan">
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
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {Object.keys({ a: 0, b: 1, c: 2, d: 3 }).map((_, i) => (
                        <Cell key={i} fill={[CHART_COLORS.emerald, CHART_COLORS.rose, CHART_COLORS.cyan, CHART_COLORS.amber][i]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </GlassCard>

          <GlassCard glowColor="amber">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Activity size={16} className="text-amber-400" />, 'Insights')}
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-slate-900/40 border border-white/5 text-xs">
                  <span className="text-slate-400 block mb-1">Attendance Rate</span>
                  <span className="text-white font-bold">
                    {hrOverviewStats.presentToday > 0
                      ? `${Math.round((hrOverviewStats.presentToday / (hrOverviewStats.presentToday + hrOverviewStats.absentToday + hrOverviewStats.onLeaveToday + hrOverviewStats.lateToday || 1)) * 100)}% present`
                      : 'No records today'}
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-900/40 border border-white/5 text-xs">
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
        {renderKPICard('Avg Progress', roleFiltered.projects.length > 0 ? `${Math.round(roleFiltered.projects.reduce((s, p) => s + p.progress, 0) / roleFiltered.projects.length)}%` : '0%', <TrendingUp size={14} className="text-violet-400" />, 'violet')}
        {renderKPICard('Active', roleFiltered.projects.filter((p) => p.status === 'Active').length, <Activity size={14} className="text-emerald-400" />, 'emerald')}
        {renderKPICard('Completed', roleFiltered.projects.filter((p) => p.status === 'Completed').length, <CheckCircle2 size={14} className="text-fuchsia-400" />, 'magenta')}
      </div>

      <GlassCard glowColor="cyan">
        <div className="glass-panel p-4 rounded-lg">
          {renderSectionHeader(<BarChart3 size={16} className="text-cyan-400" />, 'Project Progress & Completion')}
          <div className="mt-3" style={{ height: 300 }}>
            {projectHealthData.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">No project data available</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={projectHealthData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} angle={-25} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} domain={[0, 100]} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Bar dataKey="progress" fill={CHART_COLORS.cyan} radius={[4, 4, 0, 0]} name="Progress %" />
                  <Bar dataKey="completion" fill={CHART_COLORS.violet} radius={[4, 4, 0, 0]} name="Task Completion %" />
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
            {roleFiltered.projects.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-500 py-6">No projects in range</td></tr>
            ) : (
              roleFiltered.projects.map((p) => {
                const pTasks = roleFiltered.tasks.filter((t) => t.projectId === p.id);
                const overdue = pTasks.filter((t) => t.status !== 'Done' && t.dueDate < todayStr()).length;
                const healthLabel = p.progress >= 70 ? 'On Track' : p.progress >= 40 ? 'At Risk' : 'Needs Attention';
                return (
                  <tr key={p.id}>
                    <td className="text-white font-medium">{p.title}</td>
                    <td className="text-slate-400 font-mono text-[10px]">{p.code}</td>
                    <td><StatusBadge status={p.status} size="sm" /></td>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-slate-700">
                          <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-violet-500" style={{ width: `${p.progress}%` }} />
                        </div>
                        <span className="text-[10px] font-mono text-slate-300">{p.progress}%</span>
                      </div>
                    </td>
                    <td className="font-mono text-xs">{pTasks.length}</td>
                    <td className={`font-mono text-xs ${overdue > 0 ? 'text-rose-400' : 'text-slate-400'}`}>{overdue}</td>
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
        {renderKPICard('Total Tasks', teamStats.reduce((s, t) => s + t.tasks, 0), <CheckSquare size={14} className="text-violet-400" />, 'violet')}
        {renderKPICard('Completed', teamStats.reduce((s, t) => s + t.completed, 0), <CheckCircle2 size={14} className="text-emerald-400" />, 'emerald')}
        {renderKPICard('Avg Rate', teamStats.length > 0 ? `${Math.round(teamStats.reduce((s, t) => s + t.rate, 0) / teamStats.length)}%` : '0%', <Target size={14} className="text-fuchsia-400" />, 'magenta')}
      </div>

      <GlassCard glowColor="cyan">
        <div className="glass-panel p-4 rounded-lg">
          {renderSectionHeader(<BarChart3 size={16} className="text-cyan-400" />, 'Department Performance')}
          <div className="mt-3" style={{ height: 300 }}>
            {teamStats.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">No department data available</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={teamStats} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="department" tick={{ fill: '#94a3b8', fontSize: 9 }} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Bar dataKey="tasks" fill={CHART_COLORS.cyan} radius={[4, 4, 0, 0]} name="Tasks" />
                  <Bar dataKey="completed" fill={CHART_COLORS.emerald} radius={[4, 4, 0, 0]} name="Completed" />
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
              teamStats.map((t) => (
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
        {renderKPICard('Active Tasks', workloadData.reduce((s, w) => s + w.active, 0), <Activity size={14} className="text-cyan-400" />, 'cyan')}
        {renderKPICard('Completed', workloadData.reduce((s, w) => s + w.completed, 0), <CheckCircle2 size={14} className="text-emerald-400" />, 'emerald')}
        {renderKPICard('In Review', workloadData.reduce((s, w) => s + w.review, 0), <Target size={14} className="text-violet-400" />, 'violet')}
        {renderKPICard('Overdue', workloadData.reduce((s, w) => s + w.overdue, 0), <AlertTriangle size={14} className="text-amber-400" />, 'amber')}
        {renderKPICard('Members', workloadData.length, <Users size={14} className="text-fuchsia-400" />, 'magenta')}
      </div>

      <GlassCard glowColor="violet">
        <div className="glass-panel p-4 rounded-lg">
          {renderSectionHeader(<BarChart3 size={16} className="text-violet-400" />, 'Workload Distribution')}
          <div className="mt-3" style={{ height: 320 }}>
            {workloadData.length === 0 ? (
              <p className="text-xs text-slate-500 text-center py-8">No workload data available</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={workloadData.slice(0, 15)} layout="vertical" margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <YAxis dataKey="name" type="category" tick={{ fill: '#94a3b8', fontSize: 10 }} width={80} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: '10px' }} />
                  <Bar dataKey="active" fill={CHART_COLORS.cyan} radius={[0, 4, 4, 0]} name="Active" stackId="a" />
                  <Bar dataKey="review" fill={CHART_COLORS.amber} radius={[0, 0, 0, 0]} name="Review" stackId="a" />
                  <Bar dataKey="completed" fill={CHART_COLORS.emerald} radius={[0, 0, 0, 0]} name="Completed" stackId="a" />
                  <Bar dataKey="overdue" fill={CHART_COLORS.rose} radius={[0, 0, 0, 0]} name="Overdue" stackId="a" />
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
              workloadData.map((w) => {
                const total = w.active + w.completed + w.review;
                const wlLabel = total >= 8 ? 'Heavy' : total >= 4 ? 'Moderate' : 'Light';
                return (
                  <tr key={w.name}>
                    <td className="text-white font-medium">{w.name}</td>
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
          <GlassCard glowColor="cyan">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Clock size={16} className="text-cyan-400" />, 'Due Today', `${deadlineData.dueToday.length} tasks`)}
              <div className="mt-3 space-y-2">
                {deadlineData.dueToday.map((t) => (
                  <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/40 border border-cyan-500/20 text-xs">
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
          <GlassCard glowColor="violet">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Calendar size={16} className="text-violet-400" />, 'Due Tomorrow', `${deadlineData.dueTomorrow.length} tasks`)}
              <div className="mt-3 space-y-2">
                {deadlineData.dueTomorrow.map((t) => (
                  <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/40 border border-purple-500/20 text-xs">
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
          <GlassCard glowColor="emerald">
            <div className="glass-panel p-4 rounded-lg">
              {renderSectionHeader(<Target size={16} className="text-emerald-400" />, 'Upcoming Deadlines', `${deadlineData.upcoming.length} tasks`)}
              <div className="mt-3 space-y-2">
                {deadlineData.upcoming.map((t) => (
                  <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/40 border border-emerald-500/20 text-xs">
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
          <GlassCard glowColor="amber">
            <div className="glass-panel p-4 rounded-lg border border-rose-500/20">
              {renderSectionHeader(<AlertTriangle size={16} className="text-rose-400" />, 'Overdue Tasks', `${deadlineData.overdue.length} overdue`)}
              <div className="mt-3 space-y-2">
                {deadlineData.overdue.map((t) => (
                  <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/40 border border-rose-500/20 text-xs">
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

      <GlassCard glowColor="cyan">
        <div className="glass-panel p-4 rounded-lg">
          {renderSectionHeader(<BarChart3 size={16} className="text-cyan-400" />, 'Attendance Distribution')}
          <div className="mt-3" style={{ height: 260 }}>
            {roleFiltered.attendance.length === 0 ? (
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
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                    {[CHART_COLORS.emerald, CHART_COLORS.amber, CHART_COLORS.rose, CHART_COLORS.cyan, CHART_COLORS.violet].map((color, i) => (
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
            {roleFiltered.attendance.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-500 py-6">No records in range</td></tr>
            ) : (
              roleFiltered.attendance.map((a) => (
                <tr key={a.id}>
                  <td className="text-white font-medium text-xs">{users.find((u) => u.id === a.userId)?.name || a.userId}</td>
                  <td className="font-mono text-[10px]">{a.date}</td>
                  <td><StatusBadge status={a.status} size="sm" /></td>
                  <td className="font-mono text-xs">{a.checkIn}</td>
                  <td className="font-mono text-xs text-slate-400">{a.checkOut || '—'}</td>
                  <td className="font-mono text-xs">{a.totalHours}h</td>
                  <td className="font-mono text-xs text-slate-400">{a.breaks?.length || 0}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {roleFiltered.hrRequests.length > 0 && (
        <GlassCard glowColor="amber">
          <div className="glass-panel p-4 rounded-lg">
            {renderSectionHeader(<ListTodo size={16} className="text-amber-400" />, 'Pending HR Requests', `${roleFiltered.hrRequests.length} pending`)}
            <div className="mt-3 space-y-2">
              {roleFiltered.hrRequests.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-900/40 border border-white/5 text-xs">
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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <GlassCard glowColor="cyan">
          <div className="p-6 text-center space-y-4">
            <FileSpreadsheet size={40} className="mx-auto text-cyan-400" />
            <div>
              <h3 className="text-sm font-bold text-white">CSV Export</h3>
              <p className="text-xs text-slate-400 mt-1">Export the current report as a CSV spreadsheet</p>
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              {tabLabels[activeTab]} Report | {dateRange.from} – {dateRange.to}
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
        </GlassCard>

        <GlassCard glowColor="violet">
          <div className="p-6 text-center space-y-4">
            <FileText size={40} className="mx-auto text-violet-400" />
            <div>
              <h3 className="text-sm font-bold text-white">PDF Export</h3>
              <p className="text-xs text-slate-400 mt-1">Open a printable PDF version of the current report</p>
            </div>
            <div className="text-[10px] text-slate-500 font-mono">
              {tabLabels[activeTab]} Report | {dateRange.from} – {dateRange.to}
            </div>
            <button
              onClick={handlePdfExport}
              disabled={hasError}
              className="w-full py-2.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/40 text-purple-300 text-xs font-bold flex items-center justify-center gap-2 shadow transition-all"
            >
              <Download size={14} />
              <span>Print PDF</span>
            </button>
          </div>
        </GlassCard>
      </div>

      <GlassCard glowColor="cyan">
        <div className="glass-panel p-4 rounded-lg">
          {renderSectionHeader(<FileSpreadsheet size={16} className="text-cyan-400" />, 'Export Summary')}
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-lg bg-slate-900/40 border border-white/5">
              <span className="text-slate-400 block mb-1">Current View</span>
              <span className="text-white font-bold">{tabLabels[activeTab]}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/40 border border-white/5">
              <span className="text-slate-400 block mb-1">Date Range</span>
              <span className="text-white font-bold font-mono text-[10px]">{dateRange.from} – {dateRange.to}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/40 border border-white/5">
              <span className="text-slate-400 block mb-1">Role</span>
              <span className="text-white font-bold">{currentRole.replace('_', ' ')}</span>
            </div>
            <div className="p-3 rounded-lg bg-slate-900/40 border border-white/5">
              <span className="text-slate-400 block mb-1">Data Records</span>
              <span className="text-white font-bold">
                {activeTab === 'projects' ? roleFiltered.projects.length :
                 activeTab === 'workload' ? workloadData.length :
                 activeTab === 'deadlines' ? deadlineData.dueToday.length + deadlineData.dueTomorrow.length + deadlineData.upcoming.length + deadlineData.overdue.length :
                 activeTab === 'attendance' ? roleFiltered.attendance.length :
                 activeTab === 'teams' ? teamStats.length : roleFiltered.tasks.length}
              </span>
            </div>
          </div>
        </div>
      </GlassCard>
    </div>
  );

  const renderTabContent = () => {
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
              className={`px-2.5 py-1.5 rounded-lg text-xs font-mono border ${
                validationError ? 'border-rose-500/60 bg-rose-500/10 text-rose-300' : 'bg-slate-900/60 border-white/10 text-slate-200'
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
              className={`px-2.5 py-1.5 rounded-lg text-xs font-mono border ${
                validationError ? 'border-rose-500/60 bg-rose-500/10 text-rose-300' : 'bg-slate-900/60 border-white/10 text-slate-200'
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

      <div className="flex flex-wrap gap-1.5 p-1.5 rounded-xl bg-slate-900/40 border border-white/5">
        {visibleTabs.map(renderTabButton)}
      </div>

      {renderTabContent()}
    </div>
  );
};
