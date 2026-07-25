import React, { useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  FolderKanban,
  CheckSquare,
  X
} from 'lucide-react';
import { useApp } from '../../store/AppContext';
import { GlassCard } from '../../components/common/GlassCard';
import { StatusBadge } from '../../components/common/StatusBadge';
import { Project, Task, User } from '../../types';
import { CalendarEntryTooltip } from './CalendarEntryTooltip';
import {
  buildCalendarEntries,
  groupEntriesByDate,
  getMonthGridDates,
  getWeekDates,
  getYearMonths,
  entryToneClasses,
  toDateKey,
  parseDateKey,
  CalendarEntry,
  CalendarEntryKind,
  CalendarYearMonth
} from './calendarRules';

type CalendarViewMode = 'month' | 'week' | 'year';

const VIEW_MODES: CalendarViewMode[] = ['month', 'week', 'year'];
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LEGEND_KINDS: CalendarEntryKind[] = ['Deadline', 'Milestone', 'Task Due', 'Review'];

const shiftAnchorDate = (date: Date, mode: CalendarViewMode, direction: 1 | -1): Date => {
  const next = new Date(date);
  if (mode === 'month') {
    next.setMonth(next.getMonth() + direction);
  } else if (mode === 'week') {
    next.setDate(next.getDate() + direction * 7);
  } else {
    next.setFullYear(next.getFullYear() + direction);
  }
  return next;
};

