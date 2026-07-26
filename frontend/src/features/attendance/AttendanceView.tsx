import React from 'react';
import { useApp } from '../../store/AppContext';
import { GlassCard } from '../../components/common/GlassCard';
import { StatusBadge } from '../../components/common/StatusBadge';
import {
  Clock,
  LogIn,
  LogOut,
  Coffee,
  History,
  CheckCircle2
} from 'lucide-react';

export const AttendanceView: React.FC = () => {
  const {
    currentUser,
    attendanceRecords,
    activeBreak,
    checkIn,
    checkOut,
    startBreak,
    endBreak
  } = useApp();

  const todayStr = new Date().toISOString().split('T')[0];

  const todayAttendance = attendanceRecords.find(
    (record) =>
      record.userId === currentUser.id &&
      record.date === todayStr
  );

  const myAttendanceRecords = attendanceRecords.filter(
    (record) => record.userId === currentUser.id
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="glass-panel-glow p-6 border-cyan-500/30">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 rounded-xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
              <Clock size={24} />
            </div>

            <div>
              <h1 className="text-2xl font-extrabold text-white">
                Attendance & Breaks
              </h1>

              <p className="text-xs text-slate-400 mt-1">
                Manage your daily check-in, check-out and work breaks.
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right">
            <span className="text-xs text-slate-400 font-mono block">
              Current User
            </span>

            <span className="text-sm font-bold text-cyan-300">
              {currentUser.name}
            </span>
          </div>
        </div>
      </div>

      {/* Today's Attendance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GlassCard glowColor="cyan">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h2 className="text-sm font-bold text-white">
                  Today's Attendance
                </h2>

                <p className="text-xs text-cyan-300 font-mono mt-1">
                  {todayStr}
                </p>
              </div>

              <StatusBadge
                status={
                  todayAttendance?.checkOut
                    ? 'Checked Out'
                    : todayAttendance
                      ? 'Checked In'
                      : 'Not Checked In'
                }
                size="sm"
              />
            </div>

            {!todayAttendance ? (
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 text-center">
                  <Clock
                    size={30}
                    className="text-amber-400 mx-auto mb-2"
                  />

                  <p className="text-sm font-bold text-white">
                    You have not checked in today.
                  </p>

                  <p className="text-xs text-slate-400 mt-1">
                    Check in to begin tracking your working time.
                  </p>
                </div>

                <button
                  onClick={checkIn}
                  className="w-full py-3 rounded-xl glass-button-neon text-xs font-bold flex items-center justify-center gap-2"
                >
                  <LogIn size={16} />
                  Check In Now
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
                    <span className="text-[11px] text-slate-400 font-mono block mb-1">
                      Check In
                    </span>

                    <span className="text-lg font-bold text-emerald-300">
                      {todayAttendance.checkIn}
                    </span>
                  </div>

                  <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/30">
                    <span className="text-[11px] text-slate-400 font-mono block mb-1">
                      Check Out
                    </span>

                    <span className="text-lg font-bold text-cyan-300">
                      {todayAttendance.checkOut || 'Working'}
                    </span>
                  </div>
                </div>

                {!todayAttendance.checkOut && (
                  <button
                    onClick={checkOut}
                    className="w-full py-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold flex items-center justify-center gap-2 transition-all"
                  >
                    <LogOut size={16} />
                    Check Out
                  </button>
                )}

                {todayAttendance.checkOut && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-center gap-2">
                    <CheckCircle2 size={16} />
                    Attendance completed for today.
                  </div>
                )}
              </div>
            )}
          </div>
        </GlassCard>

        {/* Break Controls */}
        <GlassCard glowColor="violet">
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-white/10 pb-3">
              <Coffee size={18} className="text-purple-400" />

              <h2 className="text-sm font-bold text-white">
                Break Management
              </h2>
            </div>

            {!todayAttendance ? (
              <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 text-center">
                <p className="text-xs text-slate-400">
                  You must check in before starting a break.
                </p>
              </div>
            ) : todayAttendance.checkOut ? (
              <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 text-center">
                <p className="text-xs text-slate-400">
                  Your attendance session has ended.
                </p>
              </div>
            ) : activeBreak?.isBreaking ? (
              <div className="p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-center space-y-4">
                <div>
                  <span className="text-xs font-mono text-amber-300 font-bold">
                    ACTIVE BREAK
                  </span>

                  <h3 className="text-lg font-bold text-white mt-1">
                    {activeBreak.breakType}
                  </h3>
                </div>

                <div className="text-3xl font-bold font-mono text-white animate-pulse">
                  {Math.floor(activeBreak.elapsedSeconds / 60)}m{' '}
                  {activeBreak.elapsedSeconds % 60}s
                </div>

                <button
                  onClick={endBreak}
                  className="w-full py-3 rounded-xl bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 text-xs font-bold"
                >
                  End Break & Save
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  Select the type of break you want to start.
                </p>

                <button
                  onClick={() => startBreak('Lunch')}
                  className="w-full py-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all"
                >
                  Start Lunch Break
                </button>

                <button
                  onClick={() => startBreak('Short Break')}
                  className="w-full py-3 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 text-xs font-bold transition-all"
                >
                  Start Short Break
                </button>
              </div>
            )}
          </div>
        </GlassCard>
      </div>

      {/* Attendance History */}
      <div className="glass-panel p-5">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/10">
          <History size={18} className="text-cyan-400" />

          <h2 className="text-sm font-bold text-white">
            My Attendance History
          </h2>
        </div>

        <div className="space-y-3">
          {myAttendanceRecords.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-900/50 border border-white/5 text-center">
              <p className="text-xs text-slate-400">
                No attendance records found.
              </p>
            </div>
          ) : (
            myAttendanceRecords.map((record) => (
              <div
                key={record.id}
                className="p-4 rounded-xl bg-slate-900/50 border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div>
                  <span className="text-xs font-bold text-cyan-300 font-mono">
                    {record.date}
                  </span>

                  <div className="flex flex-wrap gap-4 mt-1 text-xs text-slate-300">
                    <span>Check In: {record.checkIn}</span>

                    <span>
                      Check Out: {record.checkOut || 'In Session'}
                    </span>

                    <span>Breaks: {record.breaks.length}</span>
                  </div>
                </div>

                <StatusBadge status={record.status} size="sm" />
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};