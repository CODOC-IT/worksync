import React, { useEffect, useState } from 'react';
import { useApp } from '../../store/AppContext';
import { GlassCard } from '../../components/common/GlassCard';
import { StatusBadge } from '../../components/common/StatusBadge';
import { AttendanceRecord, HRRequest, User, WorkBreak } from '../../types';
import { todayDateKey, toDateKey } from '../calendar/calendarRules';
import {
  canShowAttendanceCorrection,
  isPastDate,
  validateAttendanceCorrection,
  validateLeaveRequestOverlap,
  type CorrectionShift
} from './attendanceValidation';
import { matchesAttendanceRoleFilter, type AttendanceRoleFilter } from './attendanceFilters';
import { AttendanceTimeInput } from './Time24Input';
import {
  CheckCircle2,
  Clock,
  Coffee,
  History,
  LogIn,
  LogOut,
  FileText,
  Pencil,
  Plus,
  Save,
  Send,
  Trash2,
  Users,
  X
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
  (record.breaks || []).reduce((totalSeconds, workBreak) => {
    const seconds = Number(workBreak.durationSeconds);
    const duration = Number(workBreak.durationMinutes);
    return workBreak.endTime && Number.isFinite(seconds) && seconds >= 0
      ? totalSeconds + seconds
      : workBreak.endTime && Number.isFinite(duration) && duration >= 0
        ? totalSeconds + duration * 60
        : totalSeconds;
  }, 0) / 60;

interface AttendanceRowProps {
  record: AttendanceRecord;
  employee?: User;
  todayStr: string;
  canEdit?: boolean;
  onEdit?: (record: AttendanceRecord) => void;
  canRequestChange?: boolean;
  requestStatus?: HRRequest['status'];
  onRequestChange?: (record: AttendanceRecord) => void;
  editingRecordId?: string | null;
  renderEditor?: (record: AttendanceRecord) => React.ReactNode;
}

const AttendanceRow: React.FC<AttendanceRowProps> = ({
  record,
  employee,
  todayStr,
  canEdit = false,
  onEdit,
  canRequestChange = false,
  requestStatus,
  onRequestChange,
  editingRecordId,
  renderEditor
}) => {
  const correctionAvailable = canShowAttendanceCorrection(record.checkIn, record.checkOut, record.status);
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
    <div className="p-4 rounded-xl bg-slate-900/50 border border-white/5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
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
          {correctionAvailable && canEdit && onEdit && (
            <button
              type="button"
              onClick={() => onEdit(record)}
              disabled={requestStatus === 'Pending'}
              className="px-3 py-2 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-bold flex items-center gap-1.5 transition-all disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Pencil size={13} />
              {requestStatus === 'Pending' ? 'Pending Approval' : 'Edit Attendance'}
            </button>
          )}
          {correctionAvailable && canRequestChange && onRequestChange && (
            <button
              type="button"
              onClick={() => onRequestChange(record)}
              disabled={requestStatus === 'Pending' || requestStatus === 'Approved'}
              className={`px-3 py-2 rounded-lg border text-xs font-bold flex items-center gap-1.5 transition-all ${
                requestStatus === 'Approved'
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 cursor-not-allowed'
                  : requestStatus === 'Pending'
                    ? 'bg-amber-500/10 text-amber-300 border-amber-500/30 cursor-not-allowed'
                    : requestStatus === 'Rejected'
                      ? 'bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 border-rose-500/30'
                      : 'bg-purple-500/15 hover:bg-purple-500/25 text-purple-300 border-purple-500/30'
              }`}
            >
              {requestStatus === 'Approved' ? (
                <CheckCircle2 size={13} />
              ) : (
                <FileText size={13} />
              )}
              {requestStatus === 'Approved'
                ? 'Approved'
                : requestStatus === 'Pending'
                  ? 'Pending'
                  : requestStatus === 'Rejected'
                    ? 'Request Again'
                    : 'Request Change'}
            </button>
          )}
        </div>
      </div>

      {canEdit && renderEditor && editingRecordId === record.id && (
        <div className="mt-3 rounded-lg border-t border-cyan-500/20 pt-3">
          {renderEditor(record)}
        </div>
      )}
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
  canRequestChange?: boolean;
  getRequestStatus?: (record: AttendanceRecord) => HRRequest['status'] | undefined;
  onRequestChange?: (record: AttendanceRecord) => void;
  editingRecordId?: string | null;
  renderEditor?: (record: AttendanceRecord) => React.ReactNode;
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
  canRequestChange = false,
  getRequestStatus,
  onRequestChange,
  editingRecordId,
  renderEditor,
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

    <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
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
            canRequestChange={canRequestChange}
            requestStatus={getRequestStatus?.(record)}
            onRequestChange={onRequestChange}
            editingRecordId={editingRecordId}
            renderEditor={renderEditor}
          />
        ))
      )}
    </div>
  </div>
);

