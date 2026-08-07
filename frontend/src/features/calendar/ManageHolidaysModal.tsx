import React, { useEffect, useState } from 'react';
import { X, Plus, Pencil, Trash2, Check, AlertCircle } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { DepartmentOption, Holiday, HolidayAudienceType } from '../../types';
import { todayDateKey } from './calendarRules';
import { isPastDate } from '../attendance/attendanceValidation';
import { fetchDepartments } from './departmentsRepository';

// Holiday CRUD UI, reached only from CalendarView's "Manage Holidays" button (itself rendered
// only for currentRole === 'HR'). The `currentRole !== 'HR'` guard below is a harmless second
// layer, not the real gate -- create/update/delete are enforced server-side via effectiveRoles.ts
// (backend/src/calendar/calendar.service.ts's assertIsHR) regardless of what this component does.
interface ManageHolidaysModalProps {
  onClose: () => void;
}

interface HolidayFormState {
  name: string;
  date: string;
  isRecurringAnnual: boolean;
  audienceType: HolidayAudienceType;
  departmentIds: number[];
  userIds: string[];
}

const EMPTY_FORM: HolidayFormState = {
  name: '', date: '', isRecurringAnnual: false, audienceType: 'Everyone', departmentIds: [], userIds: []
};

// Matches the backend's UTC "today" cutoff (calendar.service.ts's createHoliday) so a date this
// input allows is never rejected by the server, and vice versa.
export const ManageHolidaysModal: React.FC<ManageHolidaysModalProps> = ({ onClose }) => {
  const { currentRole, users, holidays, createHoliday, updateHoliday, deleteHoliday } = useApp();

  const [form, setForm] = useState<HolidayFormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(false);
  const [userSearch, setUserSearch] = useState('');

  // Loaded once on mount -- this modal only ever renders for HR (see the early return below), and
  // the Department audience picker needs the full, current department list regardless of which
  // audience type is initially selected.
  useEffect(() => {
    let active = true;
    setDepartmentsLoading(true);
    fetchDepartments()
      .then((data) => {
        if (active) setDepartments(data);
      })
      .catch(() => {
        if (active) setNotice({ type: 'error', message: 'Could not load departments.' });
      })
      .finally(() => {
        if (active) setDepartmentsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (currentRole !== 'HR') return null;

  const sortedHolidays = [...holidays].sort((a, b) => a.date.localeCompare(b.date));

  // Specific Users audience: Admin and HR must never appear (requirement), same eligibility shape
  // as ProjectsView.tsx's assignableMembers -- active, non-Admin accounts only (here also
  // excluding HR, which ProjectsView doesn't need to since it already excludes all non-assignable
  // roles via nonAdminUsers for a different reason).
  const eligibleUsers = users.filter(
    (user) => user.role !== 'Admin' && user.role !== 'HR' && user.status !== 'inactive'
  );
  const filteredEligibleUsers = userSearch.trim()
    ? eligibleUsers.filter((user) => user.name.toLowerCase().includes(userSearch.trim().toLowerCase()))
    : eligibleUsers;

  const audienceSummary = (holiday: Holiday): string => {
    if (holiday.audienceType === 'Everyone') return 'Everyone';
    if (holiday.audienceType === 'Department') {
      const names = holiday.departmentIds
        .map((id) => departments.find((department) => department.id === id)?.name)
        .filter((name): name is string => Boolean(name));
      return names.length > 0 ? `Dept: ${names.join(', ')}` : `${holiday.departmentIds.length} department(s)`;
    }
    const names = holiday.userIds
      .map((id) => users.find((user) => user.id === id)?.name)
      .filter((name): name is string => Boolean(name));
    return names.length > 0 ? names.join(', ') : `${holiday.userIds.length} user(s)`;
  };

  const handleAudienceTypeChange = (audienceType: HolidayAudienceType) => {
    setForm((prev) => ({ ...prev, audienceType, departmentIds: [], userIds: [] }));
  };

  const toggleDepartment = (departmentId: number) => {
    setForm((prev) => ({
      ...prev,
      departmentIds: prev.departmentIds.includes(departmentId)
        ? prev.departmentIds.filter((id) => id !== departmentId)
        : [...prev.departmentIds, departmentId]
    }));
  };

  const toggleUser = (userId: string) => {
    setForm((prev) => ({
      ...prev,
      userIds: prev.userIds.includes(userId) ? prev.userIds.filter((id) => id !== userId) : [...prev.userIds, userId]
    }));
  };

  const startEdit = (holiday: Holiday) => {
    setEditingId(holiday.id);
    setForm({
      name: holiday.name,
      date: holiday.date,
      isRecurringAnnual: holiday.isRecurringAnnual,
      audienceType: holiday.audienceType,
      departmentIds: holiday.departmentIds,
      userIds: holiday.userIds
    });
    setUserSearch('');
    setNotice(null);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setUserSearch('');
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!form.name.trim() || !form.date) {
      setNotice({ type: 'error', message: 'Name and date are required.' });
      return;
    }
    const originalDate = editingId
      ? holidays.find((holiday) => holiday.id === editingId)?.date
      : undefined;
    if (isPastDate(form.date, todayDateKey()) && form.date !== originalDate) {
      setNotice({ type: 'error', message: 'Holiday date cannot be in the past.' });
      return;
    }
    if (form.audienceType === 'Department' && form.departmentIds.length === 0) {
      setNotice({ type: 'error', message: 'Select at least one department.' });
      return;
    }
    if (form.audienceType === 'Users' && form.userIds.length === 0) {
      setNotice({ type: 'error', message: 'Select at least one user.' });
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        date: form.date,
        isRecurringAnnual: form.isRecurringAnnual,
        audienceType: form.audienceType,
        departmentIds: form.audienceType === 'Department' ? form.departmentIds : [],
        userIds: form.audienceType === 'Users' ? form.userIds : []
      };
      const result = editingId ? await updateHoliday(editingId, payload) : await createHoliday(payload);
      setNotice({ type: result.success ? 'success' : 'error', message: result.message });
      if (result.success) cancelEdit();
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (holiday: Holiday) => {
    if (!window.confirm(`Delete "${holiday.name}"? This cannot be undone.`)) return;
    const result = await deleteHoliday(holiday.id);
    setNotice({ type: result.success ? 'success' : 'error', message: result.message });
    if (result.success && editingId === holiday.id) cancelEdit();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-16 p-4 bg-black/70 backdrop-blur-md overflow-y-auto">
      <div className="w-full max-w-xl glass-panel-glow border border-cyan-500/40 shadow-2xl relative">
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-900/60">
          <h2 className="text-sm font-bold text-white">Manage Holidays</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto text-xs">
          {notice && (
            <div
              className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                notice.type === 'success'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : 'border-rose-500/30 bg-rose-500/10 text-rose-300'
              }`}
            >
              <span className="flex items-center gap-2">
                {notice.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
                {notice.message}
              </span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss message">
                <X size={14} />
              </button>
            </div>
          )}

          {/* Add / Edit form */}
          <div className="space-y-3 rounded-lg border border-white/10 bg-black/30 p-3">
            <p className="text-slate-300 font-semibold">{editingId ? 'Edit Holiday' : 'Add Holiday'}</p>
            <div>
              <label className="block text-slate-400 mb-1">Name</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50"
                placeholder="e.g. Independence Day"
              />
            </div>
            <div>
              <label className="block text-slate-400 mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                // Only enforced while adding a new holiday -- editing an existing (possibly
                // already-past) holiday's name/recurrence must still work without forcing its
                // date to change, matching updateHoliday's unchanged backend behavior.
                min={editingId ? undefined : todayDateKey()}
                onChange={(e) => setForm((prev) => ({ ...prev, date: e.target.value }))}
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50"
              />
            </div>
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={form.isRecurringAnnual}
                onChange={(e) => setForm((prev) => ({ ...prev, isRecurringAnnual: e.target.checked }))}
                className="accent-cyan-500"
              />
              Repeats every year (same month/day)
            </label>
            <div>
              <label className="block text-slate-400 mb-1">Audience</label>
              <select
                value={form.audienceType}
                onChange={(e) => handleAudienceTypeChange(e.target.value as HolidayAudienceType)}
                className="w-full px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-100 focus:outline-none focus:border-cyan-500/50"
              >
                <option value="Everyone">Everyone</option>
                <option value="Department">One or more departments</option>
                <option value="Users">Specific users</option>
              </select>
            </div>
            {form.audienceType === 'Department' && (
              <div>
                <label className="block text-slate-400 mb-1">Departments</label>
                <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto p-2 rounded-lg bg-black/30 border border-white/10">
                  {departmentsLoading && <p className="text-slate-500 col-span-2">Loading departments...</p>}
                  {!departmentsLoading && departments.length === 0 && (
                    <p className="text-slate-500 col-span-2">No departments yet.</p>
                  )}
                  {departments.map((department) => (
                    <label key={department.id} className="flex items-center gap-2 text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.departmentIds.includes(department.id)}
                        onChange={() => toggleDepartment(department.id)}
                        className="accent-cyan-500"
                      />
                      {department.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {form.audienceType === 'Users' && (
              <div>
                <label className="block text-slate-400 mb-1">Users</label>
                <input
                  type="text"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Search by name..."
                  className="w-full mb-1.5 px-3 py-2 rounded-lg bg-black/40 border border-white/10 text-slate-100 placeholder-slate-400 focus:outline-none focus:border-cyan-500/50"
                />
                <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto p-2 rounded-lg bg-black/30 border border-white/10">
                  {filteredEligibleUsers.length === 0 && (
                    <p className="text-slate-500 col-span-2">No matching users.</p>
                  )}
                  {filteredEligibleUsers.map((user) => (
                    <label key={user.id} className="flex items-center gap-2 text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.userIds.includes(user.id)}
                        onChange={() => toggleUser(user.id)}
                        className="accent-cyan-500"
                      />
                      {user.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              {editingId && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  className="px-3 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/5"
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="px-3 py-1.5 rounded-lg glass-button-neon font-bold flex items-center gap-1.5 disabled:opacity-60"
              >
                <Plus size={13} /> {submitting ? 'Saving...' : editingId ? 'Save Changes' : 'Add Holiday'}
              </button>
            </div>
          </div>

          {/* Existing holidays */}
          <div className="space-y-1.5">
            {sortedHolidays.length === 0 && (
              <p className="text-slate-500 text-center py-4">No holidays yet.</p>
            )}
            {sortedHolidays.map((holiday) => (
              <div
                key={holiday.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-slate-100 font-semibold truncate">{holiday.name}</p>
                  <p className="text-slate-500">
                    {holiday.date}
                    {holiday.isRecurringAnnual ? ' · Repeats yearly' : ''}
                    {' · '}{audienceSummary(holiday)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => startEdit(holiday)}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-white/10 hover:text-cyan-300"
                    title="Edit holiday"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(holiday)}
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"
                    title="Delete holiday"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
