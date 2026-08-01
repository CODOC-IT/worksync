import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { useApp } from '../../store/AppContext';
import { GlassCard } from '../../components/common/GlassCard';
import { StatusBadge } from '../../components/common/StatusBadge';
import { TaskPriority, TaskStatus, Task, ActivityLogItem } from '../../types';
import {
  FolderKanban,
  CheckSquare,
  Sparkles,
  Plus,
  ChevronLeft,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Activity,
  ShieldCheck,
  FileCheck2,
  Users,
  ChevronRight,
  ArrowUpRight,
  Inbox,
  Filter,
} from 'lucide-react';
import { fetchActivities } from '../activity/activityApi';
import { ActivityItem, DEFAULT_ACTIVITY_FILTERS } from '../activity/activityTypes';
import {
  ALL_CALENDAR_KINDS,
  buildCalendarEntries,
  entryToneClasses,
  filterCalendarEntries,
  isMyDeadlineEntry,
  todayDateKey,
  CalendarEntry,
  CalendarEntryKind,
  CalendarEntryOrigin,
} from '../calendar/calendarRules';
import { CalendarFilterBar } from '../calendar/CalendarFilterBar';

interface DashboardViewProps {
  onNavigate: (tab: string, filterId?: string) => void;
}

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  Low: 'text-slate-400 border-slate-500/30 bg-slate-500/20',
  Medium: 'text-cyan-300 border-cyan-500/30 bg-cyan-500/20',
  High: 'text-amber-300 border-amber-500/30 bg-amber-500/20',
  Urgent: 'text-rose-300 border-rose-500/30 bg-rose-500/20',
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  Todo: 'bg-slate-500/30 text-slate-300',
  'In Progress': 'bg-cyan-500/30 text-cyan-300',
  Review: 'bg-purple-500/30 text-purple-300',
  Done: 'bg-emerald-500/30 text-emerald-300',
  Blocked: 'bg-rose-500/30 text-rose-300',
};

const PROJECT_STATUS_DOT: Record<string, string> = {
  Active: 'bg-emerald-400',
  'Pending Approval': 'bg-amber-400',
  'On Hold': 'bg-slate-400',
  Draft: 'bg-slate-500',
  Completed: 'bg-cyan-400',
  Archived: 'bg-slate-600',
};

interface MiniCalendarProps {
  entries: CalendarEntry[];
}

