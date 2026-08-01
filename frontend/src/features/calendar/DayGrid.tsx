import React from 'react';
import { FolderKanban, CheckSquare } from 'lucide-react';
import { Project, Task, User } from '../../types';
import { CalendarEntryTooltip } from './CalendarEntryTooltip';
import { CalendarEntry, entryOrigin, entryToneClasses, toDateKey } from './calendarRules';

const OriginIcon: React.FC<{ entry: CalendarEntry }> = ({ entry }) => {
  const origin = entryOrigin(entry);
  if (origin === 'project') return <FolderKanban size={12} className="shrink-0 text-cyan-400" />;
  if (origin === 'task') return <CheckSquare size={12} className="shrink-0 text-purple-400" />;
  return null;
};

export const DayGrid: React.FC<{
  date: Date;
  entriesByDate: Map<string, CalendarEntry[]>;
  projects: Project[];
  tasks: Task[];
  users: User[];
  onSelectEntry: (entry: CalendarEntry) => void;
}> = ({ date, entriesByDate, projects, tasks, users, onSelectEntry }) => {
  const dayEntries = entriesByDate.get(toDateKey(date)) || [];

  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/40 p-3 sm:p-4">
      {dayEntries.length === 0 ? (
        <p className="py-10 text-center text-xs text-slate-500">No events scheduled for this day.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {dayEntries.map((entry) => {
            const tone = entryToneClasses(entry.kind);
            return (
              <CalendarEntryTooltip key={entry.id} entry={entry} projects={projects} tasks={tasks} users={users}>
                <button
                  type="button"
                  onClick={() => onSelectEntry(entry)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-left transition-colors hover:border-white/20 ${entry.completed ? 'opacity-50' : ''}`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      data-calendar-entry-kind={entry.kind}
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold ${tone.badgeClass}`}
                    >
                      {entry.kind}
                    </span>
                    <OriginIcon entry={entry} />
                    <span className={`truncate text-xs font-semibold text-slate-200 ${entry.completed ? 'line-through' : ''}`}>{entry.title}</span>
                  </span>
                  {entry.time && <span className="shrink-0 font-mono text-[10px] text-slate-400">{entry.time}</span>}
                </button>
              </CalendarEntryTooltip>
            );
          })}
        </div>
      )}
    </div>
  );
};
