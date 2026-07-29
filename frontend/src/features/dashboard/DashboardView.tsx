import React, { useMemo, useCallback } from 'react';
import { useApp } from '../../store/AppContext';
import { GlassCard } from '../../components/common/GlassCard';
import { StatusBadge } from '../../components/common/StatusBadge';
import { TaskPriority, TaskStatus, Task } from '../../types';
import {
  FolderKanban,
  CheckSquare,
  Clock,
  Play,
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
} from 'lucide-react';

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
  deadlines: { date: string; label: string }[];
}

const MiniCalendar: React.FC<MiniCalendarProps> = ({ deadlines }) => {
  const [viewDate, setViewDate] = React.useState(new Date());
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const firstDay = new Date(viewDate.getFullYear(), viewDate.getMonth(), 1);
  const lastDay = new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 0);
  const startPad = firstDay.getDay();

  const deadlineMap = useMemo(() => {
    const map = new Map<string, { labels: string[]; types: Set<string> }>();
    deadlines.forEach((d) => {
      const key = d.date;
      if (!map.has(key)) map.set(key, { labels: [], types: new Set() });
      const entry = map.get(key)!;
      entry.labels.push(d.label);
      entry.types.add(d.label.startsWith('Project') ? 'project' : 'task');
    });
    return map;
  }, [deadlines]);

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
          const entry = deadlineMap.get(dateStr);
          const isToday = day === today.getDate() && viewDate.getMonth() === today.getMonth() && viewDate.getFullYear() === today.getFullYear();
          const hasProject = entry?.types.has('project');
          const hasTask = entry?.types.has('task');
          return (
            <div key={day} title={entry ? entry.labels.join('\n') : undefined}
              className={`text-[10px] text-center py-0.5 rounded cursor-default relative ${isToday ? 'bg-cyan-500/30 text-cyan-200 font-bold ring-1 ring-cyan-500/50' : entry ? 'text-slate-200 font-semibold' : 'text-slate-500'}`}>
              {day}
              {hasProject && hasTask ? (<><span className="absolute bottom-0.5 left-[30%] -translate-x-1/2 w-1 h-1 rounded-full bg-cyan-400" /><span className="absolute bottom-0.5 left-[70%] -translate-x-1/2 w-1 h-1 rounded-full bg-amber-400" /></>) : hasProject ? (<span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-cyan-400" />) : hasTask ? (<span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-amber-400" />) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const { currentRole, currentUser, projects, tasks, attendanceRecords, systemApprovals, hrRequests, activityLogs, users, checkIn, checkOut, activeBreak, startBreak, endBreak } = useApp();

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  const activeProjects = useMemo(() => projects.filter((p) => p.status !== 'Archived').sort((a, b) => (a.targetDate || '9999').localeCompare(b.targetDate || '9999')), [projects]);
  const isMyTask = useCallback((t: Task) => t.assigneeId === currentUser.id || (t.assigneeIds ?? []).includes(currentUser.id), [currentUser.id]);
  const myTasks = useMemo(() => tasks.filter((t) => isMyTask(t) && t.status !== 'Done').sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')), [tasks, isMyTask]);
  const pendingProjects = useMemo(() => projects.filter((p) => p.approvalStatus === 'Pending Approval'), [projects]);
  const pendingApprovals = useMemo(() => systemApprovals.filter((sa) => sa.status === 'Pending'), [systemApprovals]);
  const pendingHrRequests = useMemo(() => hrRequests.filter((r) => r.status === 'Pending'), [hrRequests]);

  const myTodayAttendance = useMemo(() => attendanceRecords.find((a) => a.userId === currentUser.id && a.date === todayStr), [attendanceRecords, currentUser.id, todayStr]);

  const deadlines = useMemo(() => [
    ...projects.filter((p) => p.status !== 'Archived' && p.targetDate).map((p) => ({ date: p.targetDate, label: `Project: ${p.title}` })),
    ...tasks.filter((t) => t.dueDate && t.status !== 'Done').map((t) => ({ date: t.dueDate, label: `Task: ${t.title}` })),
  ], [projects, tasks]);

  const upcomingDeadlines = useMemo(() => deadlines.filter((d) => d.date >= todayStr).sort((a, b) => a.date.localeCompare(b.date)), [deadlines, todayStr]);
  const sortedActivityLogs = useMemo(() => [...activityLogs].sort((a, b) => b.timestamp.localeCompare(a.timestamp)), [activityLogs]);

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
          {(currentRole === 'Admin' || currentRole === 'Team_Lead') && (<button onClick={() => onNavigate('projects')} className="px-3 py-2 rounded-xl glass-button-neon text-xs font-semibold flex items-center gap-1.5"><Plus size={12} /> Project</button>)}
          <button onClick={() => onNavigate('tasks')} className="px-3 py-2 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"><Plus size={12} /> Task</button>
          <button onClick={() => onNavigate('ai-assistant')} className="px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"><Sparkles size={12} /> AI</button>
        </div>
      </div>

      {/* ── Metric Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
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
        <GlassCard onClick={() => onNavigate('attendance')} glowColor="magenta">
          <div className="flex items-center justify-between mb-2"><span className="text-[10px] font-mono text-slate-400">Today</span><div className="p-1.5 rounded-lg bg-pink-500/20 text-pink-400"><Clock size={14} /></div></div>
          <div className="text-xl font-bold text-white mb-1 truncate">{myTodayAttendance ? (<span className="text-emerald-400">{myTodayAttendance.checkIn}</span>) : (<span className="text-amber-400">Not clocked in</span>)}</div>
          <span className="text-[10px] text-slate-400">{activeBreak?.isBreaking ? `On break (${Math.floor(activeBreak.elapsedSeconds / 60)}m)` : 'Tap to manage'}</span>
        </GlassCard>
      </div>

      {/* ── Row 1 (top): Calendar + Attendance | Activity Log | Approvals ── */}
      <div className="flex flex-wrap gap-3">
        {/* Calendar + Attendance */}
        <div className="flex-1 min-w-[300px] max-w-full">
          <div className="space-y-2.5">
            {/* Calendar */}
            <div className="glass-panel p-3 border border-cyan-500/20 overflow-y-auto">
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
                <div className="flex items-center gap-2"><Calendar size={14} className="text-cyan-400" /><h3 className="font-bold text-xs text-white">Calendar</h3></div>
                <button onClick={() => onNavigate('calendar')} className="text-[10px] text-cyan-400 hover:underline font-mono">Open</button>
              </div>
              <MiniCalendar deadlines={deadlines} />
              {upcomingDeadlines.length > 0 ? (
                <div className="mt-3 space-y-1.5 max-h-[100px] overflow-y-auto pr-1">
                  <span className="text-[9px] font-mono text-slate-500 uppercase">Upcoming</span>
                  {upcomingDeadlines.slice(0, 5).map((d, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] p-1 rounded hover:bg-white/5">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${d.label.startsWith('Project') ? 'bg-cyan-400' : 'bg-amber-400'}`} />
                      <span className="text-slate-400 font-mono w-20 shrink-0">{d.date}</span>
                      <span className="text-slate-300 truncate">{d.label.replace(/^(Project|Task): /, '')}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 text-center">
                  <p className="text-[10px] text-slate-600 font-mono">No upcoming deadlines</p>
                </div>
              )}
            </div>

            {/* Attendance */}
            <div className="glass-panel p-3 border border-pink-500/20 overflow-y-auto">
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
                <div className="flex items-center gap-2"><Clock size={14} className="text-pink-400" /><h3 className="font-bold text-xs text-white">Attendance</h3></div>
                <span className="text-[10px] font-mono text-cyan-300">{todayStr}</span>
              </div>
              <div className="p-3 rounded-xl bg-slate-900/60 border border-white/10 text-center space-y-2">
                <span className="text-[10px] text-slate-400 block font-mono">Status for Today</span>
                <div className="text-lg font-bold text-white">
                  {myTodayAttendance ? (<span className="text-emerald-400 flex items-center justify-center gap-1.5"><CheckCircle2 size={14} /> {myTodayAttendance.checkIn}</span>) : (<span className="text-amber-400">Not Clocked In</span>)}
                </div>
                {!myTodayAttendance ? (
                  <button onClick={checkIn} className="w-full py-2 rounded-xl glass-button-neon text-xs font-bold flex items-center justify-center gap-1.5"><Play size={12} /> Clock In Now</button>
                ) : (
                  <div className="space-y-2 pt-1">
                    {!activeBreak?.isBreaking ? (
                      <div className="grid grid-cols-2 gap-1.5">
                        <button onClick={() => startBreak('Lunch')} className="py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] font-semibold">Lunch</button>
                        <button onClick={() => startBreak('Short Break')} className="py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-[10px] font-semibold">Short Break</button>
                      </div>
                    ) : (
                      <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-center space-y-1">
                        <div className="text-[10px] font-mono text-amber-300 font-bold">{activeBreak.breakType}</div>
                        <div className="text-lg font-mono text-white font-bold animate-pulse">{Math.floor(activeBreak.elapsedSeconds / 60)}m {activeBreak.elapsedSeconds % 60}s</div>
                        <button onClick={endBreak} className="w-full py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[10px] font-bold">End Break</button>
                      </div>
                    )}
                    {!myTodayAttendance.checkOut && (<button onClick={checkOut} className="w-full py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold border border-white/10">Clock Out</button>)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Activity Log */}
        <div className="flex-1 min-w-[300px] max-w-full">
          <div className="glass-panel p-3 border border-purple-500/20">
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
              <div className="flex items-center gap-2"><Activity size={14} className="text-cyan-400" /><h3 className="font-bold text-xs text-white">Activity Log</h3><span className="text-[10px] text-cyan-400 font-mono">({activityLogs.length})</span></div>
              <button onClick={() => onNavigate('activity')} className="text-[10px] text-cyan-400 hover:underline font-mono flex items-center gap-1">Full Log <ChevronRight size={10} /></button>
            </div>
            <div className="overflow-y-auto pr-1 space-y-2 max-h-[210px]">
              {sortedActivityLogs.length === 0 ? (
                <p className="text-[11px] text-slate-500 text-center py-12">No activity recorded yet</p>
              ) : (
                sortedActivityLogs.map((log) => (
                  <div key={log.id} className="p-2.5 rounded-xl bg-slate-900/50 border border-white/5 flex items-start gap-3 text-[10px]">
                    <img src={log.userAvatar} alt={log.userName} className="w-6 h-6 rounded-lg object-cover ring-1 ring-white/10 shrink-0 mt-0.5" />
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
        <div className="flex-1 min-w-[300px] max-w-full flex flex-col gap-2.5">
          {(currentRole === 'Admin' || currentRole === 'Team_Lead') && (
            <div className="glass-panel p-3 border border-amber-500/30 flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
                <div className="flex items-center gap-2"><ShieldCheck size={14} className="text-amber-400" /><h3 className="font-bold text-xs text-white">Approvals Inbox</h3><span className="text-[10px] text-amber-400 font-mono">({pendingApprovals.length})</span></div>
                <button onClick={() => onNavigate('approvals')} className="text-[10px] text-amber-400 hover:underline font-mono flex items-center gap-1">All <ChevronRight size={10} /></button>
              </div>
              {pendingApprovals.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center flex-1">
                  <CheckCircle2 size={28} className="text-slate-600 mb-2" />
                  <p className="text-[11px] text-slate-500">All caught up!</p>
                </div>
              ) : (
                <div className="space-y-2 overflow-y-auto pr-1 max-h-[210px]">
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
            <div className="glass-panel p-3 border border-emerald-500/30 flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
                <div className="flex items-center gap-2"><FileCheck2 size={14} className="text-emerald-400" /><h3 className="font-bold text-xs text-white">HR Queue</h3><span className="text-[10px] text-emerald-400 font-mono">({pendingHrRequests.length})</span></div>
                <button onClick={() => onNavigate('attendance')} className="text-[10px] text-emerald-400 hover:underline font-mono flex items-center gap-1">Manage <ChevronRight size={10} /></button>
              </div>
              {pendingHrRequests.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center flex-1">
                  <CheckCircle2 size={28} className="text-slate-600 mb-2" />
                  <p className="text-[11px] text-slate-500">No pending HR requests</p>
                </div>
              ) : (
                <div className="space-y-2 overflow-y-auto pr-1 max-h-[210px]">
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
            <div className="glass-panel p-3 border border-white/10 flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
                <div className="flex items-center gap-2"><ShieldCheck size={14} className="text-slate-500" /><h3 className="font-bold text-xs text-slate-400">Approvals</h3></div>
              </div>
              <div className="flex flex-col items-center justify-center py-10 text-center flex-1">
                <p className="text-[11px] text-slate-500">No pending approvals</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Row 2 (bottom): Projects ── */}
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[300px] max-w-full">
          <div className="glass-panel p-3 border border-cyan-500/20 h-90 overflow-y-auto flex flex-col">
            <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-2"><FolderKanban size={14} className="text-cyan-400" /><h3 className="font-bold text-xs text-white">Projects</h3><span className="text-[10px] text-cyan-400 font-mono">({activeProjects.length})</span></div>
              <button onClick={() => onNavigate('projects')} className="text-[10px] text-cyan-400 hover:underline font-mono flex items-center gap-0.5">All <ArrowUpRight size={10} /></button>
            </div>
            {activeProjects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Inbox size={32} className="text-slate-600 mb-2" />
                <p className="text-[11px] text-slate-500">No active projects</p>
                <button onClick={() => onNavigate('projects')} className="mt-2 text-[10px] text-cyan-400 hover:underline font-mono">Create a project</button>
              </div>
            ) : (
            <div className="overflow-y-auto pr-1 space-y-2 max-h-[210px]">
                {activeProjects.map((p) => (
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
