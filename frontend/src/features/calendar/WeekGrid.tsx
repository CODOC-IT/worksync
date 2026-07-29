import React from 'react';
import { FolderKanban, CheckSquare } from 'lucide-react';
import { Project, Task, User } from '../../types';
import { CalendarEntryTooltip } from './CalendarEntryTooltip';
import { CalendarEntry, entryOrigin, entryToneClasses, toDateKey } from './calendarRules';

const OriginIcon: React.FC<{ entry: CalendarEntry }> = ({ entry }) => {
  const origin = entryOrigin(entry);
  if (origin === 'project') return <FolderKanban size={10} className="shrink-0 text-cyan-400" />;
  if (origin === 'task') return <CheckSquare size={10} className="shrink-0 text-purple-400" />;
  return null;
};

export const WeekGrid: React.FC<{
  dates: Date[];
  entriesByDate: Map<string, CalendarEntry[]>;
  todayKey: string;
  projects: Project[];
  tasks: Task[];
  users: User[];
  onSelectEntry: (entry: CalendarEntry) => void;
}> = ({ dates, entriesByDate, todayKey, projects, tasks, users, onSelectEntry }) => (
  <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3 sm:p-4">
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
                ? 'border-cyan-400/50 bg-cyan-500/10'
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
                      data-calendar-entry-kind={entry.kind}
                      className={`flex w-full items-center gap-1 px-1.5 py-1 rounded text-[10px] font-medium border ${tone.badgeClass}`}
                      >
                        <OriginIcon entry={entry} />
                        <span className="truncate">
                          {entry.time && <span className="font-mono opacity-80 mr-1">{entry.time}</span>}
                          {entry.title}
                        </span>
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