export const CalendarView: React.FC = () => {
  const { projects, tasks, users, calendarEvents } = useApp();

  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [anchorDate, setAnchorDate] = useState<Date>(() => new Date());
  const [activeDayKey, setActiveDayKey] = useState<string | null>(null);
  const [expandedEntryId, setExpandedEntryId] = useState<string | null>(null);

  // Recomputed every render (not memoized) so "today" stays correct if the app is left open
  // across midnight — mirrors ProjectsView's own inline `todayStr` convention.
  const todayKey = toDateKey(new Date());

  const entriesByDate = useMemo(
    () => groupEntriesByDate(buildCalendarEntries(projects, tasks, calendarEvents)),
    [projects, tasks, calendarEvents]
  );

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white flex items-center gap-2">
            <CalendarIcon className="text-cyan-400" size={24} /> Calendar
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Project deadlines, milestones, task due dates, and scheduled events in one place.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-900/50 border border-white/10 shrink-0">
          {VIEW_MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition ${
                viewMode === mode
                  ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-[0_0_10px_rgba(0,242,254,0.15)]'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {/* Navigation Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 glass-panel px-4 py-3">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={goPrevious}
            aria-label="Previous"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            type="button"
            onClick={goToday}
            className="px-3 py-1.5 rounded-lg text-xs font-bold glass-button-neon"
          >
            Today
          </button>
          <button
            type="button"
            onClick={goNext}
            aria-label="Next"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <ChevronRight size={16} />
          </button>
          <h2 className="ml-2 text-sm font-bold text-white font-mono tracking-wide">{periodLabel}</h2>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-slate-400">
          {LEGEND_KINDS.map((kind) => {
            const tone = entryToneClasses(kind);
            return (
              <span key={kind} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${tone.dotClass}`} />
                {kind}
              </span>
            );
          })}
        </div>
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

      {viewMode === 'year' && (
        <YearGrid
          months={yearMonths}
          entriesByDate={entriesByDate}
          todayKey={todayKey}
          onSelectMonth={selectMonth}
        />
      )}

      {/* Day Detail Modal */}
      {activeDayKey && (
        <DayEntriesModal
          dateKey={activeDayKey}
          entries={activeDayEntries}
          projects={projects}
          tasks={tasks}
          expandedEntryId={expandedEntryId}
          onToggleEntry={(id) => setExpandedEntryId((prev) => (prev === id ? null : id))}
          onClose={closeDayModal}
        />
      )}
    </div>
  );
};

const MonthGrid: React.FC<{
  dates: Date[];
  anchorMonth: number;
  entriesByDate: Map<string, CalendarEntry[]>;
  todayKey: string;
  projects: Project[];
  tasks: Task[];
  users: User[];
  onSelectDay: (dateKey: string) => void;
  onSelectEntry: (entry: CalendarEntry) => void;
}> = ({ dates, anchorMonth, entriesByDate, todayKey, projects, tasks, users, onSelectDay, onSelectEntry }) => (
  <div className="glass-panel p-3 sm:p-4">
    <div className="grid grid-cols-7 gap-1 sm:gap-1.5 mb-1.5">
      {WEEKDAY_LABELS.map((label) => (
        <div key={label} className="text-center text-[10px] font-mono uppercase tracking-wider text-slate-500 py-1">
          {label}
        </div>
      ))}
    </div>
    <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
      {dates.map((date) => {
        const dateKey = toDateKey(date);
        const dayEntries = entriesByDate.get(dateKey) || [];
        const isCurrentMonth = date.getMonth() === anchorMonth;
        const isToday = dateKey === todayKey;
        const visibleEntries = dayEntries.slice(0, 3);
        const overflowCount = dayEntries.length - visibleEntries.length;

        return (
          <div
            key={dateKey}
            onClick={() => dayEntries.length > 0 && onSelectDay(dateKey)}
            className={`min-h-[68px] sm:min-h-[92px] rounded-lg border p-1 sm:p-1.5 flex flex-col gap-1 transition-colors ${
              isToday
                ? 'border-cyan-400/60 bg-cyan-500/10 shadow-[0_0_12px_rgba(0,242,254,0.2)]'
                : 'border-white/5 bg-white/[0.02]'
            } ${isCurrentMonth ? '' : 'opacity-40'} ${dayEntries.length > 0 ? 'cursor-pointer hover:border-cyan-500/30' : ''}`}
          >
            <span
              className={`text-[10px] sm:text-[11px] font-mono ${
                isToday ? 'text-cyan-300 font-bold' : isCurrentMonth ? 'text-slate-300' : 'text-slate-600'
              }`}
            >
              {date.getDate()}
            </span>
            <div className="flex-1 flex flex-col gap-0.5 overflow-hidden">
              {visibleEntries.map((entry) => {
                const tone = entryToneClasses(entry.kind);
                return (
                  <CalendarEntryTooltip
                    key={entry.id}
                    entry={entry}
                    projects={projects}
                    tasks={tasks}
                    users={users}
                  >
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectEntry(entry);
                      }}
                      title={entry.title}
                      className={`w-full text-left truncate px-1 py-0.5 rounded text-[9px] sm:text-[10px] font-medium border ${tone.badgeClass}`}
                    >
                      {entry.title}
                    </button>
                  </CalendarEntryTooltip>
                );
              })}
              {overflowCount > 0 && (
                <span className="text-[9px] text-slate-500 font-mono px-1">+{overflowCount} more</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const WeekGrid: React.FC<{
  dates: Date[];
  entriesByDate: Map<string, CalendarEntry[]>;
  todayKey: string;
  projects: Project[];
  tasks: Task[];
  users: User[];
  onSelectEntry: (entry: CalendarEntry) => void;
}> = ({ dates, entriesByDate, todayKey, projects, tasks, users, onSelectEntry }) => (
  <div className="glass-panel p-3 sm:p-4">
    <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
      {dates.map((date) => {
        const dateKey = toDateKey(date);
        const dayEntries = entriesByDate.get(dateKey) || [];
        const isToday = dateKey === todayKey;

        return (
          <div
            key={dateKey}
            className={`rounded-lg border p-2 min-h-[120px] sm:min-h-[160px] flex flex-col gap-1.5 ${
              isToday
                ? 'border-cyan-400/60 bg-cyan-500/10 shadow-[0_0_12px_rgba(0,242,254,0.2)]'
                : 'border-white/5 bg-white/[0.02]'
            }`}
          >
            <div className="flex items-center justify-between shrink-0">
              <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                {date.toLocaleDateString('en-US', { weekday: 'short' })}
              </span>
              <span className={`text-xs font-mono font-bold ${isToday ? 'text-cyan-300' : 'text-slate-300'}`}>
                {date.getDate()}
              </span>
            </div>
            <div className="flex-1 flex flex-col gap-1 overflow-y-auto">
              {dayEntries.length === 0 ? (
                <span className="text-[10px] text-slate-600 italic">No events</span>
              ) : (
                dayEntries.map((entry) => {
                  const tone = entryToneClasses(entry.kind);
                  return (
                    <CalendarEntryTooltip
                      key={entry.id}
                      entry={entry}
                      projects={projects}
                      tasks={tasks}
                      users={users}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectEntry(entry)}
                        className={`w-full text-left px-1.5 py-1 rounded text-[10px] font-medium border ${tone.badgeClass}`}
                      >
                        {entry.time && <span className="font-mono opacity-80 mr-1">{entry.time}</span>}
                        {entry.title}
                      </button>
                    </CalendarEntryTooltip>
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
);

const YearGrid: React.FC<{
  months: CalendarYearMonth[];
  entriesByDate: Map<string, CalendarEntry[]>;
  todayKey: string;
  onSelectMonth: (month: number) => void;
}> = ({ months, entriesByDate, todayKey, onSelectMonth }) => (
  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
    {months.map(({ month, label, dates }) => {
      const monthEntryCount = dates
        .filter((date) => date.getMonth() === month)
        .reduce((count, date) => count + (entriesByDate.get(toDateKey(date))?.length || 0), 0);

      return (
        <GlassCard
          key={month}
          hover3dTilt={false}
          onClick={() => onSelectMonth(month)}
          className="flex flex-col gap-2"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold text-white">{label}</h3>
            {monthEntryCount > 0 && (
              <span className="text-[10px] font-mono text-cyan-400">
                {monthEntryCount} item{monthEntryCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {dates.map((date) => {
              const dateKey = toDateKey(date);
              const isCurrentMonth = date.getMonth() === month;
              const hasEntries = isCurrentMonth && (entriesByDate.get(dateKey)?.length || 0) > 0;
              const isToday = dateKey === todayKey;

              return (
                <div
                  key={dateKey}
                  className={`aspect-square rounded-sm flex flex-col items-center justify-center gap-0.5 text-[7px] font-mono ${
                    isToday ? 'bg-cyan-500/30 text-cyan-200 font-bold' : isCurrentMonth ? 'text-slate-500' : 'text-slate-800'
                  }`}
                >
                  <span>{isCurrentMonth ? date.getDate() : ''}</span>
                  {hasEntries && <span className="w-1 h-1 rounded-full bg-cyan-400" />}
                </div>
              );
            })}
          </div>
        </GlassCard>
      );
    })}
  </div>
);

const DayEntriesModal: React.FC<{
  dateKey: string;
  entries: CalendarEntry[];
  projects: Project[];
  tasks: Task[];
  expandedEntryId: string | null;
  onToggleEntry: (id: string) => void;
  onClose: () => void;
}> = ({ dateKey, entries, projects, tasks, expandedEntryId, onToggleEntry, onClose }) => {
  const dateLabel = parseDateKey(dateKey).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-150">
      <div className="w-full max-w-lg glass-panel-glow border border-cyan-500/40 shadow-2xl relative overflow-hidden flex flex-col max-h-[70vh]">
        <div className="p-4 border-b border-white/10 flex items-center justify-between bg-slate-900/60 shrink-0">
          <div>
            <h3 className="text-sm font-bold text-white">{dateLabel}</h3>
            <p className="text-[11px] text-slate-400">
              {entries.length} item{entries.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-white" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="p-4 space-y-2 overflow-y-auto">
          {entries.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-6">No events scheduled for this day.</p>
          )}

          {entries.map((entry) => {
            const tone = entryToneClasses(entry.kind);
            const isExpanded = expandedEntryId === entry.id;
            const project = entry.projectId ? projects.find((p) => p.id === entry.projectId) : undefined;
            const task = entry.taskId ? tasks.find((t) => t.id === entry.taskId) : undefined;

            return (
              <div key={entry.id} className="rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
                <button
                  type="button"
                  onClick={() => onToggleEntry(entry.id)}
                  className="w-full flex items-center justify-between gap-2 p-3 text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-bold ${tone.badgeClass}`}>
                      {entry.kind}
                    </span>
                    <span className="text-xs font-semibold text-slate-200 truncate">{entry.title}</span>
                  </div>
                  {entry.time && <span className="shrink-0 text-[10px] font-mono text-slate-400">{entry.time}</span>}
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 space-y-2 border-t border-white/5 pt-2">
                    {project && (
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="flex items-center gap-1.5 text-slate-400 min-w-0 truncate">
                          <FolderKanban size={12} className="text-cyan-400 shrink-0" />
                          <span className="font-mono text-cyan-400 shrink-0">{project.code}</span>
                          <span className="truncate">{project.title}</span>
                        </span>
                        <StatusBadge status={project.status} size="sm" />
                      </div>
                    )}
                    {task && (
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="flex items-center gap-1.5 text-slate-400 min-w-0 truncate">
                          <CheckSquare size={12} className="text-purple-400 shrink-0" />
                          <span className="font-mono text-purple-400 shrink-0">{task.taskNumber}</span>
                          <span className="truncate">{task.title}</span>
                        </span>
                        <StatusBadge status={task.status} size="sm" />
                      </div>
                    )}
                    {!project && !task && (
                      <p className="text-[11px] text-slate-500">No linked project or task.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
