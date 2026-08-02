import React, { useMemo, useState } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { MonthGrid } from './MonthGrid';
import { WeekGrid } from './WeekGrid';
import { DayGrid } from './DayGrid';
import { YearGrid } from './YearGrid';
import { DayEntriesDrawer } from './DayEntriesDrawer';
import { CalendarFilterBar } from './CalendarFilterBar';
import { ManageHolidaysModal } from './ManageHolidaysModal';
import {
  buildCalendarEntries,
  buildHolidayEntries,
  buildApprovedLeaveEntries,
  groupEntriesByDate,
  filterCalendarEntries,
  matchesPersonalFilters,
  leadsAnyProject,
  getMonthGridDates,
  getWeekDates,
  getYearMonths,
  toDateKey,
  ALL_CALENDAR_KINDS,
  CalendarEntry,
  CalendarEntryKind,
  CalendarEntryOrigin,
  PersonalFilterKind
} from './calendarRules';

type CalendarViewMode = 'month' | 'week' | 'day' | 'year';

const VIEW_MODES: CalendarViewMode[] = ['month', 'week', 'day', 'year'];

const shiftAnchorDate = (date: Date, mode: CalendarViewMode, direction: 1 | -1): Date => {
  const next = new Date(date);
  if (mode === 'month') {
    next.setMonth(next.getMonth() + direction);
  } else if (mode === 'week') {
    next.setDate(next.getDate() + direction * 7);
  } else if (mode === 'day') {
    next.setDate(next.getDate() + direction);
  } else {
    next.setFullYear(next.getFullYear() + direction);
  }
  return next;
};