interface AttendanceEditorProps {
  record: AttendanceRecord;
  employee?: User;
  requiresApproval?: boolean;
  shift?: CorrectionShift;
  onCancel: () => void;
  onSave: (
    recordId: string,
    updates: Pick<AttendanceRecord, 'checkIn' | 'checkOut' | 'breaks'>,
    reason?: string
  ) => Promise<{ success: boolean; message: string }>;
}

const AttendanceEditor: React.FC<AttendanceEditorProps> = ({
  record,
  employee,
  requiresApproval = false,
  shift,
  onCancel,
  onSave
}) => {
  const [checkIn, setCheckIn] = useState(record.checkIn);
  const [checkOut, setCheckOut] = useState(record.checkOut || '');
  const [breaks, setBreaks] = useState<WorkBreak[]>(record.breaks || []);
  const [reason, setReason] = useState('');
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

  const handleSave = async () => {
    if (!reason.trim()) {
      setMessage(requiresApproval
        ? 'A reason is required for an attendance edit request.'
        : 'A reason is required for an administrator correction.');
      return;
    }
    const validationError = validateAttendanceCorrection(checkIn, checkOut, breaks, shift);
    if (validationError) {
      setMessage(validationError);
      return;
    }
    const result = await onSave(record.id, { checkIn, checkOut, breaks }, reason);
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
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="text-xs text-slate-400">
          Check-in time
          <AttendanceTimeInput
            value={checkIn}
            onChange={setCheckIn}
            aria-label="Check-in time in 24-hour HH:mm format"
            className={`${inputClass} mt-1`}
          />
        </label>
        <label className="text-xs text-slate-400">
          Check-out time
          <AttendanceTimeInput
            value={checkOut}
            onChange={setCheckOut}
            aria-label="Check-out time in 24-hour HH:mm format"
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
                <AttendanceTimeInput
                  value={workBreak.startTime}
                  onChange={(next) => updateBreak(index, { startTime: next })}
                  aria-label={`Break start time in 24-hour HH:mm format`}
                  className={`${inputClass} mt-1`}
                />
              </label>
              <label className="text-[11px] text-slate-500">
                End
                <AttendanceTimeInput
                  value={workBreak.endTime || ''}
                  onChange={(next) => updateBreak(index, { endTime: next })}
                  aria-label={`Break end time in 24-hour HH:mm format`}
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

      {
        <label className="mt-4 block text-xs text-slate-400">
          Reason for change
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            required
            className={`${inputClass} mt-1 resize-none`}
            placeholder="Explain why these attendance values should be changed..."
          />
        </label>
      }

      {message && <p className="text-xs text-rose-300 mt-3">{message}</p>}

      <div className="mt-4 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 sm:flex-none rounded-xl bg-white/5 px-4 py-3 text-xs font-bold text-slate-300 transition-colors hover:bg-white/10"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          className="flex-1 sm:flex-none rounded-xl glass-button-neon px-4 py-3 text-xs font-bold flex items-center justify-center gap-2"
        >
          <Save size={15} />
          {requiresApproval ? 'Submit Attendance Edit Request' : 'Save Attendance Changes'}
        </button>
      </div>
    </div>
  );
};

interface LeaveApplicationFormProps {
  pending: boolean;
  onClose: () => void;
  halfDayBoundary?: string;
  onSubmit: (
    leaveType: 'Full Day Leave' | 'Half Day Leave',
    leavePeriod: 'First Half' | 'Second Half' | undefined,
    date: string,
    reason: string
  ) => Promise<{ success: boolean; message: string }>;
}

