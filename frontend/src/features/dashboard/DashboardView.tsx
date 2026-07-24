import React from 'react';
import { useApp } from '../../store/AppContext';
import { GlassCard } from '../../components/common/GlassCard';
import { StatusBadge } from '../../components/common/StatusBadge';
import {
  FolderKanban,
  CheckSquare,
  Clock,
  CheckCircle2,
  AlertCircle,
  Plus,
  Play,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  UserCheck,
  FileCheck2,
  Calendar,
  Activity,
  ChevronRight
} from 'lucide-react';

interface DashboardViewProps {
  onNavigate: (tab: string, filterId?: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ onNavigate }) => {
  const {
    currentRole,
    currentUser,
    projects,
    tasks,
    attendanceRecords,
    systemApprovals,
    hrRequests,
    activityLogs,
    calendarEvents,
    checkIn,
    checkOut,
    activeBreak,
    startBreak,
    endBreak
  } = useApp();

  const activeProjects = projects.filter((p) => p.status === 'Active');
  const pendingProjects = projects.filter((p) => p.approvalStatus === 'Pending Approval');
  const myTasks = tasks.filter((t) => t.assigneeId === currentUser.id);
  const overdueTasks = tasks.filter((t) => t.status !== 'Done' && new Date(t.dueDate) < new Date());
  const pendingApprovals = systemApprovals.filter((sa) => sa.status === 'Pending');
  const pendingHrRequests = hrRequests.filter((r) => r.status === 'Pending');

  const todayStr = new Date().toISOString().split('T')[0];
  const myTodayAttendance = attendanceRecords.find((a) => a.userId === currentUser.id && a.date === todayStr);

  return (
    <div className="space-y-6">
      {/* Role Banner Greeting */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-6 glass-panel-glow border-cyan-500/30">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30">
              ACTIVE ROLE: {currentRole.replace('_', ' ')}
            </span>
            <span className="text-xs text-slate-400 font-mono">• {currentUser.department}</span>
          </div>
          <h1 className="text-2xl font-extrabold text-white">
            Welcome back, <span className="text-gradient-neon">{currentUser.name}</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            {currentRole === 'Manager' && 'System Oversight Active: 1 pending project, 1 task creation, and 1 controlled edit requiring decision.'}
            {currentRole === 'Team_Lead' && 'Team Operations Active: Manage projects, approve controlled field edits, and track milestones.'}
            {currentRole === 'HR' && 'People Operations Active: 3 attendance corrections and leave exceptions waiting in your HR queue.'}
            {currentRole === 'Team_Member' && 'My Workstation Active: Track assigned tasks, log attendance/breaks, and craft AI PR templates.'}
          </p>
        </div>

        {/* Quick Action Button Bar */}
        <div className="flex flex-wrap items-center gap-2">
          {(currentRole === 'Manager' || currentRole === 'Team_Lead') && (
            <button
              onClick={() => onNavigate('projects')}
              className="px-3 py-2 rounded-xl glass-button-neon text-xs font-semibold flex items-center gap-1.5 shadow"
            >
              <Plus size={14} />
              <span>New Project</span>
            </button>
          )}

          <button
            onClick={() => onNavigate('tasks')}
            className="px-3 py-2 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            <Plus size={14} />
            <span>New Task</span>
          </button>

          <button
            onClick={() => onNavigate('ai-assistant')}
            className="px-3 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-semibold flex items-center gap-1.5 transition-all"
          >
            <Sparkles size={14} />
            <span>AI Assistant</span>
          </button>
        </div>
      </div>

      {/* Role-Sensitive Metric Cards (Clickable) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <GlassCard onClick={() => onNavigate('projects')} glowColor="cyan">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-slate-400">Active Projects</span>
            <div className="p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
              <FolderKanban size={18} />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{activeProjects.length}</div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            {pendingProjects.length > 0 ? (
              <span className="text-amber-400 font-mono">
                {pendingProjects.length} Pending Approval
              </span>
            ) : (
              <span>All projects approved</span>
            )}
          </div>
        </GlassCard>

        <GlassCard onClick={() => onNavigate('tasks')} glowColor="violet">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-slate-400">My Assigned Tasks</span>
            <div className="p-2 rounded-lg bg-purple-500/20 text-purple-400">
              <CheckSquare size={18} />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{myTasks.length}</div>
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <span className="text-purple-300">
              {myTasks.filter((t) => t.status === 'In Progress').length} In Progress
            </span>
          </div>
        </GlassCard>

        {currentRole === 'HR' ? (
          <GlassCard onClick={() => onNavigate('attendance')} glowColor="emerald">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono text-slate-400">HR Pending Queue</span>
              <div className="p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                <FileCheck2 size={18} />
              </div>
            </div>
            <div className="text-2xl font-bold text-white mb-1">{pendingHrRequests.length}</div>
            <div className="text-[11px] text-emerald-400 font-mono">
              Attendance, Leave & Breaks
            </div>
          </GlassCard>
        ) : (
          <GlassCard onClick={() => onNavigate('approvals')} glowColor="amber">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-mono text-slate-400">Pending Approvals</span>
              <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400">
                <CheckCircle2 size={18} />
              </div>
            </div>
            <div className="text-2xl font-bold text-white mb-1">{pendingApprovals.length}</div>
            <div className="text-[11px] text-amber-300 font-mono">
              Controlled edits & proposals
            </div>
          </GlassCard>
        )}

        <GlassCard onClick={() => onNavigate('attendance')} glowColor="magenta">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-mono text-slate-400">Today Attendance</span>
            <div className="p-2 rounded-lg bg-pink-500/20 text-pink-400">
              <Clock size={18} />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">
            {myTodayAttendance ? myTodayAttendance.checkIn : 'Not Checked In'}
          </div>
          <div className="text-[11px] text-slate-400">
            {activeBreak?.isBreaking ? (
              <span className="text-amber-400 font-mono animate-pulse">
                On {activeBreak.breakType} ({Math.floor(activeBreak.elapsedSeconds / 60)}m)
              </span>
            ) : myTodayAttendance ? (
              <span className="text-emerald-400">Checked in • {myTodayAttendance.status}</span>
            ) : (
              <span>Click to clock in</span>
            )}
          </div>
        </GlassCard>
      </div>

      {/* Main Grid Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Pending Queues & Recent Activity */}
        <div className="lg:col-span-8 space-y-6">
          {/* HR Pending Queue View (if HR role) */}
          {currentRole === 'HR' && (
            <div className="glass-panel p-5 border border-emerald-500/30">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <FileCheck2 size={18} className="text-emerald-400" />
                  <h3 className="font-bold text-sm text-white">HR Review Queue (Attendance, Leave & Breaks)</h3>
                </div>
                <button
                  onClick={() => onNavigate('attendance')}
                  className="text-xs text-emerald-400 hover:underline flex items-center gap-1 font-mono"
                >
                  View All ({pendingHrRequests.length}) <ChevronRight size={14} />
                </button>
              </div>

              <div className="space-y-3">
                {pendingHrRequests.slice(0, 3).map((req) => (
                  <div
                    key={req.id}
                    className="p-3.5 rounded-xl bg-slate-900/50 border border-emerald-500/20 flex items-start justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <StatusBadge status={req.type.replace('_', ' ')} size="sm" />
                        <span className="text-xs font-bold text-slate-200">{req.userId === 'usr-5' ? 'Liam Gallagher' : 'Team Member'}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{req.submittedAt}</span>
                      </div>
                      <p className="text-xs text-slate-300 mt-1 font-sans">"{req.reason}"</p>
                      {req.details.requestedCheckIn && (
                        <span className="text-[10px] font-mono text-cyan-300 block mt-1">
                          Requested Clock: {req.details.requestedCheckIn} – {req.details.requestedCheckOut}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => onNavigate('attendance')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-xs font-semibold shrink-0"
                    >
                      Review
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Manager & Team Lead Pending Approvals Queue */}
          {(currentRole === 'Manager' || currentRole === 'Team_Lead') && (
            <div className="glass-panel p-5 border border-amber-500/30">
              <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  <ShieldCheck size={18} className="text-amber-400" />
                  <h3 className="font-bold text-sm text-white">Approvals Inbox ({pendingApprovals.length})</h3>
                </div>
                <button
                  onClick={() => onNavigate('approvals')}
                  className="text-xs text-amber-400 hover:underline flex items-center gap-1 font-mono"
                >
                  Manage Approvals <ChevronRight size={14} />
                </button>
              </div>

              <div className="space-y-3">
                {pendingApprovals.slice(0, 3).map((app) => (
                  <div
                    key={app.id}
                    className="p-3.5 rounded-xl bg-slate-900/50 border border-amber-500/20 flex items-start justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px] font-mono font-bold">
                          {app.type.replace('_', ' ')}
                        </span>
                        <span className="text-xs font-bold text-white">{app.targetTitle}</span>
                      </div>
                      <p className="text-xs text-slate-300 line-clamp-1">{app.details}</p>
                    </div>
                    <button
                      onClick={() => onNavigate('approvals')}
                      className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold shrink-0"
                    >
                      Decide
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Activity Feed */}
          <div className="glass-panel p-5">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Activity size={18} className="text-cyan-400" />
                <h3 className="font-bold text-sm text-white">Recent System Activity</h3>
              </div>
              <button
                onClick={() => onNavigate('activity')}
                className="text-xs text-cyan-400 hover:underline flex items-center gap-1 font-mono"
              >
                Full Audit Log <ChevronRight size={14} />
              </button>
            </div>

            <div className="space-y-3">
              {activityLogs.slice(0, 5).map((log) => (
                <div
                  key={log.id}
                  className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-start justify-between gap-3 text-xs"
                >
                  <div className="flex items-start gap-2.5">
                    <img
                      src={log.userAvatar}
                      alt={log.userName}
                      className="w-7 h-7 rounded-lg object-cover ring-1 ring-white/10 shrink-0"
                    />
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-white">{log.userName}</span>
                        <span className="text-slate-400">{log.action}</span>
                      </div>
                      <span className="text-[11px] text-cyan-300 font-mono block mt-0.5">{log.targetTitle}</span>

                      {log.diff && (
                        <div className="mt-1.5 p-1.5 rounded bg-black/40 font-mono text-[10px] text-slate-300 flex items-center gap-2 border border-white/5">
                          <span className="text-rose-400 line-through">{log.diff.oldVal}</span>
                          <span>→</span>
                          <span className="text-emerald-400">{log.diff.newVal}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono shrink-0">{log.timestamp}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Today Attendance Control & Deadlines */}
        <div className="lg:col-span-4 space-y-6">
          {/* Attendance & Multi-Break Control Card */}
          <div className="glass-panel p-5 border border-cyan-500/30 space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <Clock size={18} className="text-cyan-400" />
                <h3 className="font-bold text-sm text-white">Attendance & Breaks</h3>
              </div>
              <span className="text-[11px] font-mono text-cyan-300">{todayStr}</span>
            </div>

            <div className="p-3 rounded-xl bg-slate-900/60 border border-white/10 text-center space-y-2">
              <span className="text-xs text-slate-400 block font-mono">Status for Today</span>
              <div className="text-lg font-bold text-white">
                {myTodayAttendance ? (
                  <span className="text-emerald-400 flex items-center justify-center gap-1.5">
                    <CheckCircle2 size={18} /> Clocked In ({myTodayAttendance.checkIn})
                  </span>
                ) : (
                  <span className="text-amber-400">Not Clocked In Yet</span>
                )}
              </div>

              {!myTodayAttendance ? (
                <button
                  onClick={checkIn}
                  className="w-full py-2.5 rounded-xl glass-button-neon text-xs font-bold flex items-center justify-center gap-2 shadow"
                >
                  <Play size={14} />
                  <span>Clock In Now</span>
                </button>
              ) : (
                <div className="space-y-2 pt-1">
                  {/* Multi-Break Toggle */}
                  {!activeBreak?.isBreaking ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => startBreak('Lunch')}
                        className="py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-semibold"
                      >
                        Start Lunch
                      </button>
                      <button
                        onClick={() => startBreak('Short Break')}
                        className="py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-semibold"
                      >
                        Start Short Break
                      </button>
                    </div>
                  ) : (
                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-center space-y-2">
                      <div className="text-xs font-mono text-amber-300 font-bold">
                        ACTIVE BREAK: {activeBreak.breakType}
                      </div>
                      <div className="text-xl font-mono text-white font-bold animate-pulse">
                        {Math.floor(activeBreak.elapsedSeconds / 60)}m {activeBreak.elapsedSeconds % 60}s
                      </div>
                      <button
                        onClick={endBreak}
                        className="w-full py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold"
                      >
                        End Break & Log
                      </button>
                    </div>
                  )}

                  {!myTodayAttendance.checkOut && (
                    <button
                      onClick={checkOut}
                      className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-white/10"
                    >
                      Clock Out
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Upcoming Deadlines */}
          <div className="glass-panel p-5">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2">
                <Calendar size={18} className="text-purple-400" />
                <h3 className="font-bold text-sm text-white">Upcoming Milestones</h3>
              </div>
              <button
                onClick={() => onNavigate('calendar')}
                className="text-xs text-purple-400 hover:underline font-mono"
              >
                Calendar
              </button>
            </div>

            <div className="space-y-2.5">
              {calendarEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="p-3 rounded-xl bg-slate-900/40 border border-white/5 flex items-center justify-between text-xs"
                >
                  <div>
                    <span className="font-bold text-slate-200 block">{ev.title}</span>
                    <span className="text-[10px] text-purple-300 font-mono">{ev.date} {ev.time ? `• ${ev.time}` : ''}</span>
                  </div>
                  <StatusBadge status={ev.type} size="sm" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