const MiniCalendar: React.FC<MiniCalendarProps> = ({ entries }) => {
  const [viewDate, setViewDate] = React.useState(new Date());
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
  const startPad = firstDay.getDay();

  const entriesByDate = useMemo(() => {
    const map = new Map<string, { titles: string[]; kinds: Set<CalendarEntryKind> }>();
    entries.forEach((entry) => {
      const key = entry.date;
      if (!map.has(key)) map.set(key, { titles: [], kinds: new Set() });
      const bucket = map.get(key)!;
      bucket.titles.push(entry.title);
      bucket.kinds.add(entry.kind);
    });
    return map;
  }, [entries]);

  const days: (number | null)[] = [];
  for (let i = 0; i < startPad; i++) days.push(null);
  for (let d = 1; d <= lastDay.getDate(); d++) days.push(d);

  return (
    <div className="rounded-xl bg-slate-900/50 border border-white/10 p-3">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1))} className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"><ChevronLeft size={12} /></button>
        <span className="text-[11px] font-bold text-white">{monthNames[viewDate.getMonth()]} {viewDate.getFullYear()}</span>
        <button onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1))} className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-white transition-colors"><ChevronRight size={12} /></button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {dayNames.map((d) => <span key={d} className="text-[8px] text-slate-500 font-mono text-center py-0.5">{d}</span>)}
        {days.map((day, i) => {
          if (day === null) return <div key={`pad-${i}`} />;
          const dateStr = `${viewDate.getFullYear()}-${String(viewDate.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const bucket = entriesByDate.get(dateStr);
          const kinds = bucket ? Array.from(bucket.kinds) : [];
          const isToday = day === today.getDate() && viewDate.getMonth() === today.getMonth() && viewDate.getFullYear() === today.getFullYear();
          return (
            <div key={day} title={bucket ? bucket.titles.join('\n') : undefined}
              className={`text-[10px] text-center py-0.5 rounded cursor-default relative ${isToday ? 'bg-cyan-500/30 text-cyan-200 font-bold ring-1 ring-cyan-500/50' : bucket ? 'text-slate-200 font-semibold' : 'text-slate-500'}`}>
              {day}
              {kinds.length > 0 && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex items-center gap-[2px]">
                  {kinds.slice(0, 3).map((kind) => (
                    <span key={kind} className={`w-1 h-1 rounded-full ${entryToneClasses(kind).dotClass}`} />
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// Formats a Date as a local calendar date string (YYYY-MM-DD). The activity API's
// `dateBounds()` Custom preset parses customFrom/customTo as LOCAL dates, so we must
// supply local date strings here — using UTC date strings (toISOString) shifts the
// range by the timezone offset and silently drops recent activity on non-UTC systems.
const toLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const { currentRole, currentUser, projects, tasks, systemApprovals, hrRequests, users, calendarEvents } = useApp();

  // ── Activity Log Filter State ──
  type ActivityFilterOption = 'Today' | 'Last Day' | 'Last 3 Days';
  const [activityFilter, setActivityFilter] = useState<ActivityFilterOption>('Today');
  const [filteredActivityLogs, setFilteredActivityLogs] = useState<ActivityLogItem[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadFilteredActivities = async () => {
      setActivityLoading(true);
      try {
        const now = new Date();
        let fromDate: Date;
        const toDate = now;

        if (activityFilter === 'Today') {
          fromDate = new Date(now);
          fromDate.setHours(0, 0, 0, 0);
        } else if (activityFilter === 'Last Day') {
          fromDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        } else {
          fromDate = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
        }

        const filters = { ...DEFAULT_ACTIVITY_FILTERS, datePreset: 'Custom' as const, customFrom: toLocalDateString(fromDate), customTo: toLocalDateString(toDate) };
        const result = await fetchActivities(filters, 1, 50);
        if (!cancelled && Array.isArray(result.items)) {
          const mapped: ActivityLogItem[] = (result.items as ActivityItem[]).map((item) => ({
            id: item.id,
            userId: item.actor.id || '',
            userName: item.actor.name,
            action: `${item.action} ${item.entityType}`,
            targetType: (item.entityType === 'Task' ? 'Task' : item.entityType === 'Project' ? 'Project' : item.entityType === 'Attendance' ? 'Attendance' : 'Approval') as ActivityLogItem['targetType'],
            targetId: item.entityId,
            targetTitle: item.entityName || item.description,
            timestamp: new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            diff: item.changes.length > 0 ? { field: item.changes[0].field, oldVal: item.changes[0].previousValue || '', newVal: item.changes[0].newValue || '' } : undefined,
          }));
          if (!cancelled) setFilteredActivityLogs(mapped);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to load filtered activities.', err);
          setFilteredActivityLogs([]);
        }
      } finally {
        if (!cancelled) setActivityLoading(false);
      }
    };
    loadFilteredActivities();
    return () => { cancelled = true; };
  }, [activityFilter]);

  // ── Deadline Filter State ──
  type DeadlineFilterOption = 'Due Today' | 'Due in 1 Day' | 'Due in 3 Days';
  const [deadlineFilter, setDeadlineFilter] = useState<DeadlineFilterOption>('Due Today');

  const today = new Date();
  const todayEnd = new Date(today);
  todayEnd.setHours(23, 59, 59, 999);
  const oneDayFromNow = new Date(today.getTime() + 24 * 60 * 60 * 1000);
  oneDayFromNow.setHours(23, 59, 59, 999);
  const threeDaysFromNow = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000);
  threeDaysFromNow.setHours(23, 59, 59, 999);

  const activeProjects = useMemo(() => projects.filter((p) => p.status !== 'Archived').sort((a, b) => (a.targetDate || '9999').localeCompare(b.targetDate || '9999')), [projects]);

  const filteredProjects = useMemo(() => {
    return activeProjects.filter((p) => {
      if (!p.targetDate) return false;
      const targetDate = new Date(p.targetDate);
      targetDate.setHours(23, 59, 59, 999);
      if (deadlineFilter === 'Due Today') {
        return targetDate >= today && targetDate <= todayEnd;
      } else if (deadlineFilter === 'Due in 1 Day') {
        return targetDate >= today && targetDate <= oneDayFromNow;
      } else {
        return targetDate >= today && targetDate <= threeDaysFromNow;
      }
    });
  }, [activeProjects, deadlineFilter, today, todayEnd, oneDayFromNow, threeDaysFromNow]);

  const isMyTask = useCallback((t: Task) => t.assigneeId === currentUser.id || (t.assigneeIds ?? []).includes(currentUser.id), [currentUser.id]);
  const myTasks = useMemo(() => tasks.filter((t) => !t.isArchived && isMyTask(t) && t.status !== 'Done').sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')), [tasks, isMyTask]);
  const pendingProjects = useMemo(() => projects.filter((p) => p.approvalStatus === 'Pending Approval'), [projects]);
  const pendingApprovals = useMemo(() => systemApprovals.filter((sa) => sa.status === 'Pending'), [systemApprovals]);
  const pendingHrRequests = useMemo(() => hrRequests.filter((r) => r.status === 'Pending'), [hrRequests]);

  // ── Mini Calendar filter state (mirrors the Calendar module's CalendarFilterBar) ──
  const [originFilter, setOriginFilter] = useState<'all' | CalendarEntryOrigin>('all');
  const [activeKinds, setActiveKinds] = useState<Set<CalendarEntryKind>>(new Set(ALL_CALENDAR_KINDS));
  const [myDeadlinesOnly, setMyDeadlinesOnly] = useState(false);

  const calendarEntries = useMemo(
    () => buildCalendarEntries(projects, tasks, calendarEvents),
    [projects, tasks, calendarEvents]
  );

  const filteredCalendarEntries = useMemo(() => {
    const filtered = filterCalendarEntries(calendarEntries, originFilter, activeKinds);
    return myDeadlinesOnly
      ? filtered.filter((entry) => isMyDeadlineEntry(entry, projects, tasks, currentUser.id))
      : filtered;
  }, [calendarEntries, originFilter, activeKinds, myDeadlinesOnly, projects, tasks, currentUser.id]);

  const todayKey = todayDateKey();
  const upcomingCalendarEntries = useMemo(
    () => filteredCalendarEntries.filter((d) => d.date >= todayKey).sort((a, b) => a.date.localeCompare(b.date)),
    [filteredCalendarEntries, todayKey]
  );

  return (
    <div className="space-y-3">
      {/* ── Banner ── */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 p-3 md:p-4 glass-panel-glow border-cyan-500/30">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30">{currentRole.replace('_', ' ')}</span>
            <span className="text-[10px] text-slate-400 font-mono">• {currentUser.department}</span>
          </div>
          <h1 className="text-xl md:text-2xl font-extrabold text-white">Welcome back, <span className="text-gradient-neon">{currentUser.name.split(' ')[0]}</span></h1>
          <p className="text-[10px] sm:text-[11px] text-slate-400 mt-0.5 hidden sm:block">
            {currentRole === 'Admin' && 'System Oversight Active: Approvals, projects, and team activity at a glance.'}
            {currentRole === 'Team_Lead' && 'Team Operations Active: Manage projects, approvals & milestones.'}
            {currentRole === 'HR' && 'People Operations Active: Attendance corrections & leave exceptions in queue.'}
            {currentRole === 'Team_Member' && 'My Workstation Active: Track tasks, attendance & AI tools.'}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(currentRole === 'Admin' || currentRole === 'Team_Lead') && (<button onClick={() => onNavigate('projects')} className="px-3 py-2 rounded-xl glass-button-neon text-xs font-semibold flex items-center gap-1.5">Project</button>)}
          <button onClick={() => onNavigate('tasks')} className="px-3 py-2 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"> Task</button>
          <button onClick={() => onNavigate('ai-assistant')} className="px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"><Sparkles size={12} /> AI</button>
        </div>
      </div>

      {/* ── Metric Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-2.5">
        <GlassCard onClick={() => onNavigate('projects')} glowColor="cyan">
          <div className="flex items-center justify-between mb-2"><span className="text-[10px] font-mono text-slate-400">Projects</span><div className="p-1.5 rounded-lg bg-cyan-500/20 text-cyan-400"><FolderKanban size={14} /></div></div>
          <div className="text-2xl font-bold text-white mb-1">{activeProjects.length}</div>
          <span className="text-[10px] text-slate-400">{pendingProjects.length} pending approval</span>
        </GlassCard>
        <GlassCard onClick={() => onNavigate('tasks')} glowColor="violet">
          <div className="flex items-center justify-between mb-2"><span className="text-[10px] font-mono text-slate-400">My Tasks</span><div className="p-1.5 rounded-lg bg-purple-500/20 text-purple-400"><CheckSquare size={14} /></div></div>
          <div className="text-2xl font-bold text-white mb-1">{myTasks.length}</div>
          <span className="text-[10px] text-slate-400">{myTasks.filter((t) => t.status === 'In Progress').length} in progress</span>
        </GlassCard>
        <GlassCard onClick={() => onNavigate('approvals')} glowColor="amber">
          <div className="flex items-center justify-between mb-2"><span className="text-[10px] font-mono text-slate-400">Approvals</span><div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400"><AlertCircle size={14} /></div></div>
          <div className="text-2xl font-bold text-white mb-1">{pendingApprovals.length + pendingHrRequests.length}</div>
          <span className="text-[10px] text-slate-400">{pendingApprovals.length} edits + {pendingHrRequests.length} HR</span>
        </GlassCard>
      </div>

      {/* ── Row 1 (top): Calendar | Activity Log | Approvals ── */}
      <div className="flex flex-wrap gap-3">
        {/* Calendar */}
        <div className="flex-1 min-w-[300px] max-w-full">
          <div className="glass-panel h-full p-3 border border-cyan-500/20 overflow-y-auto">
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
                <div className="flex items-center gap-2"><Calendar size={14} className="text-cyan-400" /><h3 className="font-bold text-xs text-white">Calendar</h3></div>
                <button onClick={() => onNavigate('calendar')} className="text-[10px] text-cyan-400 hover:underline font-mono">Open</button>
              </div>
              <div className="mb-2">
                <CalendarFilterBar
                  originFilter={originFilter}
                  onOriginFilterChange={setOriginFilter}
                  activeKinds={activeKinds}
                  onActiveKindsChange={setActiveKinds}
                  myDeadlinesOnly={myDeadlinesOnly}
                  onMyDeadlinesOnlyChange={setMyDeadlinesOnly}
                />
              </div>
              <MiniCalendar entries={filteredCalendarEntries} />
              {upcomingCalendarEntries.length > 0 ? (
                <div className="mt-3 space-y-1.5 max-h-[100px] overflow-y-auto pr-1">
                  <span className="text-[9px] font-mono text-slate-500 uppercase">Upcoming</span>
                  {upcomingCalendarEntries.slice(0, 5).map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] p-1 rounded hover:bg-white/5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${entryToneClasses(d.kind).dotClass}`} />
                      <span className="text-slate-400 font-mono w-20 shrink-0">{d.date}</span>
                      <span className="text-slate-300 truncate">{d.title}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 text-center">
                  <p className="text-[10px] text-slate-600 font-mono">No upcoming deadlines</p>
                </div>
              )}
            </div>
        </div>

        {/* Activity Log */}
        <div className="flex-1 min-w-[300px] max-w-full">
          <div className="glass-panel p-3 border border-purple-500/20 h-90 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2"><Activity size={14} className="text-cyan-400" /><h3 className="font-bold text-xs text-white">Activity Log</h3></div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Filter size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                  <select
                    value={activityFilter}
                    onChange={(e) => setActivityFilter(e.target.value as ActivityFilterOption)}
                    className="appearance-none bg-slate-800/80 border border-white/10 rounded-md text-[10px] text-slate-300 pl-5 pr-4 py-1 focus:outline-none focus:border-cyan-500/50 cursor-pointer hover:bg-slate-700/80 transition-colors"
                    aria-label="Filter activity by date range"
                  >
                    <option value="Today">Today</option>
                    <option value="Last Day">Last Day</option>
                    <option value="Last 3 Days">Last 3 Days</option>
                  </select>
                </div>
                <button onClick={() => onNavigate('activity')} className="text-[10px] text-cyan-400 hover:underline font-mono flex items-center gap-1">Full Log <ChevronRight size={10} /></button>
              </div>
            </div>
            <div className="overflow-y-auto pr-1 space-y-2 flex-1 min-h-0">
              {activityLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-4 h-4 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
                </div>
              ) : filteredActivityLogs.length === 0 ? (
                <p className="text-[11px] text-slate-500 text-center py-12">No activity found for the selected period.</p>
              ) : (
                filteredActivityLogs.map((log) => (
                  <div key={log.id} className="p-2.5 rounded-xl bg-slate-900/50 border border-white/5 flex items-start gap-3 text-[10px]">
                    <span className="w-6 h-6 rounded-lg bg-cyan-500/15 text-[8px] font-bold text-cyan-300 flex items-center justify-center ring-1 ring-white/10 shrink-0 mt-0.5">{log.userName.split(/\s+/).filter(Boolean).slice(0, 2).map((s: string) => s[0]?.toUpperCase()).join('') || 'U'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5"><span className="font-bold text-white text-[10px]">{log.userName}</span><span className="text-slate-400 text-[10px]">{log.action}</span></div>
                      <span className="text-[10px] text-cyan-300 font-mono block truncate">{log.targetTitle}</span>
                      {log.diff && (
                        <div className="mt-1 p-1.5 rounded bg-black/40 font-mono text-[9px] text-slate-300 flex items-center gap-2 border border-white/5 flex-wrap">
                          <span className="text-rose-400 line-through truncate max-w-[100px]">{log.diff.oldVal}</span><span>→</span><span className="text-emerald-400 truncate max-w-[100px]">{log.diff.newVal}</span>
                        </div>
                      )}
                    </div>
                    <span className="text-[9px] text-slate-500 font-mono shrink-0">{log.timestamp}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Approvals + HR */}
        <div className="flex-1 min-w-[300px] max-w-full space-y-2.5">
          {(currentRole === 'Admin' || currentRole === 'Team_Lead') && (
            <div className="glass-panel p-3 border border-amber-500/30 h-90 overflow-y-auto flex flex-col">
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
                <div className="flex items-center gap-2"><ShieldCheck size={14} className="text-amber-400" /><h3 className="font-bold text-xs text-white">Approvals Inbox</h3><span className="text-[10px] text-amber-400 font-mono">({pendingApprovals.length})</span></div>
                <button onClick={() => onNavigate('approvals')} className="text-[10px] text-amber-400 hover:underline font-mono flex items-center gap-1">All <ChevronRight size={10} /></button>
              </div>
              {pendingApprovals.length === 0 ? (
                <div className="flex flex-col items-center h-full justify-center py-10 text-center">
                  <CheckCircle2 size={28} className="text-slate-600 mb-2" />
                  <p className="text-[11px] text-slate-500">All caught up!</p>
                </div>
              ) : (
                <div className="space-y-2 overflow-y-auto pr-1 flex-1 min-h-0">
                  {pendingApprovals.map((app) => (
                    <div key={app.id} onClick={() => onNavigate('approvals', app.id)} className="p-2.5 rounded-xl bg-slate-900/50 border border-amber-500/20 hover:border-amber-500/40 cursor-pointer transition-all">
                      <div className="flex items-center gap-2 mb-1 flex-wrap"><span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[9px] font-mono font-bold">{app.type.replace('_', ' ')}</span><span className="text-[10px] font-bold text-white truncate">{app.targetTitle}</span></div>
                      <p className="text-[10px] text-slate-300 line-clamp-1">{app.details}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {currentRole === 'HR' && (
            <div className="glass-panel p-3 border border-emerald-500/30 h-90 overflow-y-auto flex flex-col">
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
                <div className="flex items-center gap-2"><FileCheck2 size={14} className="text-emerald-400" /><h3 className="font-bold text-xs text-white">HR Queue</h3><span className="text-[10px] text-emerald-400 font-mono">({pendingHrRequests.length})</span></div>
                <button onClick={() => onNavigate('attendance')} className="text-[10px] text-emerald-400 hover:underline font-mono flex items-center gap-1">Manage <ChevronRight size={10} /></button>
              </div>
              {pendingHrRequests.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <CheckCircle2 size={28} className="text-slate-600 mb-2" />
                  <p className="text-[11px] text-slate-500">No pending HR requests</p>
                </div>
              ) : (
                <div className="space-y-2 overflow-y-auto pr-1 flex-1 min-h-0">
                  {pendingHrRequests.map((req) => (
                    <div key={req.id} onClick={() => onNavigate('attendance')} className="p-2.5 rounded-xl bg-slate-900/50 border border-emerald-500/20 hover:border-emerald-500/40 cursor-pointer transition-all">
                      <div className="flex items-center gap-2 mb-1 flex-wrap"><StatusBadge status={req.type.replace('_', ' ')} size="sm" /><span className="text-[10px] font-bold text-slate-200">{users.find((u) => u.id === req.userId)?.name || 'Team Member'}</span><span className="text-[9px] text-slate-500 font-mono">{req.submittedAt}</span></div>
                      <p className="text-[10px] text-slate-300 line-clamp-1">"{req.reason}"</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {currentRole !== 'Admin' && currentRole !== 'Team_Lead' && currentRole !== 'HR' && (
            <div className="glass-panel p-3 border border-white/10 h-90 overflow-y-auto flex flex-col">
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
                <div className="flex items-center gap-2"><ShieldCheck size={14} className="text-slate-500" /><h3 className="font-bold text-xs text-slate-400">Approvals</h3></div>
              </div>
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <p className="text-[11px] text-slate-500">No pending approvals</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Attendance (removed) ── */}

      {/* ── Row 2 (bottom): Projects ── */}
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[300px] max-w-full">
          <div className="glass-panel h-full p-3 border border-cyan-500/20 h-90 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2"><FolderKanban size={14} className="text-cyan-400" /><h3 className="font-bold text-xs text-white">Projects</h3></div>
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Filter size={10} className="absolute left-1.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                  <select
                    value={deadlineFilter}
                    onChange={(e) => setDeadlineFilter(e.target.value as DeadlineFilterOption)}
                    className="appearance-none bg-slate-800/80 border border-white/10 rounded-md text-[10px] text-slate-300 pl-5 pr-4 py-1 focus:outline-none focus:border-cyan-500/50 cursor-pointer hover:bg-slate-700/80 transition-colors"
                    aria-label="Filter projects by deadline"
                  >
                    <option value="Due Today">Due Today</option>
                    <option value="Due in 1 Day">Due in 1 Day</option>
                    <option value="Due in 3 Days">Due in 3 Days</option>
                  </select>
                </div>
                <button onClick={() => onNavigate('projects')} className="text-[10px] text-cyan-400 hover:underline font-mono flex items-center gap-0.5">All <ArrowUpRight size={10} /></button>
              </div>
            </div>
            {filteredProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Inbox size={32} className="text-slate-600 mb-2" />
                <p className="text-[11px] text-slate-500">No projects match the selected deadline filter.</p>
                <button onClick={() => onNavigate('projects')} className="mt-2 text-[10px] text-cyan-400 hover:underline font-mono">View all projects</button>
              </div>
            ) : (
            <div className="overflow-y-auto pr-1 space-y-2 max-h-[210px]">
                {filteredProjects.map((p) => (
                  <div key={p.id} onClick={() => onNavigate('projects', p.id)} className="p-3 rounded-xl bg-slate-900/50 border border-white/10 hover:border-cyan-500/30 cursor-pointer transition-all group">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold text-white truncate group-hover:text-cyan-300 transition-colors">{p.title}</span>
                      <span className="text-[9px] font-mono text-slate-500 shrink-0 ml-2">{p.code}</span>
                    </div>
                    <div className="flex items-center gap-3 text-[10px] text-slate-400">
                      <span className="flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${PROJECT_STATUS_DOT[p.status] || 'bg-slate-400'}`} />{p.status}</span>
                      <span className="flex items-center gap-1"><Users size={10} />{p.memberIds.length}</span>
                      {p.targetDate && <span className="font-mono text-[9px]">{p.targetDate}</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all" style={{ width: `${p.progress}%` }} /></div>
                      <span className="text-[9px] text-slate-500 font-mono shrink-0">{p.progress}%</span>
                    </div>
                </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