const LeaveApplicationForm: React.FC<LeaveApplicationFormProps> = ({
  pending,
  onClose,
  halfDayBoundary = '12:00',
  onSubmit
}) => {
  const [leaveType, setLeaveType] = useState<'Full Day Leave' | 'Half Day Leave'>('Full Day Leave');
  const [leavePeriod, setLeavePeriod] = useState<'First Half' | 'Second Half'>('Second Half');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async () => {
    if (!leaveType || !date || !reason.trim()) {
      setMessage('Leave type, leave date, and reason are required.');
      return;
    }
    if (isPastDate(date, todayDateKey())) {
      setMessage('Leave date cannot be in the past.');
      return;
    }
    const result = await onSubmit(
      leaveType,
      leaveType === 'Half Day Leave' ? leavePeriod : undefined,
      date,
      reason.trim()
    );
    setMessage(result.message);
    if (result.success) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-lg border-violet-500/30 p-5">
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div>
            <h3 className="font-bold text-white">Apply Leave</h3>
            <p className="mt-1 text-xs text-slate-400">Submit a leave request for approval.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close leave form" className="p-2 text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>
        <div className="mt-4 space-y-4">
          <label className="block text-xs text-slate-300">
            Leave Type
            <select
              value={leaveType}
              onChange={(event) => setLeaveType(event.target.value as typeof leaveType)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-white"
              required
            >
              <option value="Full Day Leave">Full Day Leave</option>
              <option value="Half Day Leave">Half Day Leave</option>
            </select>
          </label>
          {leaveType === 'Half Day Leave' && (
            <label className="block text-xs text-slate-300">
              Leave Period
              <select
                value={leavePeriod}
                onChange={(event) => setLeavePeriod(event.target.value as typeof leavePeriod)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-white"
                required
              >
                <option value="First Half">First Half (work from {halfDayBoundary})</option>
                <option value="Second Half">Second Half (work until {halfDayBoundary})</option>
              </select>
            </label>
          )}
          <label className="block text-xs text-slate-300">
            Leave Date
            <input
              type="date"
              value={date}
              min={todayDateKey()}
              onChange={(event) => setDate(event.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-white"
              required
            />
          </label>
          <label className="block text-xs text-slate-300">
            Reason
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              className="mt-1 w-full resize-none rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-white"
              required
            />
          </label>
        </div>
        {message && <p className="mt-3 text-xs text-rose-300">{message}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg bg-white/5 px-4 py-2 text-xs text-slate-300">Cancel</button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={pending}
            className="glass-button-neon rounded-lg px-4 py-2 text-xs font-bold disabled:opacity-60"
          >
            {pending ? 'Submitting...' : 'Submit Leave Request'}
          </button>
        </div>
      </div>
    </div>
  );
};


interface AttendanceChangeRequestModalProps {
  record: AttendanceRecord;
  pending: boolean;
  onClose: () => void;
  onSubmit: (record: AttendanceRecord, reason: string) => void;
}

const AttendanceChangeRequestModal: React.FC<AttendanceChangeRequestModalProps> = ({
  record,
  pending,
  onClose,
  onSubmit
}) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = () => {
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 10) {
      setError('Please provide at least 10 characters explaining why the attendance should be changed.');
      return;
    }

    setError('');
    onSubmit(record, trimmedReason);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg glass-panel border-purple-500/30 p-5">
        <div className="flex items-start justify-between gap-4 pb-3 border-b border-white/10">
          <div>
            <h3 className="text-base font-bold text-white">Request Attendance Change</h3>
            <p className="text-xs text-purple-300 mt-1">
              Attendance date: {record.date}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5"
            aria-label="Close attendance change request"
          >
            <X size={16} />
          </button>
        </div>

        <div className="mt-4 p-3 rounded-xl bg-slate-900/60 border border-white/5 text-xs text-slate-300 space-y-1">
          <p>Recorded check-in: {record.checkIn || 'Not recorded'}</p>
          <p>Recorded check-out: {record.checkOut || 'Not recorded'}</p>
        </div>

        <label className="block mt-4 text-xs text-slate-300">
          Why should this attendance be changed?
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={5}
            maxLength={500}
            placeholder="Describe the attendance issue and the correction you need..."
            className="mt-2 w-full px-3 py-3 rounded-xl bg-slate-950/70 border border-white/10 text-sm text-white resize-none focus:outline-none focus:border-purple-500/50"
          />
        </label>

        <div className="mt-1 flex items-center justify-between text-[11px]">
          <span className={error ? 'text-rose-300' : 'text-slate-500'}>
            {error || 'The request will be sent to HR for approval.'}
          </span>
          <span className="text-slate-500">{reason.length}/500</span>
        </div>

        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-xs font-bold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={pending}
            className="px-4 py-2.5 rounded-xl bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 border border-purple-500/40 text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <Send size={14} />
            {pending ? 'Request Pending' : 'Send Request'}
          </button>
        </div>
      </div>
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
    hrRequests,
    checkIn,
    checkOut,
    startBreak,
    endBreak,
    updateAttendanceRecord,
    submitHRRequest,
    workingSchedule,
    updateWorkingSchedule,
    showToast
  } = useApp();
  const [selectedUserId, setSelectedUserId] = useState('all');
  const [dateFilter, setDateFilter] = useState<'today' | '7days' | '30days' | 'custom'>('30days');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [roleFilter, setRoleFilter] = useState<AttendanceRoleFilter>('all');
  const [editingRecordId, setEditingRecordId] = useState<string | null>(null);
  const [leaveFormOpen, setLeaveFormOpen] = useState(false);
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [authorizationError, setAuthorizationError] = useState('');
  const [scheduleStart, setScheduleStart] = useState('');
  const [scheduleEnd, setScheduleEnd] = useState('');
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleError, setScheduleError] = useState('');

  const currentScheduleStart = workingSchedule?.startTime || '';
  const currentScheduleEnd = workingSchedule?.endTime || '';
  useEffect(() => {
    setScheduleStart(currentScheduleStart);
    setScheduleEnd(currentScheduleEnd);
  }, [currentScheduleStart, currentScheduleEnd]);

  const parseTime = (time?: string): number | null => {
    if (!time) return null;
    const match = time.match(/^(\d{1,2}):(\d{2})/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (!Number.isFinite(hours) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      return null;
    }
    return hours * 60 + minutes;
  };
  const formatMinutesAsHhmm = (totalMinutes: number): string => {
    const safe = ((totalMinutes % 1440) + 1440) % 1440;
    const hours = Math.floor(safe / 60);
    const minutes = safe % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  };
  const shiftStartMinutes = parseTime(currentScheduleStart);
  const shiftEndMinutes = parseTime(currentScheduleEnd);
  const shiftWindowMinutes =
    shiftStartMinutes !== null && shiftEndMinutes !== null
      ? ((shiftEndMinutes - shiftStartMinutes + 1440) % 1440) || 0
      : 0;
  const halfDayBoundary =
    shiftStartMinutes !== null && shiftWindowMinutes > 0
      ? formatMinutesAsHhmm(shiftStartMinutes + Math.floor(shiftWindowMinutes / 2))
      : '12:00';
  const editingShift: CorrectionShift = currentScheduleStart && currentScheduleEnd
    ? { startTime: currentScheduleStart, endTime: currentScheduleEnd }
    : {};

  // Local-safe "today" -- new Date().toISOString() reports UTC, which reads a full calendar day
  // behind local time for ~5 hours after midnight in Pakistan (UTC+5) and any other
  // positive-offset timezone. A leave request submitted in that window with the old computation
  // could be recorded for the wrong day, then render on the wrong Calendar day. See
  // calendarRules.ts's todayDateKey.
  const todayStr = todayDateKey();
  const customDateError =
    dateFilter === 'custom' && Boolean(customFrom) && Boolean(customTo) && customFrom > customTo
      ? 'From date cannot be later than the To date.'
      : '';

  const todayAttendance = attendanceRecords.find(
    (record) => record.userId === currentUser.id && record.date === todayStr
  );
  const isAdmin = currentRole === 'Admin';
  const isHR = currentRole === 'HR';
  const canViewOthers = isHR || isAdmin;
  const isOwnRecord = (record: AttendanceRecord) =>
    record.userId === currentUser.id;
  const canEditRecord = (record: AttendanceRecord) =>
    !isAdmin &&
    isOwnRecord(record) &&
    (Boolean(record.checkOut) || record.status === 'Absent');
  const filterByDate = (record: AttendanceRecord) => {
    if (dateFilter === 'today') return record.date === todayStr;
    if (dateFilter === 'custom') {
      return (!customFrom || record.date >= customFrom) && (!customTo || record.date <= customTo);
    }
    const start = new Date(`${todayStr}T00:00:00`);
    start.setDate(start.getDate() - (dateFilter === '7days' ? 6 : 29));
    return record.date >= toDateKey(start) && record.date <= todayStr;
  };
  const filterByRole = (record: AttendanceRecord) =>
    matchesAttendanceRoleFilter(record, users, roleFilter);
  const myAttendanceRecords = attendanceRecords.filter(
    (record) => record.userId === currentUser.id && filterByDate(record)
  );
  const getCorrectionRequestStatus = (
    record: AttendanceRecord
  ): HRRequest['status'] | undefined => {
    const latestRequest = hrRequests
      .filter(
        (request) =>
          request.userId === currentUser.id &&
          request.type === 'Correction' &&
          request.date === record.date
      )
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];

    return latestRequest?.status;
  };

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
      (selectedUserId === 'all' || record.userId === selectedUserId) &&
      filterByDate(record) &&
      filterByRole(record)
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

  const submitLeave = async (
    leaveType: 'Full Day Leave' | 'Half Day Leave',
    leavePeriod: 'First Half' | 'Second Half' | undefined,
    date: string,
    reason: string
  ) => {
    const overlapError = validateLeaveRequestOverlap(date, leaveType, leavePeriod, hrRequests);
    if (overlapError) return { success: false, message: overlapError };
    setLeaveSubmitting(true);
    const result = await submitHRRequest(
      'Leave',
      reason,
      { leaveType, leavePeriod, leaveDays: 1 },
      date
    );
    setLeaveSubmitting(false);
    return result;
  };

  const saveWorkingSchedule = async () => {
    const start = scheduleStart.trim();
    const end = scheduleEnd.trim();
    if (!start || !end) {
      setScheduleError('Shift start and end times are required.');
      return;
    }
    setScheduleError('');
    setScheduleSaving(true);
    const result = await updateWorkingSchedule(start, end);
    setScheduleSaving(false);
    if (!result.success) {
      setScheduleError(result.message);
      showToast('error', 'Working Schedule Not Updated', result.message);
      return;
    }
    showToast('success', 'Working Schedule Updated', 'The attendance shift has been updated.');
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
          <div className="flex items-center gap-3">
            {!isAdmin && (
              <button
                type="button"
                onClick={() => setLeaveFormOpen(true)}
                className="glass-button-neon rounded-xl px-4 py-2.5 text-xs font-bold"
              >
                Apply Leave
              </button>
            )}
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
      </div>

      {isAdmin && (
        <div className="glass-panel p-5">
          <div className="flex items-center gap-2 border-b border-white/10 pb-3 mb-4">
            <Clock size={18} className="text-cyan-400" />
            <div>
              <h2 className="text-base font-bold text-white">Attendance Working Schedule</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Shift start/end in {workingSchedule?.timeZone || 'Asia/Karachi'} (PKT), shown in HH:mm. The 8-hour window and 60-minute break allowance are fixed.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {[
              { label: 'Shift Window', value: `${workingSchedule?.windowMinutes ?? 480} min (8h)` },
              { label: 'Break Allowance', value: `${workingSchedule?.breakMinutes ?? 60} min` },
              { label: 'Expected Net Work', value: `${workingSchedule?.netMinutes ?? 420} min (7h)` },
              { label: 'Working Days', value: 'Monday - Friday' }
            ].map((stat) => (
              <div key={stat.label} className="rounded-lg bg-slate-950/60 border border-white/10 px-3 py-2">
                <p className="text-[11px] text-slate-400 uppercase tracking-wide">{stat.label}</p>
                <p className="text-sm font-bold text-cyan-300 mt-0.5">{stat.value}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row items-end gap-3">
            <label className="text-xs text-slate-400 flex flex-col gap-1">
              Shift start
              <AttendanceTimeInput
                value={scheduleStart}
                onChange={setScheduleStart}
                aria-label="Shift start time in 24-hour HH:mm format"
                className="px-3 py-2 rounded-lg bg-slate-950/70 border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500/50"
              />
            </label>
            <label className="text-xs text-slate-400 flex flex-col gap-1">
              Shift end
              <AttendanceTimeInput
                value={scheduleEnd}
                onChange={setScheduleEnd}
                aria-label="Shift end time in 24-hour HH:mm format"
                className="px-3 py-2 rounded-lg bg-slate-950/70 border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500/50"
              />
            </label>
            <button
              type="button"
              onClick={saveWorkingSchedule}
              disabled={scheduleSaving}
              className="px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 border border-cyan-500/40 text-xs font-bold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              <Save size={14} />
              {scheduleSaving ? 'Saving…' : 'Save Schedule'}
            </button>
            {scheduleError && (
              <p role="alert" className="text-xs text-rose-300">{scheduleError}</p>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-3">
            An end time earlier than the start time means the shift crosses midnight (for example 16:00 – 00:00).
          </p>
        </div>
      )}

      {!isAdmin && (<>
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

      {!canViewOthers && (
        <div className="glass-panel p-4 space-y-3">
          <label className="block text-xs text-slate-400">
            Date range
            <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as typeof dateFilter)} className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-950/70 border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500/50">
              <option value="today">Today</option>
              <option value="7days">Last 7 Days</option>
              <option value="30days">Last 30 Days</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </label>
          {dateFilter === 'custom' && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-400">From<input type="date" value={customFrom} max={customTo || todayStr} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-950/70 border border-white/10 text-xs text-white" /></label>
              <label className="text-xs text-slate-400">To<input type="date" value={customTo} min={customFrom || undefined} max={todayStr} onChange={(event) => setCustomTo(event.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-950/70 border border-white/10 text-xs text-white" /></label>
            </div>
          )}
          {customDateError && (
            <p role="alert" className="mt-2 text-xs text-rose-300">{customDateError}</p>
          )}
        </div>
      )}

<AttendanceHistory
        title="My Attendance History"
        records={myAttendanceRecords}
        users={users}
        todayStr={todayStr}
        readOnly={false}
        onEdit={openEditor}
        canRequestChange={false}
        getRequestStatus={getCorrectionRequestStatus}
        editingRecordId={editingRecordId}
        renderEditor={(record) =>
          canEditRecord(record) ? (
            <AttendanceEditor
              key={record.id}
              record={record}
              employee={users.find((user) => user.id === record.userId)}
              requiresApproval={!isAdmin}
              shift={editingShift}
              onCancel={() => setEditingRecordId(null)}
              onSave={updateAttendanceRecord}
            />
          ) : null
        }
        emptyMessage="No personal attendance records found."
      />
      </>)}

      {leaveFormOpen && (
        <LeaveApplicationForm
          pending={leaveSubmitting}
          onClose={() => setLeaveFormOpen(false)}
          halfDayBoundary={halfDayBoundary}
          onSubmit={submitLeave}
        />
      )}

      {authorizationError && (
        <p role="alert" className="text-xs text-rose-300">
          {authorizationError}
        </p>
      )}

      {canViewOthers && (
        <div className="space-y-4">
          <div className="glass-panel p-4 flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="text-xs text-slate-400">
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
            <label className="text-xs text-slate-400">
              Date range
              <select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as typeof dateFilter)} className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-950/70 border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500/50">
                <option value="today">Today</option>
                <option value="7days">Last 7 Days</option>
                <option value="30days">Last 30 Days</option>
                <option value="custom">Custom Date Range</option>
              </select>
            </label>
            <label className="text-xs text-slate-400">
              User role
              <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as typeof roleFilter)} className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-950/70 border border-white/10 text-xs text-white focus:outline-none focus:border-cyan-500/50">
                <option value="all">All roles</option>
                <option value="HR">HR</option>
                <option value="Team_Member">Team Member</option>
                <option value="Team_Lead">Team Lead</option>
              </select>
            </label>
            </div>
            {dateFilter === 'custom' && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-slate-400">From<input type="date" value={customFrom} max={customTo || todayStr} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-950/70 border border-white/10 text-xs text-white" /></label>
                <label className="text-xs text-slate-400">To<input type="date" value={customTo} min={customFrom || undefined} max={todayStr} onChange={(event) => setCustomTo(event.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-950/70 border border-white/10 text-xs text-white" /></label>
              </div>
            )}
            {customDateError && (
              <p role="alert" className="mt-2 text-xs text-rose-300">{customDateError}</p>
            )}
            <p className="text-[11px] text-slate-500">
              {isAdmin
                ? 'Administrators have view-only attendance access.'
                : 'Other users’ attendance is read-only for HR.'}
            </p>
          </div>

          <AttendanceHistory
            title={isAdmin ? 'All Attendance Records' : 'Team Attendance'}
            records={visibleOtherAttendance}
            users={users}
            todayStr={todayStr}
            showEmployee
            readOnly
            icon="team"
            emptyMessage="No attendance records found for the selected employee."
          />
        </div>
      )}
    </div>
  );
};
