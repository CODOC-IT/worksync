import React from 'react';
import { FolderKanban, CheckSquare } from 'lucide-react';
import { Project, Task, User } from '../../types';
import { CalendarEntryTooltip } from './CalendarEntryTooltip';
import { CalendarEntry, entryOrigin, entryToneClasses, toDateKey } from './calendarRules';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Origin icon is a second, orthogonal signal to the kind-based fill color: cyan/FolderKanban for
// project-origin entries, purple/CheckSquare for task-origin, nothing for standalone events —
// reuses the exact icon+color pairing already established in DayEntriesDrawer/CalendarEntryTooltip.
const OriginIcon: React.FC<{ entry: CalendarEntry }> = ({ entry }) => {
  const origin = entryOrigin(entry);
  if (origin === 'project') return <FolderKanban size={9} className="shrink-0 text-cyan-400" />;
  if (origin === 'task') return <CheckSquare size={9} className="shrink-0 text-purple-400" />;
  return null;
};

export const MonthGrid: React.FC<{
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
  <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3 sm:p-4">
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
                ? 'border-cyan-400/50 bg-cyan-500/10'
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
                      data-calendar-entry-kind={entry.kind}
                      className={`flex w-full items-center gap-1 px-1 py-0.5 rounded text-[9px] sm:text-[10px] font-medium border ${tone.badgeClass}`}
                    >
                      <OriginIcon entry={entry} />
                      <span className="truncate">{entry.title}</span>
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