export const CalendarView: React.FC = () => {
  const { projects, tasks, users, calendarEvents, approvedLeave, holidays, currentRole, currentUser } = useApp();

  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [activeDayKey, setActiveDayKey] = useState<string | null>(null);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);
  const [originFilter, setOriginFilter] = useState<'all' | CalendarEntryOrigin>('all');
  const [activeKinds, setActiveKinds] = useState<Set<CalendarEntryKind>>(new Set(ALL_CALENDAR_KINDS));
  const [activePersonalFilters, setActivePersonalFilters] = useState<Set<PersonalFilterKind>>(new Set());
  const [manageHolidaysOpen, setManageHolidaysOpen] = useState(false);

  // Admin/HR are full-visibility roles -- "mine" has no meaning for them, so the entire personal
  // filter cluster is hidden rather than just left unselected (matches Manage Holidays' own
  // currentRole === 'HR' gating pattern just below). Team Lead is not a role in this system (see
  // project.teamLeadId), so "leads at least one project" is a data check, not a role check.
  const showPersonalFilters = currentRole !== 'Admin' && currentRole !== 'HR';
  const showLedProjectsFilter = leadsAnyProject(projects, currentUser.id);

  const togglePersonalFilter = (filter: PersonalFilterKind) => {
    setActivePersonalFilters((prev) => {
      const next = new Set(prev);
      if (next.has(filter)) {
        next.delete(filter);
      } else {
        next.add(filter);
      }
      return next;
    });
  };

  // Recomputed every render (not memoized) so "today" stays correct if the app is left open
  // across midnight — mirrors ProjectsView's own inline `todayStr` convention.
  const todayKey = toDateKey(new Date());

  // Holiday coverage tracks the currently viewed year (plus its immediate neighbors, since a
  // month/week grid can spill across a year boundary) rather than a fixed static range, so
  // navigating Previous/Next keeps showing correct holidays regardless of year.
  const anchorYear = anchorDate.getFullYear();

  const entriesByDate = useMemo(() => {
    const filtered = filterCalendarEntries(
      [
        ...buildCalendarEntries(projects, tasks, calendarEvents),
        ...buildHolidayEntries([anchorYear - 1, anchorYear, anchorYear + 1], holidays),
        ...buildApprovedLeaveEntries(approvedLeave)
      ],
      originFilter,
      activeKinds
    );
    return groupEntriesByDate(
      showPersonalFilters
        ? filtered.filter((entry) =>
            matchesPersonalFilters(entry, activePersonalFilters, projects, tasks, currentUser.id)
          )
        : filtered
    );
  }, [
    projects,
    tasks,
    calendarEvents,
    approvedLeave,
    holidays,
    anchorYear,
    originFilter,
    activeKinds,
    showPersonalFilters,
    activePersonalFilters,
    currentUser.id
  ]);

  const monthDates = useMemo(
    () => getMonthGridDates(anchorDate.getFullYear(), anchorDate.getMonth()),
    [anchorDate]
  );
  const weekDates = useMemo(() => getWeekDates(anchorDate), [anchorDate]);
  const yearMonths = useMemo(() => getYearMonths(anchorDate.getFullYear()), [anchorDate]);

  const periodLabel = useMemo(() => {
    if (viewMode === 'month') {
      return anchorDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    if (viewMode === 'year') {
      return `${anchorDate.getFullYear()}`;
    }
    if (viewMode === 'day') {
      return anchorDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    }
    const start = weekDates[0];
    const end = weekDates[6];
    const sameMonth = start.getMonth() === end.getMonth();
    const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endLabel = end.toLocaleDateString(
      'en-US',
      sameMonth ? { day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }
    );
    return `${startLabel} – ${endLabel}`;
  }, [anchorDate, viewMode, weekDates]);

  const goPrevious = () => setAnchorDate((prev) => shiftAnchorDate(prev, viewMode, -1));
  const goNext = () => setAnchorDate((prev) => shiftAnchorDate(prev, viewMode, 1));
  const goToday = () => setAnchorDate(new Date());

  const openDay = (dateKey: string) => {
    setActiveDayKey(dateKey);
    setExpandedEntryId(null);
  };

  const openEntry = (entry: CalendarEntry) => {
    setActiveDayKey(entry.date);
    setExpandedEntryId(entry.id);
  };

  const closeDayModal = () => {
    setActiveDayKey(null);
    setExpandedEntryId(null);
  };

  const selectMonth = (month: number) => {
    setAnchorDate(new Date(anchorDate.getFullYear(), month, 1));
    setViewMode('month');
  };

  const activeDayEntries = activeDayKey ? entriesByDate.get(activeDayKey) || [] : [];

  return (
    <div data-calendar className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-white flex items-center gap-2">
            <CalendarIcon className="text-cyan-400" size={22} /> Calendar
          </h1>
          <p className="text-[11px] sm:text-xs text-slate-400 mt-0.5">
            Project deadlines, milestones, task due dates, and scheduled events in one place.
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* HR-only: hidden completely for Admin and every other role. This is a UX
              convenience -- the real gate is server-side (see AppContext's createHoliday's
              comment / backend/src/calendar/calendar.service.ts's assertIsHR). */}
          {currentRole === 'HR' && (
            <button
              type="button"
              onClick={() => setManageHolidaysOpen(true)}
              className="px-2 sm:px-3 py-1.5 rounded-xl border border-white/10 bg-slate-900/50 text-[10px] sm:text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/5 flex items-center gap-1.5"
            >
              <Settings size={13} /> Manage Holidays
            </button>
          )}

          <div className="flex items-center gap-1 p-1 rounded-xl border border-white/10 bg-slate-900/50">
            {VIEW_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold capitalize transition ${
                  viewMode === mode
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Navigation Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-3 rounded-xl border border-white/10 bg-slate-900/50 px-3 sm:px-4 py-2 sm:py-3">
        <div className="flex items-center gap-1 sm:gap-1.5">
          <button
            type="button"
            onClick={goPrevious}
            aria-label="Previous"
            className="p-1.5 sm:p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-[11px] sm:text-xs font-bold border border-white/10 bg-white/5 text-slate-200 hover:bg-white/10 hover:border-white/20 transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            onClick={goNext}
            aria-label="Next"
            className="p-1.5 sm:p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ChevronRight size={14} />
          </button>
          <h2 className="ml-1 sm:ml-2 text-xs sm:text-sm font-bold text-white font-mono tracking-wide truncate max-w-[160px] sm:max-w-none">{periodLabel}</h2>
        </div>

        <CalendarFilterBar
          originFilter={originFilter}
          onOriginFilterChange={setOriginFilter}
          activeKinds={activeKinds}
          onActiveKindsChange={setActiveKinds}
          showPersonalFilters={showPersonalFilters}
          showLedProjectsFilter={showLedProjectsFilter}
          activePersonalFilters={activePersonalFilters}
          onTogglePersonalFilter={togglePersonalFilter}
        />
      </div>

      {/* Grid Body */}
      {viewMode === 'month' && (
        <MonthGrid
          dates={monthDates}
          anchorMonth={anchorDate.getMonth()}
          entriesByDate={entriesByDate}
          todayKey={todayKey}
          projects={projects}
          tasks={tasks}
          users={users}
          onSelectDay={openDay}
          onSelectEntry={openEntry}
        />
      )}

      {viewMode === 'week' && (
        <WeekGrid
          dates={weekDates}
          entriesByDate={entriesByDate}
          todayKey={todayKey}
          projects={projects}
          tasks={tasks}
          users={users}
          onSelectEntry={openEntry}
        />
      )}

      {viewMode === 'day' && (
        <DayGrid
          date={anchorDate}
          entriesByDate={entriesByDate}
          projects={projects}
          tasks={tasks}
          users={users}
          onSelectEntry={openEntry}
        />
      )}

      {viewMode === 'year' && (
        <YearGrid
          months={yearMonths}
          entriesByDate={entriesByDate}
          todayKey={todayKey}
          onSelectMonth={selectMonth}
        />
      )}

      {/* Day Detail Drawer */}
      <DayEntriesDrawer
        dateKey={activeDayKey}
        entries={activeDayEntries}
        projects={projects}
        tasks={tasks}
        expandedEntryId={expandedEntryId}
        onToggleEntry={(id) => setExpandedEntryId((prev) => (prev === id ? null : id))}
        onClose={closeDayModal}
      />

      {manageHolidaysOpen && currentRole === 'HR' && (
        <ManageHolidaysModal onClose={() => setManageHolidaysOpen(false)} />
      )}
    </div>
  );
};
