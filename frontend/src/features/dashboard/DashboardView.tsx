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
    <div className="space-y-3 sm:space-y-4 md:space-y-6">
      {/* Role Banner Greeting */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-2 sm:gap-3 md:gap-4 p-3 sm:p-4 md:p-6 glass-panel-glow border-cyan-500/30">
        <div className="min-w-0 flex-1 w-full">
          <div className="flex flex-wrap items-center gap-1 sm:gap-1.5 md:gap-2 mb-0.5 sm:mb-1">
            <span className="text-[9px] sm:text-[10px] md:text-xs font-mono text-cyan-400 bg-cyan-500/10 px-1 sm:px-1.5 md:px-2 py-0.5 rounded border border-cyan-500/30 whitespace-nowrap">
              {currentRole.replace('_', ' ')}
            </span>
            <span className="text-[9px] sm:text-[10px] md:text-xs text-slate-400 font-mono truncate max-w-[120px] sm:max-w-[200px]">• {currentUser.department}</span>
          </div>
          <h1 className="text-base sm:text-lg md:text-xl lg:text-2xl font-extrabold text-white break-words">
            Welcome back, <span className="text-gradient-neon">{currentUser.name.split(' ')[0]}</span>
          </h1>
          <p className="text-[10px] sm:text-[11px] md:text-xs text-slate-400 mt-0.5 hidden sm:block">
            {currentRole === 'Admin' && 'System Oversight Active: Pending projects, tasks & edits requiring decisions.'}
            {currentRole === 'Team_Lead' && 'Team Operations Active: Manage projects, approvals & milestones.'}
            {currentRole === 'HR' && 'People Operations Active: Attendance corrections & leave exceptions in queue.'}
            {currentRole === 'Team_Member' && 'My Workstation Active: Track tasks, attendance & AI tools.'}
          </p>
        </div>

        {/* Quick Action Button Bar */}
        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0 w-full md:w-auto">
          {(currentRole === 'Admin' || currentRole === 'Team_Lead') && (
            <button
              onClick={() => onNavigate('projects')}
              className="flex-1 md:flex-none px-2 sm:px-2.5 md:px-3 py-1.5 sm:py-2 rounded-xl glass-button-neon text-[10px] sm:text-[11px] md:text-xs font-semibold flex items-center justify-center gap-1 shadow"
            >
              <Plus size={12} />
              <span>Project</span>
            </button>
          )}

          <button
            onClick={() => onNavigate('tasks')}
            className="flex-1 md:flex-none px-2 sm:px-2.5 md:px-3 py-1.5 sm:py-2 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-[10px] sm:text-[11px] md:text-xs font-semibold flex items-center justify-center gap-1 transition-all"
          >
            <Plus size={12} />
            <span>Task</span>
          </button>

          <button
            onClick={() => onNavigate('ai-assistant')}
            className="flex-1 md:flex-none px-2 sm:px-2.5 md:px-3 py-1.5 sm:py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-[10px] sm:text-[11px] md:text-xs font-semibold flex items-center justify-center gap-1 transition-all"
          >
            <Sparkles size={12} />
            <span>AI</span>
          </button>
        </div>
      </div>

      {/* Role-Sensitive Metric Cards (Clickable) */}
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 md:gap-4">
        <GlassCard onClick={() => onNavigate('projects')} glowColor="cyan">
          <div className="flex items-center justify-between mb-1 sm:mb-2 md:mb-3">
            <span className="text-[10px] sm:text-xs font-mono text-slate-400">Active Projects</span>
            <div className="p-1 sm:p-1.5 md:p-2 rounded-lg bg-cyan-500/20 text-cyan-400">
              <FolderKanban size={14} />
            </div>
          </div>
          <div className="text-lg sm:text-xl md:text-2xl font-bold text-white mb-0.5 sm:mb-1">{activeProjects.length}</div>
          <div className="flex items-center gap-1 sm:gap-2 text-[9px] sm:text-[10px] md:text-[11px] text-slate-400">
            {pendingProjects.length > 0 ? (
              <span className="text-amber-400 font-mono truncate">
                {pendingProjects.length} Pending
              </span>
            ) : (
              <span className="truncate">All approved</span>
            )}
          </div>
        </GlassCard>

        <GlassCard onClick={() => onNavigate('tasks')} glowColor="violet">
          <div className="flex items-center justify-between mb-1 sm:mb-2 md:mb-3">
            <span className="text-[10px] sm:text-xs font-mono text-slate-400">My Tasks</span>
            <div className="p-1 sm:p-1.5 md:p-2 rounded-lg bg-purple-500/20 text-purple-400">
              <CheckSquare size={14} />
            </div>
          </div>
          <div className="text-lg sm:text-xl md:text-2xl font-bold text-white mb-0.5 sm:mb-1">{myTasks.length}</div>
          <div className="flex items-center gap-1 sm:gap-2 text-[9px] sm:text-[10px] md:text-[11px] text-slate-400">
            <span className="text-purple-300 truncate">
              {myTasks.filter((t) => t.status === 'In Progress').length} Active
            </span>
          </div>
        </GlassCard>

        {currentRole === 'HR' ? (
          <GlassCard onClick={() => onNavigate('attendance')} glowColor="emerald">
            <div className="flex items-center justify-between mb-1 sm:mb-2 md:mb-3">
              <span className="text-[10px] sm:text-xs font-mono text-slate-400">HR Queue</span>
              <div className="p-1 sm:p-1.5 md:p-2 rounded-lg bg-emerald-500/20 text-emerald-400">
                <FileCheck2 size={14} />
              </div>
            </div>
            <div className="text-lg sm:text-xl md:text-2xl font-bold text-white mb-0.5 sm:mb-1">{pendingHrRequests.length}</div>
            <div className="text-[9px] sm:text-[10px] md:text-[11px] text-emerald-400 font-mono truncate">
              Attendance & Leaves
            </div>
          </GlassCard>
        ) : (
          <GlassCard onClick={() => onNavigate('approvals')} glowColor="amber">
            <div className="flex items-center justify-between mb-1 sm:mb-2 md:mb-3">
              <span className="text-[10px] sm:text-xs font-mono text-slate-400">Approvals</span>
              <div className="p-1 sm:p-1.5 md:p-2 rounded-lg bg-amber-500/20 text-amber-400">
                <CheckCircle2 size={14} />
              </div>
            </div>
            <div className="text-lg sm:text-xl md:text-2xl font-bold text-white mb-0.5 sm:mb-1">{pendingApprovals.length}</div>
            <div className="text-[9px] sm:text-[10px] md:text-[11px] text-amber-300 font-mono truncate">
              Edits & proposals
            </div>
          </GlassCard>
        )}

        <GlassCard onClick={() => onNavigate('attendance')} glowColor="magenta">
          <div className="flex items-center justify-between mb-1 sm:mb-2 md:mb-3">
            <span className="text-[10px] sm:text-xs font-mono text-slate-400">Today</span>
            <div className="p-1 sm:p-1.5 md:p-2 rounded-lg bg-pink-500/20 text-pink-400">
              <Clock size={14} />
            </div>
          </div>
          <div className="text-sm sm:text-base md:text-lg lg:text-2xl font-bold text-white mb-0.5 sm:mb-1 truncate">
            {myTodayAttendance ? myTodayAttendance.checkIn : 'No check-in'}
          </div>
          <div className="text-[9px] sm:text-[10px] md:text-[11px] text-slate-400 truncate">
            {activeBreak?.isBreaking ? (
              <span className="text-amber-400 font-mono animate-pulse">
                On {activeBreak.breakType} ({Math.floor(activeBreak.elapsedSeconds / 60)}m)
              </span>
            ) : myTodayAttendance ? (
              <span className="text-emerald-400">Checked in</span>
            ) : (
              <span>Tap to clock in</span>
            )}
          </div>
        </GlassCard>
      </div>

      {/* Main Grid Section */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 sm:gap-4 md:gap-6">
        {/* Left Column: Pending Queues & Recent Activity */}
        <div className="lg:col-span-12 xl:col-span-8 space-y-3 sm:space-y-4 md:space-y-6">
          {/* HR Pending Queue View (if HR role) */}
          {currentRole === 'HR' && (
            <div className="glass-panel p-3 sm:p-4 md:p-5 border border-emerald-500/30">
              <div className="flex items-center justify-between mb-3 sm:mb-4 pb-2 sm:pb-3 border-b border-white/10">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <FileCheck2 size={14} className="text-emerald-400 shrink-0" />
                  <h3 className="font-bold text-[11px] sm:text-xs md:text-sm text-white truncate">HR Review Queue</h3>
                </div>
                <button
                  onClick={() => onNavigate('attendance')}
                  className="text-[10px] sm:text-xs text-emerald-400 hover:underline flex items-center gap-1 font-mono shrink-0"
                >
                  <span className="hidden sm:inline">View All ({pendingHrRequests.length})</span>
                  <span className="sm:hidden">({pendingHrRequests.length})</span>
                  <ChevronRight size={12} />
                </button>
              </div>

              <div className="space-y-2 sm:space-y-3">
                {pendingHrRequests.slice(0, 3).map((req) => (
                  <div
                    key={req.id}
                    className="p-2.5 sm:p-3 md:p-3.5 rounded-xl bg-slate-900/50 border border-emerald-500/20 flex items-start justify-between gap-2 sm:gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 sm:gap-2 mb-0.5 sm:mb-1 flex-wrap">
                        <StatusBadge status={req.type.replace('_', ' ')} size="sm" />
                        <span className="text-[10px] sm:text-xs font-bold text-slate-200 truncate">{req.userId === 'usr-5' ? 'Liam Gallagher' : 'Team Member'}</span>
                        <span className="text-[8px] sm:text-[10px] text-slate-400 font-mono">{req.submittedAt}</span>
                      </div>
                      <p className="text-[10px] sm:text-xs text-slate-300 mt-0.5 sm:mt-1 font-sans line-clamp-1">"{req.reason}"</p>
                      {req.details.requestedCheckIn && (
                        <span className="text-[8px] sm:text-[10px] font-mono text-cyan-300 block mt-0.5 sm:mt-1 truncate">
                          {req.details.requestedCheckIn} – {req.details.requestedCheckOut}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => onNavigate('attendance')}
                      className="px-2 sm:px-2.5 md:px-3 py-1 sm:py-1.5 rounded-lg bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 text-[10px] sm:text-xs font-semibold shrink-0"
                    >
                      Review
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Admin & Team Lead Pending Approvals Queue */}
          {(currentRole === 'Admin' || currentRole === 'Team_Lead') && (
            <div className="glass-panel p-3 sm:p-4 md:p-5 border border-amber-500/30">
              <div className="flex items-center justify-between mb-3 sm:mb-4 pb-2 sm:pb-3 border-b border-white/10">
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                  <ShieldCheck size={14} className="text-amber-400 shrink-0" />
                  <h3 className="font-bold text-[11px] sm:text-xs md:text-sm text-white truncate">Approvals Inbox ({pendingApprovals.length})</h3>
                </div>
                <button
                  onClick={() => onNavigate('approvals')}
                  className="text-[10px] sm:text-xs text-amber-400 hover:underline flex items-center gap-1 font-mono shrink-0"
                >
                  <span className="hidden sm:inline">Manage</span>
                  <ChevronRight size={12} />
                </button>
              </div>

              <div className="space-y-2 sm:space-y-3">
                {pendingApprovals.slice(0, 3).map((app) => (
                  <div
                    key={app.id}
                    className="p-2.5 sm:p-3 md:p-3.5 rounded-xl bg-slate-900/50 border border-amber-500/20 flex items-start justify-between gap-2 sm:gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 sm:gap-2 mb-0.5 sm:mb-1 flex-wrap">
                        <span className="px-1.5 sm:px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[8px] sm:text-[10px] font-mono font-bold">
                          {app.type.replace('_', ' ')}
                        </span>
                        <span className="text-[10px] sm:text-xs font-bold text-white truncate">{app.targetTitle}</span>
                      </div>
                      <p className="text-[10px] sm:text-xs text-slate-300 line-clamp-1">{app.details}</p>
                    </div>
                    <button
                      onClick={() => onNavigate('approvals')}
                      className="px-2 sm:px-2.5 md:px-3 py-1 sm:py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] sm:text-xs font-semibold shrink-0"
                    >
                      Decide
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recent Activity Feed */}
          <div className="glass-panel p-3 sm:p-4 md:p-5">
            <div className="flex items-center justify-between mb-3 sm:mb-4 pb-2 sm:pb-3 border-b border-white/10">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <Activity size={14} className="text-cyan-400" />
                <h3 className="font-bold text-[11px] sm:text-xs md:text-sm text-white">Recent Activity</h3>
              </div>
              <button
                onClick={() => onNavigate('activity')}
                className="text-[10px] sm:text-xs text-cyan-400 hover:underline flex items-center gap-1 font-mono"
              >
                <span className="hidden sm:inline">Full Audit Log</span>
                <span className="sm:hidden">Audit</span>
                <ChevronRight size={12} />
              </button>
            </div>

            <div className="space-y-2 sm:space-y-3">
              {activityLogs.slice(0, 5).map((log) => (
                <div
                  key={log.id}
                  className="p-2 sm:p-2.5 md:p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-start justify-between gap-2 sm:gap-3 text-[10px] sm:text-xs"
                >
                  <div className="flex items-start gap-1.5 sm:gap-2 min-w-0 flex-1">
                    <img
                      src={log.userAvatar}
                      alt={log.userName}
                      className="w-5 h-5 sm:w-6 sm:h-7 rounded-lg object-cover ring-1 ring-white/10 shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
                        <span className="font-bold text-white text-[10px] sm:text-xs">{log.userName}</span>
                        <span className="text-slate-400 text-[9px] sm:text-[10px]">{log.action}</span>
                      </div>
                      <span className="text-[9px] sm:text-[10px] md:text-[11px] text-cyan-300 font-mono block mt-0.5 truncate">{log.targetTitle}</span>

                      {log.diff && (
                        <div className="mt-1 sm:mt-1.5 p-1 sm:p-1.5 rounded bg-black/40 font-mono text-[8px] sm:text-[10px] text-slate-300 flex items-center gap-1 sm:gap-2 border border-white/5 flex-wrap">
                          <span className="text-rose-400 line-through truncate max-w-[80px] sm:max-w-none">{log.diff.oldVal}</span>
                          <span>→</span>
                          <span className="text-emerald-400 truncate max-w-[80px] sm:max-w-none">{log.diff.newVal}</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-[8px] sm:text-[10px] text-slate-500 font-mono shrink-0">{log.timestamp}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Today Attendance Control & Deadlines */}
        <div className="lg:col-span-12 xl:col-span-4 space-y-3 sm:space-y-4 md:space-y-6">
          {/* Attendance & Multi-Break Control Card */}
          <div className="glass-panel p-3 sm:p-4 md:p-5 border border-cyan-500/30 space-y-3 sm:space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-2 sm:pb-3">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <Clock size={14} className="text-cyan-400" />
                <h3 className="font-bold text-[11px] sm:text-xs md:text-sm text-white">Attendance</h3>
              </div>
              <span className="text-[9px] sm:text-[10px] md:text-[11px] font-mono text-cyan-300">{todayStr}</span>
            </div>

            <div className="p-2 sm:p-2.5 md:p-3 rounded-xl bg-slate-900/60 border border-white/10 text-center space-y-1.5 sm:space-y-2">
              <span className="text-[9px] sm:text-[10px] md:text-xs text-slate-400 block font-mono">Status for Today</span>
              <div className="text-sm sm:text-base md:text-lg font-bold text-white">
                {myTodayAttendance ? (
                  <span className="text-emerald-400 flex items-center justify-center gap-1 sm:gap-1.5 text-xs sm:text-sm md:text-base">
                    <CheckCircle2 size={14} /> {myTodayAttendance.checkIn}
                  </span>
                ) : (
                  <span className="text-amber-400 text-xs sm:text-sm">Not Clocked In</span>
                )}
              </div>

              {!myTodayAttendance ? (
                <button
                  onClick={checkIn}
                  className="w-full py-1.5 sm:py-2 md:py-2.5 rounded-xl glass-button-neon text-[10px] sm:text-xs font-bold flex items-center justify-center gap-1 sm:gap-2 shadow"
                >
                  <Play size={12} />
                  <span>Clock In Now</span>
                </button>
              ) : (
                <div className="space-y-1.5 sm:space-y-2 pt-0.5 sm:pt-1">
                  {/* Multi-Break Toggle */}
                  {!activeBreak?.isBreaking ? (
                    <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
                      <button
                        onClick={() => startBreak('Lunch')}
                        className="py-1 sm:py-1.5 md:py-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-[10px] sm:text-xs font-semibold"
                      >
                        Lunch
                      </button>
                      <button
                        onClick={() => startBreak('Short Break')}
                        className="py-1 sm:py-1.5 md:py-2 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-[10px] sm:text-xs font-semibold"
                      >
                        Short Break
                      </button>
                    </div>
                  ) : (
                    <div className="p-2 sm:p-2.5 md:p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-center space-y-1 sm:space-y-2">
                      <div className="text-[10px] sm:text-xs font-mono text-amber-300 font-bold">
                        {activeBreak.breakType}
                      </div>
                      <div className="text-base sm:text-lg md:text-xl font-mono text-white font-bold animate-pulse">
                        {Math.floor(activeBreak.elapsedSeconds / 60)}m {activeBreak.elapsedSeconds % 60}s
                      </div>
                      <button
                        onClick={endBreak}
                        className="w-full py-1 sm:py-1.5 md:py-2 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-[10px] sm:text-xs font-bold"
                      >
                        End Break
                      </button>
                    </div>
                  )}

                  {!myTodayAttendance.checkOut && (
                    <button
                      onClick={checkOut}
                      className="w-full py-1 sm:py-1.5 md:py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] sm:text-xs font-semibold border border-white/10"
                    >
                      Clock Out
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Upcoming Deadlines */}
          <div className="glass-panel p-3 sm:p-4 md:p-5">
            <div className="flex items-center justify-between mb-2 sm:mb-3 md:mb-4 pb-2 sm:pb-3 border-b border-white/10">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <Calendar size={14} className="text-purple-400" />
                <h3 className="font-bold text-[11px] sm:text-xs md:text-sm text-white">Upcoming Milestones</h3>
              </div>
              <button
                onClick={() => onNavigate('calendar')}
                className="text-[10px] sm:text-xs text-purple-400 hover:underline font-mono"
              >
                Calendar
              </button>
            </div>

            <div className="space-y-1.5 sm:space-y-2 md:space-y-2.5">
              {calendarEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="p-2 sm:p-2.5 md:p-3 rounded-xl bg-slate-900/40 border border-white/5 flex items-center justify-between gap-2 text-[10px] sm:text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <span className="font-bold text-slate-200 block truncate text-[10px] sm:text-xs">{ev.title}</span>
                    <span className="text-[8px] sm:text-[10px] text-purple-300 font-mono">{ev.date} {ev.time ? `• ${ev.time}` : ''}</span>
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
