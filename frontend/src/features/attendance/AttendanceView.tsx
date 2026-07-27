import React, { useState } from 'react';
import { useApp } from '../../store/AppContext';
import { GlassCard } from '../../components/common/GlassCard';
import { StatusBadge } from '../../components/common/StatusBadge';
import { AttendanceRecord, User, WorkBreak } from '../../types';
import {
  CheckCircle2,
  Clock,
  Coffee,
  History,
  LogIn,
  LogOut,
  Pencil,
  Plus,
  Save,
  Trash2,
  Users
} from 'lucide-react';

const parseTimeInMinutes = (time?: string): number | null => {
  if (!time) return null;
  const match = time.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isFinite(hours) ||
    !Number.isFinite(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return hours * 60 + minutes;
};

const formatDuration = (totalMinutes: number): string => {
  const safeMinutes = Math.max(
    0,
    Math.round(Number.isFinite(totalMinutes) ? totalMinutes : 0)
  );
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
};

const getTotalBreakMinutes = (record: AttendanceRecord): number =>
  (record.breaks || []).reduce((total, workBreak) => {
    const duration = Number(workBreak.durationMinutes);
    return workBreak.endTime && Number.isFinite(duration) && duration >= 0
      ? total + duration
      : total;
  }, 0);

interface AttendanceRowProps {
  record: AttendanceRecord;
  employee?: User;
  todayStr: string;
  canEdit?: boolean;
  onEdit?: (record: AttendanceRecord) => void;
}

const AttendanceRow: React.FC<AttendanceRowProps> = ({
  record,
  employee,
  todayStr,
  canEdit = false,
  onEdit
}) => {
  const totalBreakMinutes = getTotalBreakMinutes(record);
  const checkInMinutes = parseTimeInMinutes(record.checkIn);
  const endMinutes = parseTimeInMinutes(record.checkOut);
  const elapsedMinutes =
    checkInMinutes !== null && endMinutes !== null
      ? endMinutes - checkInMinutes + (endMinutes < checkInMinutes ? 24 * 60 : 0)
      : 0;
  const netWorkingMinutes = Math.max(0, elapsedMinutes - totalBreakMinutes);
  const isToday = record.date === todayStr;
  const checkOutLabel = record.checkOut
    ? record.checkOut
    : isToday
      ? 'In Session'
      : 'Not recorded';
  const netWorkingTimeLabel = record.checkOut
    ? formatDuration(netWorkingMinutes)
    : isToday
      ? 'In Progress'
      : 'Incomplete';

  return (
    <div className="p-4 rounded-xl bg-slate-900/50 border border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
      <div>
        {employee && (
          <span className="text-sm font-bold text-white block mb-1">
            {employee.name}
          </span>
        )}
        <span className="text-xs font-bold text-cyan-300 font-mono">
          {record.date}
        </span>
        <div className="flex flex-wrap gap-4 mt-1 text-xs text-slate-300">
          <span>Check In: {record.checkIn || 'Not recorded'}</span>
          <span>Check Out: {checkOutLabel}</span>
          <span>Breaks: {formatDuration(totalBreakMinutes)}</span>
          <span>Net Working Time: {netWorkingTimeLabel}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <StatusBadge status={record.status} size="sm" />
        {canEdit && onEdit && (
          <button
            type="button"
            onClick={() => onEdit(record)}
            className="px-3 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-bold flex items-center gap-1.5 transition-all"
          >
            <Pencil size={13} />
            Edit Attendance
          </button>
        )}
      </div>
    </div>
  );
};

interface AttendanceHistoryProps {
  title: string;
  records: AttendanceRecord[];
  users: User[];
  todayStr: string;
  showEmployee?: boolean;
  readOnly?: boolean;
  onEdit?: (record: AttendanceRecord) => void;
  icon?: 'history' | 'team';
  emptyMessage: string;
}

const AttendanceHistory: React.FC<AttendanceHistoryProps> = ({
  title,
  records,
  users,
  todayStr,
  showEmployee = false,
  readOnly = true,
  onEdit,
  icon = 'history',
  emptyMessage
}) => (
  <div className="glass-panel p-5">
    <div className="flex items-center justify-between gap-3 mb-4 pb-3 border-b border-white/10">
      <div className="flex items-center gap-2">
        {icon === 'team' ? (
          <Users size={18} className="text-purple-400" />
        ) : (
          <History size={18} className="text-cyan-400" />
        )}
        <h2 className="text-sm font-bold text-white">{title}</h2>
      </div>
      {readOnly && showEmployee && (
        <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">
          Read only
        </span>
      )}
    </div>

    <div className="space-y-3">
      {records.length === 0 ? (
        <div className="p-4 rounded-xl bg-slate-900/50 border border-white/5 text-center">
          <p className="text-xs text-slate-400">{emptyMessage}</p>
        </div>
      ) : (
        records.map((record) => (
          <AttendanceRow
            key={record.id}
            record={record}
            employee={
              showEmployee
                ? users.find((user) => user.id === record.userId)
                : undefined
            }
            todayStr={todayStr}
            canEdit={!readOnly}
            onEdit={onEdit}
          />
        ))
      )}
    </div>
  </div>
);

interface AttendanceEditorProps {
  record: AttendanceRecord;
  employee?: User;
  onCancel: () => void;
  onSave: (
    recordId: string,
    updates: Pick<AttendanceRecord, 'checkIn' | 'checkOut' | 'breaks'>
  ) => { success: boolean; message: string };
}

const AttendanceEditor: React.FC<AttendanceEditorProps> = ({
  record,
  employee,
  onCancel,
  onSave
}) => {
  const [checkIn, setCheckIn] = useState(record.checkIn);
  const [checkOut, setCheckOut] = useState(record.checkOut || '');
  const [breaks, setBreaks] = useState<WorkBreak[]>(record.breaks || []);
  const [message, setMessage] = useState('');

  const updateBreak = (index: number, updates: Partial<WorkBreak>) => {
    setBreaks((current) =>
      current.map((workBreak, breakIndex) =>
        breakIndex === index ? { ...workBreak, ...updates } : workBreak
      )
    );
  };

  const addBreak = () => {
    setBreaks((current) => [
      ...current,
      {
        id: `draft-break-${Date.now()}`,
        type: 'Other',
        startTime: '',
        endTime: '',
        durationMinutes: 0
      }
    ]);
  };

  const handleSave = () => {
    const result = onSave(record.id, { checkIn, checkOut, breaks });
    setMessage(result.message);
    if (result.success) onCancel();
  };

  const inputClass =
    'w-full px-3 py-2 rounded-lg bg-slate-950/70 border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500/50';

  return (
    <div className="glass-panel p-5 border-cyan-500/30">
      <div className="flex items-start justify-between gap-4 mb-4 pb-3 border-b border-white/10">
        <div>
          <h3 className="text-sm font-bold text-white">Edit Attendance Record</h3>
          <p className="text-xs text-cyan-300 mt-1">
            {employee?.name || record.userId} · {record.date}
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-slate-400 hover:text-white"
        >
          Cancel
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs text-slate-400">
          Check-in time
          <input
            type="time"
            value={checkIn}
            onChange={(event) => setCheckIn(event.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-xs text-slate-400">
          Check-out time
          <input
            type="time"
            value={checkOut}
            onChange={(event) => setCheckOut(event.target.value)}
            className={`${inputClass} mt-1`}
          />
        </label>
      </div>

      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-white">Break Information</h4>
          <button
            type="button"
            onClick={addBreak}
            className="text-xs text-purple-300 flex items-center gap-1"
          >
            <Plus size={13} />
            Add Break
          </button>
        </div>

        {breaks.length === 0 ? (
          <p className="p-3 rounded-lg bg-slate-900/50 text-xs text-slate-500">
            No breaks recorded.
          </p>
        ) : (
          breaks.map((workBreak, index) => (
            <div
              key={workBreak.id}
              className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2 p-3 rounded-lg bg-slate-900/60 border border-white/5"
            >
              <label className="text-[11px] text-slate-500">
                Start
                <input
                  type="time"
                  value={workBreak.startTime}
                  onChange={(event) => updateBreak(index, { startTime: event.target.value })}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="text-[11px] text-slate-500">
                End
                <input
                  type="time"
                  value={workBreak.endTime || ''}
                  onChange={(event) => updateBreak(index, { endTime: event.target.value })}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="text-[11px] text-slate-500">
                Duration (minutes)
                <input
                  type="number"
                  min="0"
                  value={workBreak.durationMinutes}
                  onChange={(event) =>
                    updateBreak(index, { durationMinutes: Number(event.target.value) })
                  }
                  className={`${inputClass} mt-1`}
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  setBreaks((current) =>
                    current.filter((_, breakIndex) => breakIndex !== index)
                  )
                }
                className="self-end p-2 text-rose-300 hover:bg-rose-500/10 rounded-lg"
                aria-label="Remove break"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))
        )}
      </div>

      {message && <p className="text-xs text-rose-300 mt-3">{message}</p>}

      <button
        type="button"
        onClick={handleSave}
        className="mt-4 w-full py-3 rounded-xl glass-button-neon text-xs font-bold flex items-center justify-center gap-2"
      >
        <Save size={15} />
        Save Attendance Changes
      </button>
    </div>
  );
};

export const AttendanceView: React.FC = () => {
  const {
    currentUser,
    currentRole,
    users,
    attendanceRecords,
    activeBreak,
    checkIn,
    checkOut,
    startBreak,
    endBreak,
    updateAttendanceRecord
  } = useApp();
  const [selectedUserId, setSelectedUserId] = useState('all');
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [authorizationError, setAuthorizationError] = useState('');

  const todayStr = new Date().toISOString().split('T')[0];
  const todayAttendance = attendanceRecords.find(
    (record) => record.userId === currentUser.id && record.date === todayStr
  );
  const myAttendanceRecords = attendanceRecords.filter(
    (record) => record.userId === currentUser.id
  );
  const isAdmin = currentRole === 'Admin';
  const isHR = currentRole === 'HR';
  const canViewOthers = isHR || isAdmin;
  const isOwnRecord = (record: AttendanceRecord) =>
    record.userId === currentUser.id;
  const canEditRecord = (record: AttendanceRecord) =>
    isOwnRecord(record) || isAdmin;
  const hrTeamAttendance = attendanceRecords.filter((record) => {
    if (record.userId === currentUser.id) return false;

    const owner = users.find((user) => user.id === record.userId);
    return owner && owner.role !== 'Admin';
  });
  const adminAttendanceRecords = attendanceRecords.filter(
    (record) => record.userId !== currentUser.id
  );
  const permittedOtherUsers = users.filter(
    (user) =>
      user.id !== currentUser.id &&
      (isAdmin || user.role !== 'Admin')
  );
  const visibleOtherAttendance = (
    isAdmin ? adminAttendanceRecords : hrTeamAttendance
  ).filter(
    (record) =>
      selectedUserId === 'all' || record.userId === selectedUserId
  );
  const editingRecord = attendanceRecords.find(
    (record) => record.id === editingRecordId
  );
  const openEditor = (record: AttendanceRecord) => {
    if (!canEditRecord(record)) {
      setAuthorizationError(
        'You are not authorized to edit another user’s attendance record.'
      );
      setEditingRecordId(null);
      return;
    }
    setAuthorizationError('');
    setEditingRecordId(record.id);
  };

  return (
    <div className="space-y-6">
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
                Manage your attendance and review permitted employee records.
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

      <div className="flex items-center gap-2">
        <Clock size={18} className="text-cyan-400" />
        <h2 className="text-base font-bold text-white">My Attendance</h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GlassCard glowColor="cyan">
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <h3 className="text-sm font-bold text-white">Today's Attendance</h3>
                <p className="text-xs text-cyan-300 font-mono mt-1">{todayStr}</p>
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
                  <Clock size={30} className="text-amber-400 mx-auto mb-2" />
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

        <GlassCard glowColor="violet">
          <div className="space-y-4">
            <div className="flex items-center gap-2 border-b border-white/10 pb-3">
              <Coffee size={18} className="text-purple-400" />
              <h3 className="text-sm font-bold text-white">Break Management</h3>
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
            ) : activeBreak?.isBreaking && activeBreak.userId === currentUser.id ? (
              <div className="p-5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-center space-y-4">
                <div>
                  <span className="text-xs font-mono text-amber-300 font-bold">
                    ACTIVE BREAK
                  </span>
                  <h3 className="text-lg font-bold text-white mt-1">Break</h3>
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
            ) : activeBreak?.isBreaking ? (
              <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 text-center">
                <p className="text-xs text-slate-400">
                  Another employee has an active break session.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">
                  Start a break when you need time away from work.
                </p>
                <button
                  onClick={() => startBreak('Other')}
                  className="w-full py-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all"
                >
                  Start Break
                </button>
              </div>
            )}
          </div>
        </GlassCard>
      </div>

      <AttendanceHistory
        title="My Attendance History"
        records={myAttendanceRecords}
        users={users}
        todayStr={todayStr}
        readOnly={false}
        onEdit={openEditor}
        emptyMessage="No personal attendance records found."
      />

      {authorizationError && (
        <p role="alert" className="text-xs text-rose-300">
          {authorizationError}
        </p>
      )}

      {editingRecord && canEditRecord(editingRecord) && (
        <AttendanceEditor
          key={editingRecord.id}
          record={editingRecord}
          employee={users.find((user) => user.id === editingRecord.userId)}
          onCancel={() => setEditingRecordId(null)}
          onSave={updateAttendanceRecord}
        />
      )}

      {canViewOthers && (
        <div className="space-y-4">
          <div className="glass-panel p-4 flex flex-col sm:flex-row sm:items-end gap-3">
            <label className="text-xs text-slate-400 flex-1">
              Select employee records
              <select
                value={selectedUserId}
                onChange={(event) => {
                  setSelectedUserId(event.target.value);
                  setEditingRecordId(null);
                }}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-950/70 border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500/50"
              >
                <option value="all">All users</option>
                {permittedOtherUsers.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[11px] text-slate-500">
              {isAdmin
                ? 'Admin may edit records belonging to other users.'
                : 'Other users’ attendance is read-only for HR.'}
            </p>
          </div>

          <AttendanceHistory
            title={isAdmin ? 'All Attendance Records' : 'Team Attendance'}
            records={visibleOtherAttendance}
            users={users}
            todayStr={todayStr}
            showEmployee
            readOnly={!isAdmin}
            onEdit={isAdmin ? openEditor : undefined}
            icon="team"
            emptyMessage="No attendance records found for the selected employee."
          />
        </div>
      )}
    </div>
  );
};
